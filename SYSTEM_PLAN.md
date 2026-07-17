# gba-studio — System Plan

Working document. Expands `README.md` into an executable architecture and
roadmap. Where the README is silent, decisions are made and marked
**[Decision]** with a one-line rationale — argue with those first.

Stakes assumed: a paid product (~$100k/yr operating budget) producing GBA
games at real quality/volume, not a weekend prototype. That budget shapes
several calls below: managed infra over self-hosted Kubernetes, buy over
build for auth/billing, and LLM token cost treated as the dominant line item.

---

## 1. System architecture

### 1.0 One-paragraph shape

A browser SPA talks over WebSocket to a thin **control plane** (API server +
Postgres + object storage). Each active editing session gets its own
**ephemeral microVM** containing the full toolchain (devkitARM + Butano +
grit + headless mGBA) and the user's project checkout. The **agent** (Claude
Agent SDK) runs inside the control plane and drives the session VM through a
small, fixed tool set: edit files, run build, run `verify_rom`, capture
screenshots. Compiled ROMs stream back to the browser, where an **mGBA-WASM
emulator** runs them client-side for instant preview. Projects persist as
**git repositories**; everything else in the VM is disposable.

```
┌──────────────────────── Browser ────────────────────────┐
│  Chat panel   Code view (Monaco)   Asset panel   mGBA-  │
│      │              │                  │         WASM   │
└──────┼──────────────┼──────────────────┼───────────┼────┘
       │ WebSocket (agent events, file sync)         │ ROM bytes
┌──────▼──────────────────────────────────────────────────┐
│ Control plane (Node/TS)                                 │
│  - Session manager      - Agent runner (Claude SDK)     │
│  - Auth (GitHub OAuth)  - Billing (Stripe metered)      │
│  - Postgres (metadata)  - S3 (ROMs, assets, artifacts)  │
│  - Git host (bare repos)                                │
└──────┬──────────────────────────────────────────────────┘
       │ exec API (per-session, authenticated)
┌──────▼──────────────────────────────────────────────────┐
│ Session microVM (Fly Machine / Firecracker, 1 per       │
│ active session, no egress)                              │
│  toolchain image: devkitARM + Butano + grit + mmutil    │
│  + gbafix + libmgba/py + verify_rom.py + project files  │
└─────────────────────────────────────────────────────────┘
```

### 1.1 Component A — Toolchain container image (build this first)

The README is right that nothing else works without this. It is also the
component with the most hidden risk (licensing, §4.3), so treat it as a
deliverable with its own acceptance test, not a Dockerfile someone bangs out.

**Responsibilities**
- Reproducible image containing: devkitARM (or Wonderful Toolchain — see
  licensing risk), Butano (vendored at a pinned commit), `grit`, `mmutil`,
  `gbafix`, Python 3 + the `mgba` PyPI package (libmgba), `verify_rom.py`
  (ported from `GBA-Game/.claude/skills/gba-verify`), git, make.
- A canonical `make`-based build entrypoint the agent calls; no ad-hoc
  compiler invocations.
- A smoke-test suite baked into CI: build a known-good Butano sample, run it
  60 frames headless, assert zero `GAME_ERROR` log lines; build the
  known-bad OAM-corruption fixture ROM from `GBA-Game`, assert the harness
  *catches* it. If either fails, the image doesn't ship.

**[Decision] Build in GitHub Actions, publish to GHCR.** The README already
established the image must be built with real internet access; GHA is free
for public repos, gives provenance, and GHCR is the zero-friction registry.
Pin every input (devkitPro pacman package versions, Butano commit) so the
image is rebuildable byte-for-byte modulo timestamps.

**[Decision] Target `linux/amd64` only.** Fly/Firecracker hosts are amd64;
an arm64 variant is a later nicety, not a requirement.

**Acceptance:** `docker run image make -C /templates/butano-hello && docker
run image verify_rom out.gba --frames 300` passes in CI.

### 1.2 Component B — Agent backend

