#!/usr/bin/env python3
"""P0-A1 libmgba smoke proof.

De-risk script for the toolchain image: load a real ROM into headless
libmgba (built from source with -DBUILD_PYTHON=ON, see ../Dockerfile),
install a log callback, run N frames with no video/audio backend, and
print captured log lines plus the final CPU register snapshot.

This is NOT verify_rom.py (that's P0-V1, authored separately against the
class A/B/C/D taxonomy in docs/verify-taxonomy.md). This script only proves
the libmgba runtime + Python bindings work end-to-end inside the image.

Usage: python3 verify_smoke.py [rom_path] [--frames N]
"""
import argparse
import os
import sys

import mgba.core
import mgba.log
from mgba._pylib import ffi as _ffi


class CapturingLogger(mgba.log.Logger):
    """Collects every log line mgba emits instead of printing it."""

    def __init__(self):
        super().__init__()
        self.lines = []

    def log(self, category, level, message):
        # `message` arrives as a cffi `const char*`; decode it (the mgba
        # Python binding's own Logger.log() does not do this for you).
        if not isinstance(message, str):
            message = _ffi.string(message).decode("utf-8", "replace")
        category_name = self.category_name(category)
        level_name = {
            mgba.log.Logger.FATAL: "FATAL",
            mgba.log.Logger.ERROR: "ERROR",
            mgba.log.Logger.WARN: "WARN",
            mgba.log.Logger.INFO: "INFO",
            mgba.log.Logger.DEBUG: "DEBUG",
            mgba.log.Logger.STUB: "STUB",
            mgba.log.Logger.GAME_ERROR: "GAME_ERROR",
        }.get(level, str(level))
        self.lines.append(f"[{level_name}] {category_name}: {message}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "rom",
        nargs="?",
        default=os.path.join(os.path.dirname(__file__), "BrickBreakerGBA.gba"),
        help="Path to the ROM to load (default: bundled BrickBreakerGBA.gba)",
    )
    parser.add_argument("--frames", type=int, default=300, help="Frames to run headless")
    args = parser.parse_args()

    if not os.path.isfile(args.rom):
        print(f"ROM not found: {args.rom}", file=sys.stderr)
        return 1

    logger = CapturingLogger()
    mgba.log.install_default(logger)

    core = mgba.core.load_path(args.rom)
    if core is None:
        print(f"mgba failed to identify/load ROM: {args.rom}", file=sys.stderr)
        return 1

    core.reset()

    width, height = core.desired_video_dimensions()
    print(f"loaded: {args.rom}")
    print(f"game title: {core.game_title!r}  game code: {core.game_code!r}")
    print(f"video dims: {width}x{height}")

    for _ in range(args.frames):
        core.run_frame()

    pc = core.cpu.pc
    sp = core.cpu.sp
    lr = core.cpu.lr

    print(f"ran {args.frames} frames headless")
    print(f"captured {len(logger.lines)} log line(s):")
    for line in logger.lines:
        print(f"  {line}")

    print("final CPU registers:")
    print(f"  PC = 0x{pc:08X}")
    print(f"  SP = 0x{sp:08X}")
    print(f"  LR = 0x{lr:08X}")

    print("SMOKE OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
