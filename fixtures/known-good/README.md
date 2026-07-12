# fixtures/known-good

P0-FX1 fixture. The minimal Butano project that proves `verify_rom` (P0-V1)
does not false-positive on a correct ROM.

## What it does

`src/main.cpp` calls `bn::core::init()`, creates one regular background
(`graphics/red.bmp` + `red.json`) via `bn::regular_bg_ptr`, and loops
`bn::core::update()` forever. It uses only Butano's safe API — no raw
hardware writes anywhere.

Based on `external/butano/template` (Butano's own minimal starter),
trimmed further: no audio/dmg_audio content, no extra includes.

## Build

```bash
/c/devkitPro/msys2/usr/bin/bash.exe -lc "make -C fixtures/known-good PYTHON=/c/Python313/python.exe"
```

(`PYTHON` only needs overriding because this machine has no `python`/`python3`
on PATH inside the devkitARM msys2 shell; the Docker toolchain image should
have one on PATH already.)

`LIBBUTANO` defaults (via `?=`) to `/c/Dev/GBA-Game/external/butano/butano`
and can be overridden, e.g. `make LIBBUTANO=/opt/butano/butano`, for the
P0-A1 Docker image where Butano lives at a different path.

Output: `known-good.gba` (committed alongside the source — this ROM is the
artifact P0-V1 tests against).

## Expected verify_rom result

**PASS.** Run headless for ~300 frames: zero class A/B/C-error/D lines in
`gameErrors[]`, and a sane final CPU state (PC/SP in valid ranges, the run
made progress). See `docs/verify-taxonomy.md` for the full failure taxonomy.