**[Decision] TypeScript + Claude Agent SDK, running in the control plane
(not inside the session VM).** The SDK holds the API key and the
conversation; the VM holds untrusted, agent-generated code. Keeping the key
and the loop outside the VM means a compromised build can't exfiltrate
credentials — the VM only ever sees file contents and shell commands, never
the Anthropic key. The agent talks to the VM over a narrow authenticated
exec/file API (Fly Machines exec, or a tiny agent-side daemon speaking JSON
over the VM's vsock/HTTP).

**Tool set (fixed, small — this is the whole product):**

| Tool | Backing | Notes |
|---|---|---|
| `read_file` / `write_file` / `edit_file` | VM FS under `/work` | path-jailed to the project dir |
| `bash` | VM shell, 60s default timeout | no network in VM, so this is safe-ish by construction |
| `build` | `make` via Butano's makefile | returns structured result: ok/fail + parsed compiler errors |
| `verify_rom` | headless mGBA, N frames | returns pass/fail + the mGBA `GAME_ERROR` log lines + final CPU/memory snapshot |
| `screenshot` | mGBA at frame N (or N,M,K) | returned as images *into the model's context* — Claude looks at its own game |
| `import_asset` | grit conversion + constraint check | see §1.4 |
| `glob` / `grep` | VM FS | standard navigation |

**The core loop that makes this product different:** after any code change
the agent is *required* (via system prompt + a hard hook: `write_file` to
`src/` marks the session dirty, and the turn cannot end while dirty without
a passing `build` + `verify_rom`) to build, verify, and screenshot before
declaring success. `gba-verify` catching the `Store8 to OAM` class of bugs
is the moat; the loop must make it impossible to skip. Screenshots going
back into context closes the *visual* loop too — "the sprite is drawn but
it's garbage tiles" is invisible to the log-based verifier and obvious in a
screenshot.

**[Decision] System prompt embeds the `gba-dev` footgun reference** (the
curated hardware-footgun doc from `GBA-Game`) as a first-class skill, loaded
per-session. It already exists and directly targets the failure mode the
product was founded on.

**[Decision] Route by task, not one model for everything.** Tokens are the
dominant cost (§4.5), so the agent uses a two-tier model split:
- **Small/fast model (Haiku-class)** for the mechanical, low-reasoning
  work: file-tree navigation (`glob`/`grep`), reading files for context,
  triaging build logs, parsing compiler errors into structured form,
  classifying whether a `verify_rom` failure is a code bug vs. an asset
  bug. This is the bulk of the tool calls and none of it needs a frontier
  model.
- **Large model (Opus/Sonnet-class)** for the actual reasoning: authoring
  and editing C++ game code, deciding what to change in response to a
  screenshot, planning multi-step features. Invoked only when reasoning is
  required.
- **Prompt caching is not optional.** The system prompt, the `gba-dev`
  skill, the toolchain/API reference, and the stable parts of the project
  (template code, unchanged files) are cached once and reused across every
  turn and every session — this is the single biggest token lever, applied
  before model routing even matters. The router and the cache together are
  what make the per-user economics in §4.5 work.

**Session model:** one agent session ↔ one VM ↔ one project checkout.
Conversation history persists in Postgres (per-project threads).
Interrupted/idle sessions: VM suspended after 5 min idle, destroyed after
60; on resume, re-clone from git + replay uncommitted workspace snapshot
from S3.

**[Decision] The agent commits to git at natural checkpoints** (each
successful build+verify with meaningful changes), with generated messages.
Git *is* the undo system, the sync system, and the audit log. No bespoke
snapshotting layer.

### 1.3 Component C — Live preview (mGBA-WASM)

**Feasibility answer the README asked for: yes, with a caveat.** There is no
official upstream mGBA WASM target, but **gbajs3** (github.com/thenick775/
gbajs3) maintains an actively-updated WASM build of real mGBA (not a
reimplementation) with a documented JS API, and **EmulatorJS** ships an
mGBA libretro core compiled to WASM as a fallback. Both are proven in
production sites.

**[Decision] Use the gbajs3 mGBA-WASM core, vendored and pinned**, with
EmulatorJS as the documented fallback if the fork goes stale. Budget one
week early in Phase 1 for a hard spike: load a Butano ROM, 60fps, audio,
save states, keyboard input. If the spike fails, EmulatorJS; if that fails,
server-side mGBA streaming frames over WebRTC is the emergency exit (worse
latency, real cost, but known-possible).

**Flow:** control plane pushes the built `.gba` (typically 1–8 MB) to the
browser over the existing WebSocket; the emulator hot-swaps the ROM. There
is deliberately **no** frame-level server round-trip — the server-side mGBA
is the *verifier*, the client-side mGBA is the *preview*, and they are the
same emulator core, which is exactly why what the agent verified is what the
user sees.

**Also ship:** save-state download/upload (mGBA save states, so a user can
hand the agent "the game is broken *at this point*" — load state
server-side, verify from there). This is cheap and is a genuinely
differentiating debugging affordance.

### 1.4 Component D — Asset pipeline (v1 scope per README, plus the validator)

**Responsibilities**
- PNG/Aseprite import → `grit` → GBA tile/palette C arrays or binary,
  wired into the Butano asset conventions (`graphics/*.bmp` + `.json`).
- **Constraint validator** (this is the important part, and it's shared
  with the AI-art work in §2): given an image + intended use (sprite bg,
  4bpp/8bpp, target OBJ size), report — palette count per 16-color bank,
  tile alignment, dimensions vs. legal OBJ sizes (8×8…64×64), VRAM/palette
  budget vs. what the project already uses, transparent-color-index
  correctness. Hard errors vs. warnings. Runs in the VM, exposed both as an
  agent tool and as instant UI feedback on upload.
- VRAM/palette budget dashboard per project (sum of imported assets vs.
  hardware limits) — prevents the classic "worked until asset #12" failure.
- Basic procedural generation as promised: solid/gradient tiles, palette
  ramp editing, simple geometric sprites. Implemented as a small library the
  agent can call, not a UI feature.

**[Decision] No custom pixel editor in v1** (README already leaned here —
confirmed). Integrate: "Open in Piskel" (web, MIT-licensed, embeddable) for
quick edits, and document the Usenti/Aseprite → import loop for real work.
A tile-aware editor is a v2/v3 feature gated on user demand.

### 1.5 Component E — Storage, auth, projects

- **Projects are bare git repos** hosted by the control plane (plain `git`
  over an internal HTTP endpoint; libgit2 not needed). Users can connect
  their GitHub and push/export — **[Decision]** using the OAuth user-token
  flow, not a GitHub App installation token, exactly because of the
  `POST /user/repos` limitation already documented in the README.
- **Postgres** (managed — Neon or Fly Postgres): users, projects, sessions,
  conversation threads, billing meters, asset metadata.
- **S3-compatible object storage** (Tigris on Fly, or R2): built ROMs,
  screenshots, save states, uncommitted-workspace snapshots, image assets.
- **ROM export.** The compiled artifact is a standard `.gba` binary; the
  finished ROM is always downloadable as a plain file (playable on real
  hardware via flash cart, or in any GBA emulator). This is a first-class,
  day-one affordance — build-from-source only, never a ROM *upload* (§4.4).
  mGBA save states are likewise exportable (§1.3). The shareable read-only
  "play this ROM in the browser" link is the Phase-3 growth layer on top of
  this same artifact.
- **Auth: [Decision] GitHub OAuth + email magic link via a library
  (better-auth / Auth.js), self-hosted.** The audience is developers; GitHub
  covers 95%. Clerk/WorkOS would cost real money at scale for no
  differentiation. Add Google later if funnel data demands it.
- **Billing: [Decision] Stripe, metered.** Two meters: *agent tokens*
  (dominant cost, passed through with margin) and *VM-minutes*. Plans:
  free tier (small monthly token grant, throttled VM), Pro ($20–40/mo with
  included usage + overage), Team later. Do not invent credits/points; bill
  the two real costs.

### 1.6 Component F — Frontend shell

**[Decision] React + Vite + TypeScript SPA.** Boring, hireable, and Monaco/
xterm/WASM-emulator integrations are all best-documented in React.

Panels: chat (agent stream with tool-call rendering — show builds, verify
results, and screenshots inline in the transcript), Monaco code view with
file tree (read/write, but the agent is the primary author), emulator panel
(gbajs3 core + gamepad/keyboard mapping + save states), asset panel
(upload, validator results, VRAM budget), build/verify status bar.

Realtime: single WebSocket per session multiplexing agent events, file-change
notifications, and ROM delivery. File edits made by the user in Monaco are
written through to the VM and show up in the agent's next context.

### 1.7 Sandboxing & multi-tenant isolation (README gap — filled)

The threat model: the agent executes model-generated shell commands and
compiles model-generated C++ inside the session environment, and users can
prompt-inject their own sessions trivially. Assume the VM contents are
attacker-controlled.

- **[Decision] Isolation unit = Firecracker microVM per session, via Fly
  Machines.** Hardware-virtualized boundary (not shared-kernel containers),
  per-second billing, sub-second boot from a prepared image, and an exec API
  — this is almost exactly the product Fly sells. Self-hosting Firecracker
  or gVisor-on-K8s is a future cost optimization, not a v1 choice, given the
  budget. E2B/Modal are the managed alternates if Fly disappoints.
- **No network egress from session VMs. None.** The toolchain is baked in;
  builds need nothing from the internet. This single rule eliminates
  exfiltration, cryptomining callbacks, and SSRF in one stroke. Asset
  downloads/uploads flow through the control plane, which validates them.
- Resource caps per VM: 2 vCPU, 2 GB RAM, 5 GB disk, build timeout 120 s,
  verify timeout 60 s, session CPU-minute quota per plan tier.
- The VM-side daemon accepts commands only from the control plane
  (per-session token, minted at VM boot, never reused).
- Control plane treats *all* VM output (build logs, file contents) as
  untrusted text — rendered escaped in the UI, never eval'd, and prompt-
  injection-wise the blast radius is the user's own session only, because
  keys and other tenants live outside the VM boundary.

### 1.8 Build orchestration

Nothing exotic: builds run *inside* the session VM synchronously (Butano
projects compile in seconds-to-a-minute at this scale), invoked by the agent
tool or a UI button, serialized per session with a queue depth of 1
(latest-wins for UI-triggered builds). A separate lightweight job runner in
the control plane handles the few genuinely async jobs: VM
suspend/snapshot, git housekeeping, nightly image smoke tests, and (later)
batch art-pipeline jobs. **[Decision] Postgres-backed job queue
(pg-boss)** — no Redis/RabbitMQ until measured need.

### 1.9 Local development harness (build the whole loop before touching Fly)

**[Decision] The VM is reached only through a narrow exec/file interface,
and that interface has two implementations behind one contract.** The agent
never calls Fly directly; it calls an adapter with a fixed surface
(`write_file`, `read_file`, `bash`, `build`, `verify_rom`, `screenshot`).
Two implementations satisfy that contract:
- **Local adapter (dev):** a thin CLI/daemon on the developer's own machine
  that runs the *same* toolchain Docker image locally, writes to a temp
  project dir, shells out to the real `make` / `verify_rom` / libmgba, and
  returns the same structured results. No Fly, no cloud, no egress concerns.
- **Remote adapter (prod):** the same calls over Fly Machines' authenticated
  exec API to a per-session microVM (§1.7).

Because the agent code depends on the contract and not the transport,
swapping local→remote is a config change, not a rewrite.

**Why this ordering:** the entire product loop — chat → draft code → build →
verify → screenshot-into-context → iterate — can be built, run, and debugged
on one laptop for ~zero infra cost. You learn the expensive lessons (does the
mandatory verify loop create weird failure modes? does the agent actually
*look* at screenshots or just trust logs? how many tokens does "make me a
breakout game" really burn?) before spending a dollar on cloud VMs, auth, or
billing. Control-plane dependencies are stubbed locally: Postgres in Docker,
S3 replaced by the local filesystem, git repos as bare dirs on disk.

**Local token metering:** the Agent SDK returns token counts per call; log
them per session so cache-hit savings and the Haiku-vs-Opus cost split
(§1.2) are visible in dev, not discovered in production. This is the cheapest
possible place to tune the cost model in §4.5.

### 1.10 Templates & reusable patterns (the biggest lever on output quality)

The agent produces far better games faster when it *edits known-good code*
than when it authors from a blank file — so reusable code is a first-class
system component, not a Phase-2 afterthought.

- **Genre starter templates** (platformer, top-down, puzzle, shmup): each is
  a complete, compiling Butano project with the universally-shared machinery
  already written and proven — sprite/entity handling (position, velocity,
  collision), input mapping, basic physics (gravity, ground detection),
  camera-follow, and animation loops. "Make a platformer" forks the template
  and tunes it; it never reinvents jump physics.
- **[Decision] Parameterize the magic numbers.** Each template exposes its
  tunable constants (jump height, walk speed, gravity, sprite dimensions,
  scroll speed) as named, swappable parameters. "Platformer with a double
  jump and floatier gravity" becomes constant edits, not an engine rewrite —
  cheaper tokens, more reliable output.
- **Reusable pattern library:** a small Butano library of common subsystems
  (health/damage, collision layers, enemy-AI state machines, HUD elements)
  that templates and the agent *call into* rather than re-authoring each
  game. This is the durable answer to "why regenerate character health and
  movement every time?" — the answer is that it shouldn't be regenerated;
  it's library code the agent composes.
- **[Decision] Template authoring loop, modeled on Claude Code's skill
  creator.** Any finished game *or subsystem* can be promoted to a template
  from inside the product: "Save as template" snapshots the project
  structure, extracts/parameterizes its tunable constants, tags and
  describes it, and stores it. **Templates are bare git repos in the same
  git host as projects** — so versioning, forking, and rollback are free git
  operations and need no bespoke store. New projects fork from a template;
  the system prompt lists available templates plus their parameters so the
  agent picks the closest match and starts from proven code.

*Rollout:* one genre starter ships in Phase 1 (it's how the Breakout
dogfood milestone gets good). The remaining starters, the parameter
extraction, the pattern library, and the save-as-template authoring loop
land in Phase 2.

---

## 2. The AI pixel-art problem — assessment and a real position

### 2.1 Framing: it's three problems, not one

"AI draws your sprites" bundles three tasks with wildly different difficulty:

1. **Static single sprites/tiles** (a 16×16 potion, a 32×32 idle character,
   a tileset motif) under GBA constraints — ≤15 colors + transparent per
   4bpp palette bank, exact target dimensions, readable at 1× on a 240×160
   screen.
2. **Animation** — frame sets (walk cycles, attacks) that are
   *frame-coherent*: same character, same palette, same pixel identity,
   changing only what should change.
3. **Cohesion** — every asset in a game sharing one style and palette
   discipline so the game looks authored, not collaged.

Task 1 is largely tractable **today**. Task 2 is the actual unsolved
problem. Task 3 is medium-hard and mostly an engineering/conditioning
problem. The README's flag is correct but coarse — it treats all three as
one risk, and that over-scopes the pessimism.

### 2.2 Why raw text-to-image fails, precisely

General diffusion models fail GBA sprite work in specific, enumerable ways:
output at 1024² with anti-aliased "fake pixel" edges that don't sit on any
consistent grid; hundreds of near-duplicate colors instead of a 15-color
bank; soft shadows and gradients that quantize to mud; inconsistent
"pixel size" within one image; and no concept of tile boundaries or a
shared project palette. None of these are aesthetic judgments — every one
is *mechanically checkable*, which is the crucial observation.

### 2.3 The three approaches, evaluated

**(a) Post-processing/quantization pipeline over a general model.**
Generate large, then: detect the implied pixel grid (autocorrelation on
edges — well-understood), downsample by dominant-color-per-cell, quantize
to ≤15 colors (median cut is fine at these sizes), snap to target
dimensions, flatten alpha to the transparent index, then run the §1.4
constraint validator. Deterministic, cheap (milliseconds), and — key point —
it converts art generation into the same shape as code generation:
**generate → validate → score → retry**, the loop this product is built
on. Weakness: garbage in, garbage out. Quantization can't fix a
composition that was never sprite-like; on general-model outputs the
usable-result rate is poor (subjectively, roughly 1-in-5 to 1-in-10
attempts yields something shippable for simple objects, worse for
characters).

**(b) Fine-tuning / a specialized model.** This is more solved than the
README assumes. **Retro Diffusion** (Astropulse) is a commercial,
API-available model line fine-tuned specifically for pixel art, with
palette-constrained and small-canvas generation; it exists because exactly
this fine-tune works. Rolling our own: a LoRA/full fine-tune of Flux or
SDXL on 20–50k *properly licensed* sprite images with structured captions
(subject, size class, palette size, style tags, facing direction).
Compute is the cheap part — a serious LoRA run is $1–5k; a from-scratch
small pixel-native model (operating at actual 64×64 resolution, which
sidesteps grid detection entirely) is more like $20–50k and a specialist.
**The dataset is the hard and dangerous part**: the abundant sprite data
online is ripped from commercial games and is legally radioactive for a
revenue-generating product. A clean dataset means OpenGameArt CC0/CC-BY,
itch.io packs with explicit license purchase, commissioned style packs,
and synthetic augmentation (palette swaps, mirroring, recoloring) —
realistically weeks-to-months of curation to get to ~20k clean, captioned
images, and it will skew toward the styles those sources contain.

**(c) Hybrid (specialized generator + deterministic pipeline + scored
retry loop).** Generate with a pixel-art-tuned model conditioned on the
*project's existing palette and a style reference sheet*, post-process
through (a)'s pipeline, validate with §1.4, auto-score (palette compliance,
grid confidence, silhouette readability against background color), present
the top 3–4 candidates to the *user* to pick or reject, and feed the pick
back as the style reference for subsequent assets. Human-in-the-loop
selection is not an admission of failure — it converts a 20% hit rate into
a good UX, the same way code review does for Copilot.

For **animation** (task 2), the honest state of the art: frame-to-frame
coherence from diffusion models is unreliable; img2img-per-frame drifts;
video models don't respect pixel grids. The tractable near-term version is
*constrained* animation: generate one keyframe, then produce variants via
strong conditioning (skeletal/pose-guided pixel-art models exist in
research but not production quality), or procedural transforms (bobbing,
mirroring, sub-pixel shifts, palette cycling) that Butano can even do at
runtime. Full AI walk cycles that look professional: not this year, not
worth promising.

### 2.4 My actual position

**Hold the honest v1 scope — but the README's "revisit later" is too
passive. Build the validator and post-processing pipeline in v1 (you need
them for human-made assets anyway), and ship AI-assisted *static* sprite
generation as a clearly-labeled beta in v1.5 (roughly month 4–6), using
Retro Diffusion's API behind the hybrid loop from (c). Defer any in-house
fine-tune until the product has revenue and usage data. Do not promise AI
animation at all in the first year; offer procedural animation helpers
instead.**

Why this and not the alternatives:

- *Why not pure v1 abstinence:* the gap between "0% AI art" and "AI does
  static sprites with you picking from candidates" is enormous for the
  target user — a solo dev with no artist. It's also the most-asked-for
  feature this product will get, guaranteed. Task 1 + human selection is
  genuinely deliverable, and the constraint validator (which we must build
  regardless) is precisely the missing "gba-verify for art": it gives art
  the mechanical feedback loop the README says art lacks. That framing —
  *we can't verify beauty, but we can verify legality, and we can let the
  user verify beauty from a shortlist* — is the resolution of the README's
  open risk.
- *Why not an in-house fine-tune now:* $20–80k all-in (dataset + compute +
  eval + an engineer-quarter) to replicate something purchasable per-call
  today, before knowing whether users even accept the hybrid UX. Buy first,
  build when volume makes per-call pricing the bigger number or when the
  vendor's style range proves too narrow — both measurable signals, and the
  candidate-selection data the hybrid loop generates is *exactly* the
  preference dataset a future fine-tune would want. Shipping the API
  version first literally builds the training set for the in-house version.
- *Why not promise animation:* it's the one sub-problem where I'd bet
  against current models, and a demo that walks janky poisons trust in the
  parts that work. Procedural animation (which the GBA itself was built
  around — palette cycling, affine transforms, mirroring) covers a
  surprising fraction of what small games need and is fully verifiable.

Effort: validator + quantization pipeline ≈ 2–3 engineer-weeks (v1, shared
infra). Hybrid generation beta ≈ 4–6 engineer-weeks in v1.5 (API
integration, scoring, candidate UI, style-reference conditioning). In-house
fine-tune: explicitly deferred, revisit with data at month ~9; budget an
engineer-quarter + $5–15k if triggered (LoRA path, not from-scratch).

Failure modes to design for: vendor API changes/shutdown (keep the
pipeline model-agnostic — the post-processor and validator don't care what
generated the image); style expectations set too high by marketing (label
it beta, show real outputs, never cherry-pick in demos); licensed-content
leakage from the vendor's own training data (require user acknowledgment,
add a similarity check later if it becomes real); palette drift across a
project (the style-reference + shared-palette conditioning is the
mitigation, and the validator hard-fails bank overflows regardless).

