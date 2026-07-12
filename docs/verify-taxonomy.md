# Verify taxonomy — what `verify_rom` catches (the moat spec)

Design anchor for **P0-V1** (verify_rom.py checks), **P0-FX1** (the known-bad
fixture), and **P0-F1** (agent footgun doc). One shared list of failure classes
so all three stay coherent. SYSTEM_PLAN §1.1/§1.2.

The core insight (SYSTEM_PLAN §2.2 applied to code): every class below is
**mechanically detectable** headless — either mGBA emits a log line, or the
final CPU/memory state is provably wrong. That mechanical signal is the moat.
What is *not* here is aesthetic/visual correctness ("sprite is garbage tiles")
— that is invisible to logs and is covered by the **screenshot-into-context**
loop (§1.2), not by verify_rom. Keep that boundary sharp.

## Signal sources (to be pinned against real libmgba during V1)

verify_rom runs the ROM headless in libmgba for N frames with a **log callback**
installed, then reads the final CPU/memory state. Two log streams matter:
1. **mGBA game-error logs** — mGBA's own detection of illegal hardware use
   (its `GAME_ERROR`-level category). This is engine-independent: it fires for
   any GBA program, Butano or not.
2. **The game debug channel** — mGBA exposes a debug-output register; **Butano
   debug builds route `BN_ASSERT`/`BN_ERROR` there** at ERROR/FATAL level. So a
   debug-built Butano ROM *self-reports* most illegal states. Building fixtures
   and user projects in **debug mode for verify** is therefore a force
   multiplier — get the engine's own invariant checks for free.

`VerifyResult` (see `@gba-studio/contract`): `gameErrors[]` = captured
ERROR/FATAL/game-error lines; `pass` = `gameErrors` empty AND execution sane
(classes D below); `cpu`/`memory` = final snapshot.

## Failure classes

| # | Class | What it is | Detection | Severity |
|---|---|---|---|---|
| **A** | **Narrow (8/partial) writes to VRAM / OAM / PALRAM** | The founding bug. These regions accept only 16/32-bit access; an 8-bit store is dropped/mirrored by hardware, corrupting adjacent data (the `Store8 to OAM` class). | mGBA game-error log line for the bad store. | **hard fail** |
| **B** | **Butano runtime assertions** | Engine invariant violated: OAM/sprite/BG/palette/VRAM budget exceeded, out-of-range params, illegal state transitions. | Debug-build Butano writes ERROR/FATAL to the mGBA debug channel. Any such line. | **hard fail** |
| **C** | **Invalid hardware / I/O access** | Bad DMA setup, writes to invalid/unmapped I/O registers, illegal BIOS calls, bad DISPCNT/mode combos. | mGBA game-error/warn logs. | hard fail (error) / warn |
| **D** | **CPU / execution faults** | Undefined instruction, branch into unmapped memory, `SP` outside IWRAM/EWRAM. | mGBA fatal logs + final CPU snapshot sanity (PC & SP in valid ranges). | **hard fail** |
| **D′** | **Liveness / hang** *(deferred)* | No progress — game stuck in an infinite loop / deadlock. | **Not implemented in V1.** A game idling in BIOS `VBlankIntrWait` is indistinguishable from a BIOS-parked hang by the final CPU snapshot alone; a generic progress signal needs more than one snapshot. Tracked follow-up: a `known-bad-hang` fixture + a frame-hash/VCOUNT-progress watchdog. | *(future)* |
| — | *(visual)* garbage tiles, wrong colors, off-screen sprites | Renders but looks wrong. | **Not log-detectable.** Out of scope for verify_rom → screenshot loop (§1.2). | n/a |

## Pass/fail rule

`pass == true` iff: **zero** fail-level lines over the run (class A/B/C-error —
i.e. any GAME_ERROR/ERROR/FATAL), AND the final CPU state is sane (class D: PC
in BIOS/ROM/IWRAM/EWRAM, SP within a stack region). Class-D′ liveness/hang is
**not** part of the v1 rule (deferred, see above). Class-C **warnings** are
surfaced in `gameErrors` but do **not** fail the verdict. Everything at
WARN-level and above goes into `gameErrors[]` (deduped with an `(xN)` count so
identical per-frame lines don't blow up context, §4.5); INFO/DEBUG noise stays
in `memory.counters` only, so the agent (and the small triage model, §1.2) sees
signal, not spam.

## Fixture contract (drives P0-FX1)

- **known-good:** a minimal Butano project (sprite + bg on screen) that runs
  300 frames with **zero** ERROR/FATAL lines and a sane final CPU state.
  Proves verify_rom does not false-positive.
- **known-bad-oam:** the same, plus a deliberate **class-A** violation — a raw
  8-bit write to the OAM region (e.g. `*(volatile uint8_t*)0x07000000 = x;`),
  bypassing Butano's safe API. Must **compile and run** (it's a runtime bug,
  not a compile error) and must make verify_rom **fail** with a class-A
  `gameError`. This is the canonical moat test: if verify_rom misses this, it
  has no value.
