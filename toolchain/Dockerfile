# gba-studio toolchain image (P0-A1) — libmgba-first, linux/amd64 only.
#
# Contains: devkitARM + GBA dev tools (grit/mmutil/gbafix), Butano (vendored
# at a pinned commit), Python 3, headless mGBA with Python bindings (built
# from source), git, make.
#
# Every input is pinned — see toolchain/README.md for the exact version
# table and the rationale for each pin. This image is PRIVATE / local-only;
# do not push to any registry (P0-LIC, devkitPro licensing, is unresolved —
# SYSTEM_PLAN.md §4.3).
#
# Build (context is the REPO ROOT, not this dir — P0-A2 needs to COPY in
# verify_rom/ and fixtures/, both siblings of toolchain/):
#   docker build -f toolchain/Dockerfile -t gba-studio-toolchain:dev .
#
# ---------------------------------------------------------------------------
# Base: official devkitPro devkitARM image, pinned by digest. This already
# includes devkitARM, grit, mmutil, gbafix (the gba-dev pacman group), git,
# make, cmake, and python-is-python3 — reassembling devkitARM from pacman by
# hand is strictly more risk for no benefit (SYSTEM_PLAN §1.1 lazy-path call).
FROM devkitpro/devkitarm@sha256:116afba8df8453961de2936ffab20dd441edf4d682856c1ec8b0e53d7ed0bbf5

# ---------------------------------------------------------------------------
# mGBA build dependencies.
#
# mGBA is built from source with -DBUILD_PYTHON=ON (there is no reliable
# `pip install mgba` for linux/amd64 — TASKS.md "Plan corrections"). Python
# bindings use cffi, not SWIG. USE_FFMPEG is left ON (mGBA's default): the
# e-reader card-scan helpers (EReaderScanLoadImage/A) are compiled
# unconditionally into the Python cffi bindings but their *implementation* in
# src/gba/cart/ereader.c is itself wrapped in `#ifdef USE_FFMPEG` for ~800
# lines — turning FFmpeg off produces a shared lib that is missing those two
# exported symbols, so the Python extension fails to dlopen with
# `undefined symbol: EReaderScanLoadImageA`. Installing the ffmpeg dev libs
# is far cheaper than patching vendored upstream source.
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential cmake zlib1g-dev libpng-dev libsqlite3-dev libelf-dev \
      python3-dev python3-pip pkg-config ca-certificates \
      libavcodec-dev libavfilter-dev libavformat-dev libavutil-dev \
      libswscale-dev libswresample-dev \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --break-system-packages --no-cache-dir cffi cached-property wheel setuptools

# ---------------------------------------------------------------------------
# mGBA — pinned at tag 0.10.5 (commit 26b7884bc25a5933960f3cdcd98bac1ae14d42e2).
ARG MGBA_COMMIT=26b7884bc25a5933960f3cdcd98bac1ae14d42e2
RUN git clone https://github.com/mgba-emu/mgba.git /src/mgba \
    && git -C /src/mgba checkout ${MGBA_COMMIT}

# Headless-only build: no Qt/SDL frontends, no libretro core, no in-process
# debugger stub/CLI (not needed for a scripted headless verifier), LTO off
# (link-time-only issue, unrelated to the FFmpeg symbol problem above, but
# disabled to keep the build deterministic and fast).
RUN cmake -S /src/mgba -B /src/mgba-build -G "Unix Makefiles" \
      -DCMAKE_BUILD_TYPE=Release \
      -DBUILD_PYTHON=ON \
      -DBUILD_QT=OFF \
      -DBUILD_SDL=OFF \
      -DBUILD_LIBRETRO=OFF \
      -DUSE_LUA=OFF \
      -DUSE_DISCORD_RPC=OFF \
      -DUSE_LIBZIP=OFF \
      -DUSE_GDB_STUB=OFF \
      -DUSE_EDITLINE=OFF \
      -DBUILD_SHARED=ON \
      -DBUILD_LTO=OFF \
    && cmake --build /src/mgba-build -j"$(nproc)" --target mgba-py