---

## 3. Build roadmap

Respecting the README's constraint: container/toolchain first, and each
phase ends with something demonstrably working. Effort assumes ~1.5–2
strong engineers (or one engineer + heavy agent leverage). Total to
production-grade: ~6 months, consistent with the README's upper band.

### Phase 0 — Foundation (Weeks 1–3)

Phase 0 is three parallel workstreams, each with its own acceptance test.
Each is small and self-contained enough to hand off as a discrete unit of
work; "done" is defined for each so a builder knows exactly when to stop.

**Workstream A — Toolchain image (the blocking dependency).**
- Dockerfile assembling devkitARM (or Wonderful Toolchain — see C), Butano
  vendored at a pinned commit, `grit`, `mmutil`, `gbafix`, Python 3 +
  `mgba` (libmgba), `verify_rom.py`, git, make. Target `linux/amd64`.
- **Every input pinned** (devkitPro pacman package versions, Butano commit)
  so the image is byte-for-byte rebuildable modulo timestamps.
- **GitHub Actions workflow** that builds the image with real internet
  access and pushes to **GHCR (private** until licensing clears, §4.3).
- **Smoke-test suite baked into CI, two fixtures:** build the known-good
  Butano sample → run 60 frames headless → assert zero `GAME_ERROR` lines;
  build the known-bad OAM-corruption fixture from `GBA-Game` → assert the
  harness *catches* it. Either fixture failing blocks the image from
  shipping.
