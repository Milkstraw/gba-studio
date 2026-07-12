# CLAUDE.md — gba-studio conventions

Shared conventions for every contributor (human or subagent). Read this before
touching code. `SYSTEM_PLAN.md` is the authoritative spec; `TASKS.md` tracks
status. This file is *how we build*, consistently, so parallel work composes.

## What this is

A browser IDE that drives a Claude agent to build **GBA games** (Butano/C++),
compiling and hardware-verifying every change inside an ephemeral sandbox. See
`SYSTEM_PLAN.md` §1.0 for the one-paragraph shape.

## Directory layout

Scaffold a package only when its task lands — do not pre-create empty dirs.

```
gba-studio/
  packages/            # TypeScript workspaces (npm workspaces)
    contract/          # P0-C1  exec/file adapter contract (types + interface). The keystone. No transport, no I/O.
    adapter-local/     # P0-L1  local impl of the contract (Docker image on this machine)
    adapter-remote/    # P0-B1/P1-LIFT  Fly Machines impl of the contract
    control-plane/     # P1-CP* session mgr, agent runner, WS server, auth, billing
    frontend/          # P1-FE* React + Vite SPA
  toolchain/           # P0-A1  Dockerfile + image assets; P0-C2 Wonderful variant
  verify_rom/          # P0-V1  Python package (libmgba headless verifier) + fixture tests
  fixtures/            # P0-FX1 known-good + known-bad-OAM Butano projects/ROMs
  templates/           # P1-T1  Butano genre starter(s)
  emulator/            # P0-W1  gbajs3 mGBA-WASM spike / vendored core
  harness/             # P0-L2 local stubs; P0-E1 end-to-end script
  docs/                # gba-dev footgun ref (P0-F1), licensing determination (P0-LIC)
  .github/workflows/   # P0-A2 image build CI
  TASKS.md  CLAUDE.md  SYSTEM_PLAN.md  README.md
```

## The exec/file contract (`packages/contract`) — read this before writing an adapter or a tool

Everything reaches the sandbox through **one** interface: `ExecFileAdapter`
(six ops — `readFile`, `writeFile`, `bash`, `build`, `verifyRom`, `screenshot`).
Two implementations satisfy it (local, remote); the agent depends on the
contract, never the transport (§1.9). Rules that are **invariants**, not
suggestions:

- **Path-jailing.** Every path is relative to the project root (`/work`). The
  contract's `resolveJailedPath` is the *only* sanctioned way to turn a
  caller path into a real path — both adapters MUST route through it. Absolute
  paths and `..` escapes are rejected. Do not re-implement this per adapter.
- **Errors are values.** Ops return `Result<T>` (`{ok:true,value}` |
  `{ok:false,error}`), never throw for expected failures (missing file, build
  error, verify fail, timeout). Throwing is reserved for programmer error.
- **A build failure is a successful call** returning `{ok:true, value:{ok:false, diagnostics:[…]}}` —
  the *op* succeeded, the *build* failed. Same for `verifyRom` (pass:false).
  Only transport/infra failures produce `{ok:false, error}`.
- **The contract has no I/O and no dependencies.** It is types + pure helpers
  only, so both adapters and the control plane can import it freely.
- Agent-level tools (`edit_file`, `glob`, `grep`, `import_asset`) are
  **compositions over these six** (edit = read+write; glob/grep = bash;
  import = bash+build). Do not widen the transport contract for them.

## Local-first ordering (non-negotiable, §1.9)

The whole loop — chat → code → build → verify → screenshot → iterate — is
built and proven on the **local** adapter before any Fly/cloud code. If a task
tempts you toward cloud infra before the local loop works, stop and flag it.

## Missing-asset note

`verify_rom.py`, the `gba-dev` footgun doc, and the OAM fixture do **not**
exist to port (checked). They are authored from scratch under P0-V1/F1/FX1.

## TypeScript conventions

- Node 22, TypeScript strict mode, ESM (`"type":"module"`), `.ts` sources.
- Package names `@gba-studio/<dir>`. One responsibility per package.
- Tests: Node's built-in `node:test` + `node:assert` — no Jest/Vitest until a
  package genuinely needs a browser/DOM runner (frontend). No frameworks for
  backend/library tests.
- Prefer stdlib and already-present deps. A new dependency needs a one-line
  justification in the PR/commit body.

## Python conventions (`verify_rom/`)

- Python 3.13, standard `venv` + `requirements.txt` (pin `mgba`). `pytest` for
  fixtures is fine (it's the ecosystem norm; ponytail exception for Python).

## Verification & acceptance

- A task is **built** when its acceptance criteria pass locally, and **verified**
  only after an *independent, fresh-context* verifier subagent re-runs them.
  Authors do not self-certify. Gate (✋) tasks additionally need user sign-off.

## Commit style

- Conventional commits, scoped by task ID: `type(P0-XX): summary`
  (`feat`, `fix`, `chore`, `docs`, `test`, `build`, `refactor`).
- One checkpoint commit per verified task; body notes model used + acceptance result.
- Work on `build/<phase>` branches, not `main`.
- Trailer on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  ```

## Model policy (build team — keep expensive tokens on judgment)

- **Opus** — orchestration, contracts/interfaces, security-sensitive code,
  final review/verification.
- **Sonnet** — the bulk: features, modules, tests, wiring.
- **Haiku** — mechanical fan-out only: search, log/error triage, formatting.
  Never primary authorship or multi-file reasoning.

When unsure: down a tier for mechanical work, up a tier for architecture/security.