# cmake's `mgba-py` target already runs `setup.py build` and produces a
# complete importable package (pure-Python sources + the _pylib.abi3.so cffi
# extension) under mgba-build/python/lib.*/mgba. A separate `pip install .`
# re-invoking setup.py from the source tree does NOT work here — it's
# missing build-generated headers (mgba/flags.h etc live only in the build
# dir) and fails with a confusing cffi/cpp error. Just put the build output
# on PYTHONPATH.
ENV PYTHONPATH=/src/mgba-build/python/lib.linux-x86_64-cpython-311
RUN python3 -c "import mgba.core, mgba.log; print('mgba python bindings OK')"

# ---------------------------------------------------------------------------
# Butano — vendored at a pinned commit (zlib-licensed, clean).
ARG BUTANO_COMMIT=38349d524e6f20499bd8c88e2b502db9646ed969
RUN git clone https://github.com/GValiente/butano.git /opt/butano \
    && git -C /opt/butano checkout ${BUTANO_COMMIT}

# ---------------------------------------------------------------------------
# Never ship/accept a Nintendo BIOS image — mGBA runs fine on its HLE BIOS.
# This is a hard line (SYSTEM_PLAN §4.3), not a build step; left as a
# documented invariant rather than an enforceable Dockerfile instruction.

WORKDIR /toolchain

# P0-A1 proof only (NOT verify_rom.py — see below): a minimal script that
# proves the libmgba headless runtime + Python bindings work end to end,
# using a real ROM copied in from GBA-Game/BrickBreak.
COPY toolchain/proof /toolchain/proof

# ---------------------------------------------------------------------------
# P0-A2: bake in verify_rom.py (P0-V1) and the P0-FX1 fixtures, then prove
# the whole build->verify loop works INSIDE the image, the same way the
# libmgba proof above does — a regression fails `docker build` itself, not
# a later CI step. Build context is the repo root (see toolchain/README.md),
# not this directory, so these paths reach the siblings of toolchain/.
COPY verify_rom /toolchain/verify_rom
COPY fixtures /toolchain/fixtures

# Known-good must build and PASS verify (zero GAME_ERROR lines). `make
# clean` first: fixture dirs carry committed build/ output for local dev
# convenience, and Docker COPY resets mtimes, which could otherwise fool
# make's incremental build into skipping a real compile.
#
# `|| true` after verify_rom.py: it exits 1 on a FAIL verdict by its own
# convention (verify_rom/verify_rom.py), which would otherwise short-circuit
# this && chain before the assertion below ever runs — for known-bad-oam
# below, a FAIL is the *expected, correct* verdict, so its own exit code
# must not be the thing that decides whether this RUN step passes.
RUN cd /toolchain/fixtures/known-good \
    && make LIBBUTANO=/opt/butano/butano clean \
    && make LIBBUTANO=/opt/butano/butano \
    && (python3 /toolchain/verify_rom/verify_rom.py known-good.gba --frames 300 --json > /tmp/known-good.json || true) \
    && python3 -c "import json,sys; sys.exit(0 if json.load(open('/tmp/known-good.json'))['pass'] else 1)"

# Known-bad-OAM must build and FAIL verify (this is the moat: proves the
# harness actually catches the illegal-hardware-write bug class, not just
# that it passes clean code).
RUN cd /toolchain/fixtures/known-bad-oam \
    && make LIBBUTANO=/opt/butano/butano clean \
    && make LIBBUTANO=/opt/butano/butano \
    && (python3 /toolchain/verify_rom/verify_rom.py known-bad-oam.gba --frames 300 --json > /tmp/known-bad-oam.json || true) \
    && python3 -c "import json,sys; sys.exit(0 if not json.load(open('/tmp/known-bad-oam.json'))['pass'] else 1)"

CMD ["bash"]