- **Rollback plan:** last-green image tag is retained; a failed nightly
  rebuild pins consumers to the previous digest rather than shipping broken.
- *Acceptance:* `docker run image make -C /templates/butano-hello && docker
  run image verify_rom out.gba --frames 300` passes in CI.

**Workstream B — Fly Machines spike (de-risk the session model).**
- Boot the toolchain image as a Machine; exec a build over the authenticated
  exec API; retrieve the ROM.
- **Measure and record:** cold-boot latency, suspend/resume latency (the
  5-min-idle → resume path from §1.2), and per-call exec latency for file
  writes and shell commands.
- **Workspace snapshot round-trip:** write files → snapshot to S3 → destroy
  the Machine → recreate → restore → confirm the project is intact and
  builds.
- Confirm the per-session token-minted daemon auth (§1.7) rejects commands
  not from the control plane.
- *Acceptance:* a recorded timings table + a passing snapshot round-trip;
  go/no-go on Fly vs. E2B/Modal recorded with the numbers behind it.

**Workstream C — Toolchain licensing determination (the sleeper risk).**
- Put the exact questions to devkitPro **in writing** (not a Slack thread):
  what their pacman packaging/hosting terms permit for an image baked into a
  commercial service and possibly distributed publicly, distinct from the
  GPL rights to the components themselves (§4.3).
