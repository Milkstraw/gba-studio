# gba-studio — Build Tasks

Approved task list (Phase 1 PLAN, approved). Authoritative execution tracker.
Source of truth for *what* to build is `SYSTEM_PLAN.md`; this file tracks
*status*. Update the Status column as work proceeds.

Status legend: `todo` · `in-progress` · `built` (acceptance passed) ·
`verified` (independent fresh-context verifier passed) · `signed-off`
(gate cleared by user) · `blocked`.

Model = build-team assignment (who builds gba-studio), **not** the product's
runtime model routing (§1.2). Path: `SEQ` = interface/contract others depend
on (lock before fan-out); `PAR` = self-contained leaf. Gate ✋ = needs user
sign-off before proceeding past it.

---

## Phase 0 — Foundation (full resolution)

| ID | Title | Ref | Deps | Path | Model | Gate | Status |
|---|---|---|---|---|---|---|---|
| P0-C1 | Exec/file adapter contract | §1.9, §1.2 | — | SEQ | Opus | ✋ | signed-off (8cbcf32) |
| P0-V1 | `verify_rom.py` package + fixtures (author) | §1.1, §4.3 | — | SEQ | Opus | ✋ | verified — awaiting sign-off |
| P0-F1 | `gba-dev` footgun reference doc (author) | §1.2 | — | PAR | Sonnet | — | todo |
| P0-FX1 | Known-good sample + known-bad OAM fixture ROMs | §1.1 | — | PAR | Sonnet | — | built (definitive verify = V1 run) |
| P0-A1 | Toolchain Dockerfile, inputs pinned | §1.1 WS-A | P0-V1, P0-FX1 | SEQ | Sonnet | — | built: substrate + libmgba validated vs fixtures (verify_rom bake → A2) |
| P0-A2 | GHA build → GHCR (private) + baked smoke suite | §1.1 WS-A | P0-A1, P0-FX1, P0-V1 | PAR | Sonnet | — | verified (Opus) — see carried note |
| P0-A3 | Rollback (last-green digest pinning) | §1.1 WS-A | P0-A2 | PAR | Haiku | — | todo |
| P0-LIC | devkitPro licensing determination (written) | §4.3 WS-C | — | PAR | Opus (draft)/user | ✋ | todo |
| P0-C2 | Wonderful Toolchain variant image | §4.3 WS-C | P0-A1 | PAR | Sonnet | — | todo |
| P0-B1 | Fly Machines spike + timings + snapshot + auth-reject | §1.7 WS-B | P0-A2 | PAR | Sonnet (Opus rev) | ✋ | todo |
| P0-L1 | Local exec/file adapter (impl of P0-C1) | §1.9 | P0-C1, P0-A1, P0-V1 | PAR | Sonnet | — | verified (Opus) — see carried note |
| P0-L2 | Local control-plane stubs (PG/S3→FS/git bare) | §1.9 | — | PAR | Sonnet | — | todo |
| P0-L3 | Token-metering logging util | §1.9, §4.5 | — | PAR | Haiku | — | todo |
| P0-W1 | mGBA-WASM spike (gbajs3) | §1.3 | P0-FX1 | PAR | Sonnet | ✋ | signed-off (GO: @thenick775/mgba-wasm@2.4.1) |
| P0-E1 | End-to-end script: source→ROM→verify→shot, local+Fly | §3 exit | P0-L1, P0-B1, P0-V1 | SEQ | Sonnet (Opus verify) | ✋ | todo |

## Phase 1 — Single-user MVP (full resolution)

