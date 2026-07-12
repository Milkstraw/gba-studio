#!/usr/bin/env python3
"""verify_rom — headless GBA ROM verifier (P0-V1). The moat.

Runs a compiled `.gba` in headless libmgba for N frames, captures the
error-level log lines mGBA emits for illegal hardware use, checks the final CPU
state for sanity, and reports a structured verdict. Implements the failure
taxonomy in `docs/verify-taxonomy.md`; the JSON it emits matches the
`VerifyResult` shape in `@gba-studio/contract`.

Detection (taxonomy classes):
  A/C  illegal hardware access  -> mGBA GAME_ERROR log lines
       (e.g. "Cannot Store8 to OAM" — the founding bug class), bad DMA/IO.
  B    Butano runtime asserts   -> ERROR/FATAL log lines (debug builds route
       BN_ASSERT/BN_ERROR to the mGBA debug channel).
  D    CPU/execution faults     -> final PC/SP outside valid GBA memory regions.

Not covered (by design): visual correctness ("garbage tiles") is invisible to
logs -> that's the screenshot-into-context loop (SYSTEM_PLAN §1.2), not here.

Runtime dep: the `mgba` Python bindings (libmgba), built from source in the
toolchain image (see toolchain/Dockerfile). NOT pip-installable — see
verify_rom/README.md.

Usage:
    python3 verify_rom.py <rom.gba> [--frames N] [--json]
Exit: 0 = pass, 1 = verify failure, 2 = infra error (bad args / load failure).
"""
from __future__ import annotations

import argparse
import json
import sys
from typing import Any

# ── GBA memory map (class-D CPU sanity) ──────────────────────────────────────
# A healthy Butano game idles in BIOS VBlankIntrWait, so BIOS is a VALID PC.
_PC_REGIONS = (
    (0x00000000, 0x00003FFF),  # BIOS (idle VBlankIntrWait lives here)
    (0x02000000, 0x0203FFFF),  # EWRAM
    (0x03000000, 0x03007FFF),  # IWRAM
    (0x08000000, 0x0DFFFFFF),  # ROM (WS0 + WS1/WS2 mirrors)
)
# Stack normally sits in IWRAM; some projects place it in EWRAM.
_SP_REGIONS = (
    (0x03000000, 0x03007FFF),  # IWRAM (default stack)
    (0x02000000, 0x0203FFFF),  # EWRAM
)


def _in_regions(addr: int, regions: tuple[tuple[int, int], ...]) -> bool:
    return any(lo <= addr <= hi for lo, hi in regions)


def pc_valid(pc: int) -> bool:
    return _in_regions(pc, _PC_REGIONS)


def sp_valid(sp: int) -> bool:
    return _in_regions(sp, _SP_REGIONS)


def _self_check() -> None:
    """Pure-logic check for the range helpers — runs without libmgba.
    ponytail: the one guard that fails if the CPU-sanity boundaries drift."""
    assert pc_valid(0x000001F8), "BIOS idle PC must be valid"  # observed fixture idle
    assert pc_valid(0x08000000) and pc_valid(0x03000100)
    assert not pc_valid(0x00000000 - 1) and not pc_valid(0x01000000)  # BIOS/EWRAM gap
    assert not pc_valid(0x10000000)  # past ROM
    assert sp_valid(0x03007E7C) and not sp_valid(0x08000000)