- **Set a decision deadline** — this must resolve before the image is ever
  public.
- **Maintain a tested Wonderful Toolchain variant** of the image, pinned to
  the exact Butano commit it's verified against, as both leverage and
  fallback.
- *Acceptance:* a written go/no-go on public distribution, and a
  Wonderful-Toolchain image that passes the same Workstream-A smoke tests.

**Also in Phase 0:**
- `verify_rom.py` ported from `GBA-Game` into this repo as a first-class
  package with its own fixture tests.
- mGBA-WASM spike (§1.3): gbajs3 core running a Butano ROM at 60fps with
  audio in a bare HTML page. Go/no-go recorded.
- Stand up the **local development harness** (§1.9): the local exec/file
  adapter + the toolchain image running locally, so Phase 1 can be built
  offline. This is the highest-leverage Phase-0 item after the image itself.

*Exit criteria:* CI-built image (both toolchain variants); a script that
takes Butano source → ROM → verified → screenshot end to end, running both
locally (§1.9) and in a Fly Machine.

### Phase 1 — Single-user MVP (Weeks 4–10)

- **Build against the local harness (§1.9) first, lift to Fly second.** All
  of Phase 1's agent-loop work runs on one machine with the local adapter
  before any of it touches cloud infra. Only once the loop is proven does
  the remote adapter get swapped in.
