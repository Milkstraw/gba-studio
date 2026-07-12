# toolchain — P0-A1 image

Reproducible `linux/amd64` Docker image containing everything needed to
compile and headlessly verify a GBA/Butano project: devkitARM + GBA tools
(`grit`, `mmutil`, `gbafix`), Butano (vendored at a pinned commit), Python 3,
headless mGBA with Python bindings, git, make.

**Status: local/private only. Do not push this image to any registry.**
devkitPro's redistribution terms for a commercial service are unresolved
(P0-LIC, SYSTEM_PLAN.md §4.3) — see "Licensing" below.

## Build

```bash
docker build -t gba-studio-toolchain:dev toolchain/
```

Everything the image needs (mGBA source, Butano source) is fetched from
GitHub *during the build* — the running container itself needs no network
access (matches SYSTEM_PLAN §1.7's no-egress session-VM rule; the toolchain
image build is a separate, pre-baked artifact).

## Pinned versions

| Input | Pin | Why this one |
|---|---|---|
| Base image | `devkitpro/devkitarm@sha256:116afba8df8453961de2936ffab20dd441edf4d682856c1ec8b0e53d7ed0bbf5` | Official devkitPro image (Debian 12 bookworm). Already ships devkitARM, `grit`/`mmutil`/`gbafix` (the `gba-dev` pacman group), git, make, cmake 3.31.6, and `python-is-python3`. Reassembling devkitARM from pacman by hand is strictly more risk for no benefit — SYSTEM_PLAN §1.1's "lazy path" call. |
| mGBA | tag `0.10.5`, commit `26b7884bc25a5933960f3cdcd98bac1ae14d42e2` | Latest stable mGBA release at time of writing. Built from source with `-DBUILD_PYTHON=ON` — there is no reliable `pip install mgba` for linux/amd64 (see TASKS.md "Plan corrections"). |
| Butano | commit `38349d524e6f20499bd8c88e2b502db9646ed969` (the commit already vendored as a submodule at `/c/Dev/GBA-Game/external/butano`) | zlib-licensed, clean. Cloned fresh in the Dockerfile rather than copied from the host checkout, so the Docker build context stays entirely inside `toolchain/`. |
| Python | 3.11.2 (from the base image) | Matches devkitPro's Debian 12 base; no separate Python install needed. |

Bump any of these by editing the `ARG MGBA_COMMIT` / `ARG BUTANO_COMMIT` in
`Dockerfile`, or the `FROM ...@sha256:...` line for the base image, and
rebuilding.

**Built image**: `gba-studio-toolchain:dev`, **2.32 GB**. (Butano's commit
`38349d52...` happens to correspond to its own `21.7.0` tag, confirmed via
the container's `git log` output during build — noted here in case a
Butano-version-string is more useful to cross-reference than the raw SHA.)

## The libmgba de-risking (why the Dockerfile looks the way it does)

This was the riskiest part of the image and was proven **before** anything
else was assembled, per the task brief. Approach that worked: **mGBA built
from source with CMake `-DBUILD_PYTHON=ON`**, not `hanzi/libmgba-py` or
`pygba` — the from-source build worked cleanly once two non-obvious issues
were fixed, so there was no need to fall back to a prebuilt wheel:

1. **`cmake --build --target mgba-py` already produces a complete,
   importable Python package.** It runs `setup.py build` internally and
   drops a full `mgba/` package (pure-Python sources + the `_pylib.abi3.so`
   cffi extension) under `<build-dir>/python/lib.linux-x86_64-cpython-311/`.
   A separate `pip install .` re-invoked from the source tree does **not**
   work — it's missing build-generated headers (`mgba/flags.h` etc. only
   exist in the build dir) and fails with a confusing cffi/cpp preprocessor
   error. The fix is to skip that step entirely and just put the cmake
   build output on `PYTHONPATH`.