| ID | Title | Ref | Deps | Path | Model | Gate | Status |
|---|---|---|---|---|---|---|---|
| P1-P1 | WebSocket session protocol contract | §1.6 | P0-C1 | SEQ | Opus | ✋ | todo |
| P1-P2 | Agent tool-set ↔ adapter binding + mandatory-loop hook | §1.2 | P0-C1 | SEQ | Opus | ✋ | todo |
| P1-CP1 | Control-plane skeleton: sessions, git repos, WS server | §1.1 | P1-P1, P0-L2 | PAR | Sonnet | — | todo |
| P1-CP2 | Agent runner (Claude SDK), full tool set, PG threads | §1.2 | P1-P2, P1-CP1, P0-L1 | PAR | Sonnet (Opus rev) | — | todo |
| P1-CP3 | Two-tier model routing + prompt caching | §1.2, §4.5 | P1-CP2 | PAR | Opus | — | todo |
| P1-CP4 | Mandatory build+verify+shot loop + dirty-hook + gba-dev | §1.2 | P1-CP2, P0-F1, P0-V1 | SEQ | Opus | ✋ | todo |
| P1-CP5 | Auto-commit at checkpoints | §1.2 | P1-CP1, P1-CP4 | PAR | Sonnet | — | todo |
| P1-AS1 | Constraint validator (tool + result schema) | §1.4 | P0-C1 | PAR | Sonnet (Opus rev) | — | todo |
| P1-AS2 | `import_asset`: PNG→grit→Butano | §1.4 | P1-AS1, P0-A1 | PAR | Sonnet | — | todo |
| P1-AS3 | Procedural-gen library | §1.4 | — | PAR | Sonnet | — | todo |
| P1-T1 | One genre starter template | §1.10 | P0-A1 | PAR | Sonnet (Opus rev) | — | todo |
| P1-FE1 | Frontend shell (chat/Monaco/emulator/asset/status) | §1.6 | P1-P1, P0-W1 | PAR | Sonnet | — | todo |
| P1-FE2 | ROM download from UI | §1.5 | P1-FE1, P1-CP1 | PAR | Haiku | — | todo |
| P1-M1 | First-playable milestone (local) | §3 | CP+FE+T1 | SEQ | Opus (verify) | ✋ | todo |
| P1-M2 | Dogfood/MVP acceptance (local, UI-only) | §3 | P1-M1, P1-AS2 | SEQ | Opus (verify) | ✋ | todo |
| P1-LIFT | Lift loop local→Fly | §1.9 | P1-M1, P0-B1 | PAR | Sonnet | ✋ | todo |

## Phase 2 — Multi-tenant beta (outline; re-plan at entry)

| ID | Title | Ref | Deps | Model | Gate | Status |
|---|---|---|---|---|---|---|
| P2-AUTH | GitHub OAuth + magic link, per-user projects | §1.5 | P1 done | Opus + Sonnet | ✋ | todo |
| P2-ISO | VM isolation hardened (egress/quotas/daemon-auth/caps) | §1.7 | P1-LIFT | Opus | ✋ | todo |
| P2-BILL | Stripe two-meter billing, free/Pro tiers | §1.5 | P2-AUTH | Opus + Sonnet | ✋ | todo |
| P2-LIFE | Session suspend/resume, snapshots, reconnect | §1.2 | P2-ISO | Sonnet | — | todo |
| P2-GH | GitHub export via OAuth user-token | §1.5 | P2-AUTH | Sonnet | — | todo |
| P2-TMPL | Template system full build-out | §1.10 | P1-T1 | Sonnet (Opus rev) | — | todo |
| P2-OBS | Observability: traces, cost dashboards, alerting | §3 | P2-BILL | Sonnet | — | todo |
| P2-BETA | Closed beta 20–50 users | §3 | above | Opus (go/no-go) | ✋ | todo |

## Phase 3 — Production polish + art beta (outline; re-plan at entry)

| ID | Title | Ref | Deps | Model | Gate | Status |
|---|---|---|---|---|---|---|
| P3-ART | AI static-sprite beta (Retro Diffusion + pipeline) | §2.4 | P1-AS1 | Opus + Sonnet | ✋ | todo |
| P3-EMU | Emulator polish: save-states, gamepad, share links | §1.3, §3 | P0-W1 | Sonnet | ✋ | todo |
| P3-ONB | Onboarding, docs, template gallery | §3 | P2-TMPL | Sonnet | — | todo |
| P3-LOAD | Load/cost validation ~200 concurrent | §3, §4.5 | P2 done | Opus + Sonnet | — | todo |
| P3-LAUNCH | Public launch | §3 | all | Opus | ✋ | todo |

---

## Build sequence (waves)

**Phase 0**
- Wave 0 (SEQ lock): P0-C1 ✋
- Wave 1 (fan out): P0-V1 ✋ ∥ P0-F1 ∥ P0-FX1 ∥ P0-LIC ✋ ∥ P0-L2 ∥ P0-W1 ✋
- Wave 2: P0-A1 → P0-L1
- Wave 3: P0-A2 ∥ P0-C2 ∥ P0-L3 → P0-A3, P0-B1 ✋
- Wave 4 (SEQ exit): P0-E1 ✋

**Phase 1**
- Wave 5 (SEQ locks): P1-P1 ✋ ∥ P1-P2 ✋
- Wave 6: P1-CP1 ∥ P1-AS1 ∥ P1-AS3 ∥ P1-T1 ∥ P1-FE1
- Wave 7: P1-CP2 ∥ P1-AS2
- Wave 8: P1-CP3 ∥ P1-CP4 ✋ ∥ P1-CP5 ∥ P1-FE2
- Wave 9 (SEQ milestones): P1-M1 ✋ → P1-M2 ✋ → P1-LIFT ✋

