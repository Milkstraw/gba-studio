# fixtures/known-bad-oam

P0-FX1 fixture. The canonical moat test: the same minimal Butano project as
`fixtures/known-good`, plus one deliberate **class-A** violation
(`docs/verify-taxonomy.md`) — a raw 8-bit write to OAM. If `verify_rom`
(P0-V1) misses this, it has no value.

## What it does

Identical to `fixtures/known-good`'s `src/main.cpp`, with one line added
inside the main loop:

```cpp
// Deliberate class-A violation: narrow (8-bit) write to OAM (0x07000000).
*(volatile uint8_t*)0x07000000 = 0x42;
```

OAM (`0x07000000`–`0x070003FF`) only accepts 16/32-bit access on real GBA
hardware; an 8-bit store is dropped/mirrored, corrupting adjacent OAM data
(sprite attributes). This bypasses Butano's safe API entirely — it's a raw
pointer write, so it compiles fine and only misbehaves at runtime, which is
the point: verify_rom must catch it from ROM behavior alone, not from a
compile error.

The diff against `fixtures/known-good` is intentionally minimal: comments,
this one write, and the ROM title/code (`FXBADOAM`/`FXBD` vs
`FXGOOD`/`FXGD`) so the two `.gba` files don't collide in an emulator's
recent-ROMs list.

## Build

```bash
/c/devkitPro/msys2/usr/bin/bash.exe -lc "make -C fixtures/known-bad-oam PYTHON=/c/Python313/python.exe"
```

Same `LIBBUTANO ?=` override convention as `fixtures/known-good` — see that
fixture's README for details.

Output: `known-bad-oam.gba` (committed alongside the source).

## Expected verify_rom result

**FAIL**, with a class-A `gameError` line (mGBA's own hardware-misuse
detection: `Store8 to OAM` / equivalent game-error log for the write at
`0x07000000`). `pass` must be `false` because `gameErrors[]` is non-empty.