2. **`USE_FFMPEG=OFF` breaks the Python extension at import time**, not at
   build time: `src/gba/cart/ereader.c` wraps roughly 800 lines — including
   the *unconditionally* cffi-exposed `EReaderScanLoadImage`/
   `EReaderScanLoadImageA` functions — inside `#ifdef USE_FFMPEG`. With
   FFmpeg off, `libmgba.so` silently omits those two exported symbols, and
   `import mgba.core` fails with `undefined symbol: EReaderScanLoadImageA`.
   The fix is to leave `USE_FFMPEG` on (mGBA's own default) and install the
   handful of `libav*-dev` / `libsw*-dev` packages — cheaper and safer than
   patching vendored upstream source.

Every other optional subsystem is turned off for a smaller, faster,
headless-only build: `BUILD_QT`, `BUILD_SDL`, `BUILD_LIBRETRO`, `USE_LUA`,
`USE_DISCORD_RPC`, `USE_LIBZIP`, `USE_GDB_STUB`, `USE_EDITLINE`, `BUILD_LTO`
are all `OFF`.

**Proof:** `toolchain/proof/verify_smoke.py` loads a real ROM
(`BrickBreakerGBA.gba`, copied from `GBA-Game/BrickBreak/`), installs a log
callback (`mgba.log.Logger` subclass), runs 300 frames headless with no
video/audio backend attached, and prints every captured log line plus the
final `PC`/`SP`/`LR` register values. It is built into the image and runs as
the last build step (so a broken libmgba runtime fails the `docker build`
itself), and can be re-run any time:

```bash
docker run --rm gba-studio-toolchain:dev python3 /toolchain/proof/verify_smoke.py
```

This is **not** `verify_rom.py` (P0-V1, not yet built) — it only proves the
libmgba + Python runtime works end to end. See "Seams" below.

## Butano build entrypoint

Butano projects are canonically built with `make`. The vendored library
lives at `/opt/butano/butano` inside the image. Butano's own `examples/`
(vendored alongside it at `/opt/butano/examples/`) already point at it via
the relative `LIBBUTANO := ../../butano` in their Makefiles, so they build
as-is:

```bash
docker run --rm gba-studio-toolchain:dev bash -c \
  "cd /opt/butano/examples/log && make -j\$(nproc)"
```

**Verified** (this pass): `examples/log` compiles cleanly and produces a
`gbafix`-fixed, valid GBA ROM (`log.gba`, 155104 bytes, correct GBA header —
starts with `2e 00 00 ea` / the standard Nintendo logo bytes that every
legitimate GBA ROM header carries — not a BIOS, just the public boot-logo
checksum data).

For a project *outside* `/opt/butano/examples` (e.g. a user's own project
mounted or copied into the container), point `LIBBUTANO` at the vendored
path explicitly: `make LIBBUTANO=/opt/butano/butano`.

## Seams left for later tasks

- **P0-V1 (`verify_rom.py`)** and **P0-FX1 (known-good / known-bad-OAM
  fixture ROMs)** do not exist yet — they are separate, not-yet-built tasks.
  The `Dockerfile` has a comment block marking exactly where to `COPY` them
  in once they land, and where to wire the CI smoke suite (P0-A2) that will
  run them against this image.
- `toolchain/proof/verify_smoke.py` is deliberately **not** `verify_rom.py`
  — it has no pass/fail taxonomy (see `docs/verify-taxonomy.md`), it just
  proves the runtime works. Don't extend it in place; author `verify_rom.py`
  fresh under P0-V1 against the taxonomy doc, using this script's log-capture
  pattern as a reference for the libmgba API shape.

## Licensing note (for P0-LIC)

- **devkitPro**: the base image bakes in devkitARM + the `gba-dev` tool
  group. devkitPro's tooling is FOSS but the project has a documented
  history of objecting to third-party redistribution of its own package
  repo/hosting. This image must stay **private/local-only** until P0-LIC
  resolves a written determination from devkitPro. Nothing here pushes to
  any registry.
- **mGBA**: MPL-2.0. Built unmodified from upstream source at a pinned
  commit; no local patches were needed (the FFmpeg fix above is a build
  *configuration* change, not a source patch). Clean.
- **Butano**: zlib-licensed. Clean, vendored unmodified at a pinned commit.
- **No `gba_bios.bin` anywhere in this image or its build.** mGBA needs no
  Nintendo BIOS (HLE BIOS built in) — this is the one bright line with
  Nintendo per SYSTEM_PLAN §4.3, and nothing in this Dockerfile fetches,
  bakes in, or accepts one.