- Control plane skeleton: sessions, project git repos, WebSocket protocol.
- Agent runner with the full tool set (§1.2), the two-tier model routing +
  prompt caching (§1.2), and the mandatory build+verify+screenshot loop with
  the `gba-dev` skill embedded.
- Frontend shell: chat + Monaco + emulator panel + file tree, single user,
  no auth (deploy behind a password).
- Asset import: PNG → grit → wired into Butano, with the constraint
  validator (§1.4) as both tool and UI feedback.
- **One genre starter template** (§1.10) so the agent edits proven code for
  the dogfood game rather than authoring from zero.
- ROM download from the UI (§1.5).

**First-playable milestone (~week 6–7 of the project):** a text prompt like
"make a Breakout clone" produces a compiled, verified ROM running live in
the browser emulator — end to end through the product, on the local harness.
It won't be *polished*, but it proves the whole loop works and is the point
where the core idea is validated or falsified cheaply.

- Dogfood milestone (MVP acceptance): **build one small complete game (a
  Breakout clone with imported sprites) start-to-finish through the product
  UI only.** Matches the README's 4–8 week MVP estimate.

### Phase 2 — Multi-tenant beta (Weeks 11–18)

- Auth (GitHub OAuth + magic link), per-user projects, VM-per-session
  isolation hardened (egress lockdown, quotas, token-minted daemon auth).