Long poles: P0-LIC (async, must clear before image goes public in Phase 2, not
before Phase 1). P0-B1 + P0-W1 de-risking spikes.

## Open questions carried from PLAN (see SYSTEM_PLAN discussion)

1. Missing GBA-Game assets confirmed absent → P0-V1/F1/FX1 planned as author-from-scratch.
2. External creds needed by task: Anthropic key (P1-CP2), Fly token (P0-B1), GHCR (P0-A2).
3. P0-LIC requires user to contact devkitPro; Opus drafts, user sends.
4. Local Docker present (Docker 27); local adapter can use the image. Fallback: native `C:\devkitPro`.

## Plan corrections (flagged, awaiting ack)

- **libmgba is NOT a reliable `pip install mgba`** (SYSTEM_PLAN §1.1/§1.2 wording
  is optimistic). Confirmed: no `mgba` PyPI distribution for Windows/Py3.13; the
  PyPI package "may not be available for all platforms." Robust acquisition =
  **build mGBA from source with CMake `-DBUILD_PYTHON=ON`** (pinnable, linux/amd64)
  inside the toolchain image (P0-A1). Evaluate `hanzi/libmgba-py` (prebuilt bins,
  possible native-Windows shortcut) and `pygba` when scoping V1/A1. Affects
  P0-V1 and P0-A1 scope.
- **Local verify is containerized on Windows.** Native Windows libmgba unavailable,
  so the local adapter's build+verify runs in the Linux toolchain image (matches
  §1.9 "same image locally"). **Requires Docker daemon running** (Docker Desktop
  was stopped at check time).

## Carried notes (from verification)

- **Deferred (class-D′ liveness/hang):** verify_rom v1 does not detect infinite
  loops/deadlocks (a BIOS-idle game is indistinguishable from a BIOS-parked hang
  by CPU snapshot alone). Follow-up: add a `known-bad-hang` fixture + a
  frame-hash/VCOUNT-progress watchdog. Spec aligned in docs/verify-taxonomy.md.

- P0-L1 (local adapter): reject Windows reserved device names (`nul`, `con`,
  `aux`, `com1`, ADS `name:stream`) when joining a jailed path onto the real
  win32 root. Not a jail escape (verifier confirmed), but a local-host-only
  footgun; the POSIX `/work` remote adapter is unaffected.

