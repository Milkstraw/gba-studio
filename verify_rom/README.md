# verify_rom (P0-V1) — headless GBA ROM verifier

The moat. Runs a compiled `.gba` in headless libmgba, captures the error-level
log lines mGBA emits for illegal hardware use, checks final CPU sanity, and
emits a structured verdict matching `@gba-studio/contract`'s `VerifyResult`.

Implements the failure taxonomy in [`../docs/verify-taxonomy.md`](../docs/verify-taxonomy.md).

## Runtime dependency: libmgba (NOT pip)

`import mgba` requires the mGBA Python bindings, which are **not reliably
pip-installable**. They are built from source with CMake `-DBUILD_PYTHON=ON`
inside the toolchain image ([`../toolchain/Dockerfile`](../toolchain/Dockerfile)),
where they're already on `PYTHONPATH`. So verify_rom runs **inside the image**,
not on the host. (Host Windows has no libmgba — see TASKS.md "Plan corrections".)

## Run

```sh
# inside the toolchain image (mgba is importable there):
python3 verify_rom/verify_rom.py <rom.gba> [--frames N] [--json]
```

Exit code: `0` pass · `1` verify failure · `2` infra error (bad ROM/args).
`--json` emits only the `VerifyResult` object.

The pure CPU-range logic has a libmgba-free self-check:

```sh
python3 verify_rom/verify_rom.py --self-check
```

## Test (fixtures — inside the image)

```sh
pytest verify_rom/test_verify_rom.py -q
```

Asserts `known-good` → PASS and `known-bad-oam` → FAIL with a class-A
"Cannot Store8 to OAM" line. These fixtures (P0-FX1) are the acceptance test.

## What it does NOT do

Visual correctness (garbage tiles, wrong colors) is invisible to logs — that's
the screenshot-into-context loop (SYSTEM_PLAN §1.2), not this. Generic
liveness/hang detection is deferred (a BIOS-idle game looks like a hang by CPU
state alone); see the `ponytail:` note in `verify_rom.py`.