- Billing meters + Stripe integration + free/Pro tiers.
- Session lifecycle: suspend/resume, workspace snapshots, reconnect UX.
- GitHub export via OAuth user-token flow.
- **Template system, full build-out (§1.10):** remaining genre starters
  (platformer, top-down, puzzle, shmup); parameter extraction so tunable
  constants are swappable without code edits; the reusable Butano pattern
  library (health, collision, enemy-AI state machines, HUD); and the
  **save-as-template authoring loop** (promote any finished game or
  subsystem to a reusable, git-versioned template, à la Claude Code's skill
  creator). Templates are the biggest lever on perceived agent quality,
  because the agent modifies known-good code instead of authoring from zero.
- Observability: per-session traces (agent turns, tool calls, build/verify
  outcomes), cost dashboards (tokens + VM-minutes per user), error alerting.
- Closed beta, ~20–50 users.

### Phase 3 — Production polish + art beta (Weeks 19–26)

- AI static-sprite beta (§2.4): Retro Diffusion integration, post-process
  pipeline, scoring, candidate-picker UI, style-reference conditioning.
- Emulator polish: save states surfaced in UI, gamepad support, sharable
  read-only "play this ROM" links (a growth loop — every shared game
  advertises the product).
- Onboarding flow, docs, template gallery.
- Load/cost validation at ~200 concurrent sessions; renegotiate
  infrastructure choices only if measurements demand it.
- Public launch.

### Deliberately deferred (post-launch, demand-gated)

Tile-aware pixel editor; team/multiplayer editing; in-house art model
fine-tune; audio generation (mmutil pipeline exists for *importing* music —
AI composition is a separate risk, same shape as pixel art, do not open it
now); mobile UI; self-hosted Firecracker cost optimization; flash-cart
export niceties (ROM download already covers it).

---

## 4. Risks and open questions

### 4.1 Sandboxing / security of agent-driven builds — **managed, by design**

Covered in §1.7; residual risks: Fly Machines platform limits/outages
(mitigation: the VM contract is thin — exec + files — so E2B/Modal are
realistic substitutes); a malicious ROM attacking the *client-side*
emulator (mGBA-WASM parsing attacker-influenced ROMs — low severity since
WASM is itself sandboxed in the browser, but keep the core updated);
prompt injection via imported assets or project files (blast radius is the
user's own session only — keep it that way as features grow; any future
"agent reads the web" tool re-opens this and must go through the control
plane with the same no-VM-egress rule).

### 4.2 mGBA-WASM feasibility — **medium risk, spiked in week 2**

Not a maintained *upstream* target; we depend on the gbajs3 fork's health.
Mitigations ordered: pin + vendor the build so upstream churn can't break
us; EmulatorJS mGBA core as drop-in fallback; server-side frame streaming
as the expensive last resort. The week-2 spike converts this from unknown
to known before anything is built on it.

### 4.3 Toolchain licensing — **the sleeper risk; resolve in Phase 0**

devkitPro's tooling is FOSS (GPL et al.) but the project has a documented
history of objecting to third-party redistribution of its packages, and
their package-repo terms restrict mirroring. We are not merely *using* the
toolchain — we're baking it into an image that operates a commercial
service, and possibly distributing that image publicly. Actions: (1) get a
written read on devkitPro's terms vs. our use (GPL grants us distribution
rights for GPL components regardless of their wishes, but the pacman
packaging/hosting terms are separate, and community goodwill matters in
this tiny ecosystem); (2) keep the GHCR image *private* until resolved;
(3) maintain a tested **Wonderful Toolchain variant** of the image as
leverage and fallback — the README already confirmed Butano supports it.
Butano itself is zlib-licensed (clean), mGBA is MPL-2.0 (clean, keep
modifications to mGBA itself public), grit is part of devkitPro tools
(same determination as above). Also: mGBA needs no Nintendo BIOS (it has a
HLE BIOS), so **never ship or accept a `gba_bios.bin`** — that's the one
bright line with Nintendo.