def verify(rom_path: str, frames: int = 300) -> dict[str, Any]:
    """Run the ROM headless and return a VerifyResult dict. Raises on infra
    failure (ROM missing / unloadable) — those are exit-2, not a verdict."""
    import mgba.core
    import mgba.log
    from mgba._pylib import ffi as _ffi

    fail_levels = {
        mgba.log.Logger.GAME_ERROR,
        mgba.log.Logger.ERROR,
        mgba.log.Logger.FATAL,
    }
    # WARN is surfaced for the agent/triage model but does NOT fail the verdict
    # (taxonomy class-C warn/error split). INFO/DEBUG stay noise (counters only).
    warn_levels = {mgba.log.Logger.WARN}
    level_names = {
        mgba.log.Logger.FATAL: "FATAL",
        mgba.log.Logger.ERROR: "ERROR",
        mgba.log.Logger.WARN: "WARN",
        mgba.log.Logger.INFO: "INFO",
        mgba.log.Logger.DEBUG: "DEBUG",
        mgba.log.Logger.STUB: "STUB",
        mgba.log.Logger.GAME_ERROR: "GAME_ERROR",
    }

    class _Capture(mgba.log.Logger):
        def __init__(self) -> None:
            super().__init__()
            self.counts: dict[str, int] = {}
            # ordered de-dup: text -> count (identical illegal writes fire once
            # per frame; the agent needs the line + a count, not 291 copies —
            # token cost, SYSTEM_PLAN §4.5). Separate fail vs warn so warnings
            # surface without failing the verdict.
            self.fails: dict[str, int] = {}
            self.warns: dict[str, int] = {}

        def log(self, category: int, level: int, message: Any) -> None:
            if not isinstance(message, str):
                message = _ffi.string(message).decode("utf-8", "replace")
            name = level_names.get(level, str(level))
            self.counts[name] = self.counts.get(name, 0) + 1
            bucket = (
                self.fails if level in fail_levels
                else self.warns if level in warn_levels
                else None
            )
            if bucket is not None:
                line = f"[{name}] {self.category_name(category)}: {message}"
                bucket[line] = bucket.get(line, 0) + 1

    logger = _Capture()
    mgba.log.install_default(logger)

    core = mgba.core.load_path(rom_path)
    if core is None:
        raise RuntimeError(f"libmgba could not identify/load ROM: {rom_path}")
    core.reset()
    for _ in range(frames):
        core.run_frame()

    pc = int(core.cpu.pc)
    sp = int(core.cpu.sp)
    lr = int(core.cpu.lr)
    # core.cpu.cpsr is a cffi `union PSR`; its raw 32-bit value is `.packed`.
    try:
        cpsr = int(core.cpu.cpsr.packed)
    except Exception:
        cpsr = 0

    def _dedup(bucket: dict[str, int]) -> list[str]:
        return [ln if n == 1 else f"{ln} (x{n})" for ln, n in bucket.items()]

    # gameErrors surfaces all diagnostic lines (fail-level + WARN) de-duped with
    # counts, so the triage model can read them; only fail-level lines fail the
    # verdict (taxonomy). INFO/DEBUG noise stays in memory.counters.
    fail_lines = _dedup(logger.fails)
    game_errors = fail_lines + _dedup(logger.warns)

    # Class D (CPU-region sanity): synthesize a [VERIFY] line so the reason is
    # visible in the same channel the agent reads; keeps VerifyResult's shape.
    cpu_ok = pc_valid(pc) and sp_valid(sp)
    if not cpu_ok:
        game_errors.append(
            f"[VERIFY] class-D CPU state invalid: PC=0x{pc:08X} SP=0x{sp:08X}"
        )

    # ponytail: class-D *liveness/hang* detection is deferred (tracked in TASKS.md
    # + docs/verify-taxonomy.md) — a game idling in BIOS VBlankIntrWait is
    # indistinguishable from a BIOS-parked hang by CPU state alone, and a
    # generic progress signal needs more than the final snapshot. CPU-region
    # sanity above IS implemented+tested; hang catch is future (needs a
    # known-bad-hang fixture). Upgrade path: frame-hash/VCOUNT-progress watchdog.

    passed = len(fail_lines) == 0 and cpu_ok

    return {
        "pass": passed,
        "gameErrors": game_errors,
        "framesRun": frames,
        "cpu": {"pc": pc, "sp": sp, "lr": lr, "cpsr": cpsr},
        "memory": {"counters": logger.counts},
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Headless GBA ROM verifier (P0-V1).")
    parser.add_argument("rom", help="path to the .gba ROM")
    parser.add_argument("--frames", type=int, default=300, help="frames to run (default 300)")
    parser.add_argument("--json", action="store_true", help="emit only the VerifyResult JSON")
    args = parser.parse_args(argv)

    try:
        result = verify(args.rom, args.frames)
    except Exception as exc:  # infra failure -> exit 2, not a verdict
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(result))
    else:
        verdict = "PASS" if result["pass"] else "FAIL"
        print(f"{verdict}  ({result['framesRun']} frames)")
        for line in result["gameErrors"]:
            print(f"  {line}")
        cpu = result["cpu"]
        print(f"  CPU: PC=0x{cpu['pc']:08X} SP=0x{cpu['sp']:08X} LR=0x{cpu['lr']:08X}")
        print(f"  log levels: {result['memory']['counters']}")
        print(json.dumps(result))

    return 0 if result["pass"] else 1


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--self-check":
        _self_check()
        print("self-check OK")
        sys.exit(0)
    sys.exit(main())