- **P0-L1 verified (independent, fresh-context, Opus).** `packages/adapter-local`
  implements `ExecFileAdapter` by shelling out per-call to `docker run`
  against `gba-studio-toolchain:dev`; `verify_rom/` is bind-mounted read-only
  into the container rather than baked in (P0-A2 will bake it in, at which
  point the mount can be dropped). New `verify_rom/screenshot_rom.py` (not a
  separate TASKS.md item — it's the screenshot half of the adapter contract)
  captures frames via `mgba.image.Image.save_png`; needed a close-safe
  `BytesIO` subclass since libmgba's PNG writer calls `.close()` on the
  fileobj it's handed before the caller can read the bytes back out.
  `build()` locates the produced `.gba` by newest mtime in the project root
  rather than assuming a filename from `TARGET`, since that's
  project-Makefile-defined. Verifier confirmed path-jailing, the
  errors-as-values discipline, the "build failure is a successful call"
  rule, and the TIMEOUT/TRANSPORT/INVALID/NOT_FOUND mapping choices in
  `adapter.ts` all hold up, via a real (not mocked) `docker run` against the
  P0-FX1 known-good fixture plus adversarial checks (`--network none`
  egress, shell-metacharacter injection).
  **Finding, fixed post-verification:** the jailed `romPath` was interpolated
  into the `bash -lc` command string for `verifyRom`/`screenshot` without
  shell-quoting — path-jailing blocks directory escapes but not shell
  metacharacters in a filename (verifier's PoC: `poc$(touch PWNED).gba`
  executed the substitution in-container). Fixed with a `shellQuote` helper
  in `adapter.ts`; regression test added (`adapter.test.ts`, "shell
  metacharacters in a romPath are not executed") confirms the substitution
  no longer runs. The verify_rom mount was also switched to `:ro` as cheap
  defense-in-depth. Low severity as scoped (the only caller already has
  arbitrary `bash()` in the same container) but worth carrying forward: if
  this adapter is ever composed behind a less-trusted caller, re-audit for
  other unescaped interpolation into shell command strings.
  Windows reserved device names remain unfixed (separate carried note above).

- **P0-A2 verified (independent, fresh-context, Opus).** the build context for
  `toolchain/Dockerfile` moved from `toolchain/` to the **repo root**
  (`docker build -f toolchain/Dockerfile -t gba-studio-toolchain:dev .`) so
  it can `COPY` in `verify_rom/` and `fixtures/`, which are siblings of
  `toolchain/`. A root `.dockerignore` keeps that context small and —
  important — excludes fixture `build/`/`*.gba`/`*.elf` output, forcing a
  real from-source rebuild inside the image rather than risking a stale
  pre-built artifact. The smoke suite is baked into the Dockerfile as the
  last two `RUN` steps (same pattern as P0-A1's libmgba proof): known-good
  must build and `verify_rom` must report `pass:true`; known-bad-oam must
  build and `verify_rom` must report `pass:false` (the actual moat proof —
  confirmed catching `Cannot Store8 to OAM`). A regression in either fails
  `docker build` itself; the GHA workflow's only job is to run that same
  build, so a green build == a green smoke suite, no separate CI step to
  keep in sync.
  **Debugging note worth carrying forward:** `make clean` against these
  fixtures behaves differently depending on how the files reach the
  container — it fails ("No rule to make target 'clean'", butano.mak
  genuinely defines no clean target) when the fixture directory is a Docker
  **bind mount** (`docker run -v host:/work`), but succeeds when the same
  files are baked in via `COPY` (a real image layer). Cost real debugging
  time chasing what looked like a fixture regression before landing on the
  actual bug (below). Root cause not fully characterized — plausibly a
  Docker Desktop bind-mount filesystem quirk affecting some make internal
  (`.d`-file remake rule, mtime comparison) — but reproducible and
  consistent both directions. If a future task needs `make clean` to work
  against a *bind-mounted* project (e.g. extending P0-L1), don't assume
  parity with the baked-image behavior; verify directly.
  **Actual bug found and fixed:** the initial Dockerfile smoke-test RUN
  steps `&&`-chained directly after `verify_rom.py --json`, which exits 1
  on a FAIL verdict by its own convention (`verify_rom/verify_rom.py`) —
  for known-bad-oam, FAIL is the *correct, expected* verdict, so its exit
  code was silently aborting the chain before my own pass/fail assertion
  ever ran, making a correctly-working verifier look like a build failure.
  Fixed with `|| true` after the verify_rom.py invocation in both RUN
  steps, so the trailing Python assertion is what actually decides each
  step's outcome.
  **GHCR push is gated behind a manual `workflow_dispatch` boolean input**
  (`push_to_ghcr`, default `false`) — an ordinary push/PR only builds and
  smoke-tests, never publishes. This is deliberate: P0-LIC (devkitPro
  licensing determination) is still `todo`, and `toolchain/README.md`
  documents "do not push this image to any registry" until it resolves.
  Nothing in this task pushes the branch to GitHub or triggers the
  workflow — that, and any future decision to flip `push_to_ghcr` on, is
  the user's call, not something to do by default even after P0-A2 is
  merged.
  Verifier independently re-ran the smoke-suite logic fresh inside the
  container (not trusting a cached `docker build`, since the layers had
  cache-hit on the verifier's own machine) and confirmed: `verify_rom.py`'s
  exit-1-on-FAIL claim is real (checked against its own docstring/`main()`),
  both Dockerfile assertions are correctly oriented (not inverted), the
  smoke suite genuinely fails the build under a simulated regression (not a
  no-op), the infra-crash edge case (`verify_rom.py` erroring before
  producing JSON) still correctly fails the build rather than false-passing,
  and the GHCR-push `if:` gate cannot be reached by a plain push/PR.
  **Two non-blocking nits found and addressed:** a stray untracked local
  directory (`fixtures/known-good/known-good.gba;C`, empty, an artifact of
  earlier manual debugging — not a code defect, not present in a fresh
  checkout) was removed from the working tree; and `permissions:
  packages: write` was scoped from workflow-wide down to just the gated
  `push` job (split into its own job rather than a step in `build`, so the
  token only exists on the rarely-triggered manual-publish path — the
  always-running `build` job that responds to every push/PR no longer
  holds a registry-write token it never uses). The `push` job rebuilds the
  image rather than passing it from `build` via artifacts — simpler, and
  the rebuild cost is a non-issue on a manual-dispatch-only path.