### 4.4 Nintendo / IP exposure — **low-moderate, mostly user-generated**

GBA homebrew development is legal; nothing here circumvents protection.
The exposure is users importing copyrighted sprites/ROM assets and
publishing via our share links. Mitigations: ToS + DMCA process from day
one of shareable links; no ROM *upload* feature (we build from source
only — this is both a product stance and a legal one); takedown tooling
for shared ROMs.

### 4.5 Cost model at scale — **the number to watch is tokens, not VMs**

Rough per-active-user-hour: VM (2 vCPU/2 GB, Fly) ≈ $0.03–0.06/hr —
noise. Agent tokens: a heavy hour of agentic coding with build/verify
loops and screenshots in context can run $2–8. **LLM spend is 30–100× the
infra spend**; pricing and free-tier design must be built around token
metering (hence the two-meter billing in §1.5). Levers, in order: prompt
caching (the toolchain/system prompt and file context are highly
cacheable), model routing (small model for file navigation and log
triage, big model for actual code authorship), screenshot budgets
(downscale, only-on-change), context compaction between turns. The $100k/yr
budget supports roughly: infra $10–20k, LLM $50–70k (≈ 1,000–2,500 heavy
user-months at pass-through cost — fine for beta through early growth),
remainder for vendors (Stripe, art API, observability). Beyond that scale,
revenue must cover marginal tokens — which the metered billing does by
construction.

### 4.6 Agent quality ceiling — **the product risk nobody lists**

The pitch is "the agent verifies the game actually runs." True, and
differentiating — but verify-clean ≠ fun, and users will judge the product
on whether the *game* is good, not whether OAM writes are legal. Mitigations
are product-shaped: genre templates (Phase 2) so the agent edits proven
game-feel code rather than inventing physics from scratch; the screenshot-
in-context loop; save-state-anchored bug reports ("it breaks *here*"); and
honest marketing about what the agent is (a tireless junior GBA programmer
with a hardware manual, not a game designer).

### 4.7 Open questions (tracked, not blocking)

1. devkitPro licensing determination (§4.3) — Phase 0, before image is public.
2. gbajs3 core: audio latency and save-state compatibility with server-side
   libmgba states — week-2 spike.
3. Fly Machines suspend/resume real-world timings for the session-idle
   model — Phase 0 spike.
4. Retro Diffusion commercial terms (per-call price, output licensing,
   rate limits) — needed by Phase 3 planning, not before.
5. Does Butano's build parallelize acceptably at 2 vCPU, or do we size VMs
   up for build bursts? — measure in Phase 0.
6. Conversation-history growth vs. context limits on long-lived projects —
   compaction strategy needed by Phase 2; the Agent SDK's built-in
   compaction is the starting point.

---

## Appendix: decision register (one-line index)

| # | Decision | Where |
|---|---|---|
| 1 | Image built in GHA → GHCR, amd64, fully pinned | §1.1 |
| 2 | Agent runs in control plane, never in the VM | §1.2 |
| 3 | Mandatory build+verify+screenshot before "done" (hard hook) | §1.2 |
| 4 | Git is the undo/sync/audit layer; agent auto-commits | §1.2 |
| 5 | gbajs3 mGBA-WASM, vendored; EmulatorJS fallback; streaming last resort | §1.3 |
| 6 | No custom pixel editor in v1; Piskel embed + import loop | §1.4 |
| 7 | GitHub OAuth user-token flow for repo export | §1.5 |
| 8 | Self-hosted auth lib; Stripe two-meter billing (tokens + VM-minutes) | §1.5 |
| 9 | React + Vite SPA; single WebSocket per session | §1.6 |
| 10 | Firecracker microVM per session via Fly Machines; zero VM egress | §1.7 |
| 11 | Postgres job queue (pg-boss); no Redis until measured need | §1.8 |
| 12 | Art: validator+pipeline in v1; static-sprite beta via Retro Diffusion in v1.5; no in-house fine-tune yet; no animation promises | §2.4 |
| 13 | Keep GHCR image private until licensing resolved; maintain Wonderful Toolchain variant | §4.3 |
| 14 | No ROM uploads, ever; build-from-source only | §4.4 |
| 15 | Two-tier model routing (small model for navigation/triage, large for code authorship); prompt caching mandatory | §1.2 |
| 16 | VM reached via a two-implementation exec/file contract; build on the local harness first, lift to Fly second | §1.9 |
| 17 | Templates parameterized + git-versioned; reusable Butano pattern library; save-as-template authoring loop (à la Claude Code skills) | §1.10 |
| 18 | Finished ROM always downloadable as a plain `.gba`; save states exportable | §1.5 |
