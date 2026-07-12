# gba-studio

An AI-assisted development environment for building Game Boy Advance
homebrew games: chat-driven code generation, a live emulator preview, and a
sprite/asset pipeline, wrapped around an agent that actually verifies a game
runs correctly instead of just compiling it.

This document tracks what's been decided and why, for whoever (human or
Claude) picks this up next.

## Status

Planning stage. No code has been written yet. The next piece of work is the
container/toolchain foundation (see below) — nothing else can be built until
that exists.

## Why this exists

This started as an attempt to add Claude Code skills to
[`Milkstraw/GBA-Game`](https://github.com/Milkstraw/GBA-Game) (a repo of
existing GBA homebrew projects) to fix a recurring problem: AI-generated GBA
code compiles cleanly but is full of game-breaking bugs, because GBA hardware
programming has footguns (invalid VRAM/OAM/palette writes, DMA misuse,
interrupt races, etc.) that don't show up in general C/C++ knowledge and are
silent at compile time. That work produced two reusable pieces, now living in
`GBA-Game/.claude/skills/`:

- `gba-dev` — a curated GBA hardware-footgun reference.
- `gba-verify` — a headless mGBA harness (`verify_rom.py`) that runs a
  compiled `.gba` for N frames and fails if mGBA logs a hardware-level error.
  Validated against real fixture ROMs, including one that reproduces the
  exact `Bad memory Store8` OAM-corruption bug found sitting untouched in
  that repo's `HollowShore/ConsoleLog`.

The natural next question was: instead of just adding skills to Claude Code,
what if this were its own product — a purpose-built UI wrapping the AI
agent, an emulator, and an asset editor together? That's what this repo is
for. `GBA-Game` stays as the actual game projects (and keeps its own
skills/tooling); this repo is the product that could eventually build games
like those, for anyone, not just inside a Claude Code session.

## Decisions made so far

- **Standalone product**, not a companion UI bolted onto Claude Code. It's
  meant to eventually be usable by people other than just the original
  developer.
- **Separate repo** (`Milkstraw/gba-studio`, public) rather than a subfolder
  of `GBA-Game` — this is a different kind of codebase (web app / agent
  backend / container infra) from actual game projects.
- **Build order: container/toolchain foundation first.** Nothing else (agent
  backend, live preview, asset pipeline) is useful without a reliable place
  to actually compile and run a GBA ROM.

## The one open risk flagged early, on purpose

**AI-generated pixel art is not a solved problem.** Code generation has a
tight feedback loop — compile, run, `gba-verify` catches hardware errors,
iterate. Art doesn't have that loop the same way: text-to-image models don't
reliably produce clean, palette-constrained, tile-aligned GBA sprite art
without heavy post-processing, and it may still look wrong. Current plan is
to scope the product's promise honestly: **AI writes game code and wires up
assets you (or an artist) provide/edit**, plus basic procedural art (solid
shapes, palette work, simple geometric tiles) — not "AI draws your sprites."
Revisit this once there's an actual post-processing pipeline to evaluate
against, not before.

## Proposed architecture (not yet built, in dependency order)

1. **Container image with devkitARM + Butano + mGBA baked in at build
   time.** Foundational — nothing else works without it. Critically, this
   image must be *built* somewhere with real, unrestricted internet access
   (a local machine, or CI like GitHub Actions) — not inside a sandboxed
   Claude Code web session. See "Lessons learned" below for exactly why that
   distinction matters.
2. **Agent backend** — the Claude Agent SDK driving that container (file
   edits, shell commands, iterate), the same shape as Claude Code's own tool
   loop, embedded in this app instead of the Claude Code CLI/web UI.
3. **Live preview** — mGBA compiled to WebAssembly running client-side in
   the browser, for instant visual feedback without a server round-trip per
   frame. Needs a feasibility check (confirm a maintained mGBA-WASM build
   exists and is usable) before committing to it.
4. **Asset pipeline, scoped down for v1** — PNG import → `grit` conversion →
   GBA tile/palette format, with VRAM-budget and constraint warnings. A real
   paint UI (tile-aware pixel editor) is a v2 problem, not day one — start
   by integrating existing GBA-specific tools (`grit`, Usenti, Tiled) rather
   than building a pixel editor from scratch.
5. **Project storage + auth** — accounts, per-user/per-project storage,
   likely git-backed given everything else in this ecosystem already is.
6. **Frontend app shell** — ties chat, code view, live emulator, and the
   asset panel together into one UI.

## Rough effort estimate

- **Working MVP** (project creation, chat-driven code gen, live emulator
  preview, basic asset import/convert, one-click build): ~4–8 weeks of
  focused iteration.
- **Actually polished / production-grade** (real paint-quality sprite
  editor, multi-user auth/billing, robust sandboxing, onboarding): 3–6+
  months.

## Lessons learned building the `GBA-Game` tooling (why some of the above choices exist)

These came out of hands-on work in a Claude Code web session on `GBA-Game`,
and directly shaped the architecture choices above:

- **devkitPro's own package server (`apt.devkitpro.org`) is blocked** by
  Claude Code web sessions' network policy — not repo-scoped, blocked
  outright at the connection level. Wonderful Toolchain's server
  (`wonderful.asie.pl`) is equally blocked. This is why the container image
  above must be built somewhere with real internet access, not inside a
  session like the one that did this research.
- **Butano's build system (`butano.mak`) requires devkitARM or Wonderful
  Toolchain specifically** — confirmed directly from the vendored engine
  source. It needs devkitARM's patched GCC `.specs` files plus the `grit`
  (graphics), `mmutil` (audio), and `gbafix` (ROM header) binary tools.
  There is no plain-`arm-none-eabi-gcc` fallback, unlike hand-rolled
  bare-metal C with a custom crt0/linker script (which *does* compile fine
  with the plain Ubuntu-packaged cross-compiler — confirmed by hand,
  including booting the result in headless mGBA).
- **Headless mGBA verification works well and is proven.** `mgba` (the PyPI
  package, backed by `libmgba`) gives programmatic access to load a ROM, run
  N frames, read memory/CPU state, capture screenshots, and — importantly —
  capture mGBA's own hardware-diagnostic log lines (e.g.
  `Cannot Store8 to OAM: <addr>` at `GAME_ERROR` level). This is the exact
  mechanism `gba-verify`'s `verify_rom.py` uses, and it's directly reusable
  as this product's automated "tester" component.
- **GitHub App integrations (how Claude Code's GitHub access works) cannot
  create new repositories on a personal account** — `POST /user/repos`
  requires a user-to-server OAuth token, not an app installation token. This
  is a GitHub platform limitation, not Claude-Code-specific, but it's worth
  remembering if this product's own agent backend ever needs to create
  repos on a user's behalf — plan for OAuth device/token flow, not a GitHub
  App installation token, if that feature is ever built.
- Claude Code web sessions also had a separate, narrower limitation: a
  session's `add_repo` tool couldn't attach a repo from a different GitHub
  owner than what the session already had (a stated "v1" restriction,
  possibly loosened in future versions). Not relevant to this product's own
  design, but explains why `gba-studio` and `GBA-Game` are separate
  sessions/repos rather than one.

## Related

- [`Milkstraw/GBA-Game`](https://github.com/Milkstraw/GBA-Game) — the game
  projects this effort started from, and the `gba-dev`/`gba-verify` Claude
  Code skills referenced above.
