/**
 * ExecFileAdapter — the whole surface between the agent and the sandbox.
 *
 * The agent depends on THIS interface, never on a transport. Two impls satisfy
 * it (SYSTEM_PLAN §1.9):
 *   - adapter-local  (P0-L1): the toolchain Docker image on the dev machine
 *   - adapter-remote (P0-B1): Fly Machines exec against a per-session microVM
 * Swapping local→remote is a config change, not a rewrite.
 *
 * Six ops, fixed and small — this narrowness is the product's security model
 * (§1.7) and its portability guarantee. Agent-level tools (`edit_file`,
 * `glob`, `grep`, `import_asset`) are COMPOSITIONS over these six and live in
 * the control plane, not here. Do not widen this interface for them.
 *
 * All paths are project-relative and jailed (see paths.ts). All ops are async
 * and return `Result<T>`; see types.ts for the errors-as-values contract.
 */

import type {
  Result,
  ReadFileResult,
  WriteFileResult,
  BashResult,
  BashOptions,
  BuildResult,
  BuildOptions,
  VerifyResult,
  VerifyOptions,
  ScreenshotResult,
} from './types.js';

export interface ExecFileAdapter {
  /** Read a project file as UTF-8 text. `NOT_FOUND` if it doesn't exist. */
  readFile(path: string): Promise<Result<ReadFileResult>>;

  /** Write (create/overwrite) a project file. Creates parent dirs as needed. */
  writeFile(path: string, content: string): Promise<Result<WriteFileResult>>;

  /**
   * Run a shell command in the project root. No network is available in the
   * sandbox (§1.7), so this is safe-ish by construction. Times out at
   * `opts.timeoutMs` (default LIMITS.bashTimeoutMs) → `timedOut:true`, not an error.
   */
  bash(command: string, opts?: BashOptions): Promise<Result<BashResult>>;

  /**
   * Run the project's canonical `make` build (§1.1 — no ad-hoc compiler
   * invocations). A failed build is `{ok:true, value:{ok:false, diagnostics}}`,
   * not an adapter error. Only infra failure yields `{ok:false}`.
   */
  build(opts?: BuildOptions): Promise<Result<BuildResult>>;

  /**
   * Run a built ROM headless in mGBA for N frames and report the verifier's
   * verdict (§1.2): pass/fail + GAME_ERROR lines + final CPU/memory snapshot.
   * A failing verify is `pass:false`, not an adapter error.
   */
  verifyRom(romPath: string, opts?: VerifyOptions): Promise<Result<VerifyResult>>;

  /**
   * Capture the emulator framebuffer at one or more frame numbers, returned as
   * base64 PNGs to go into the model's context (§1.2). Empty `frames` is INVALID.
   */
  screenshot(romPath: string, frames: number[]): Promise<Result<ScreenshotResult>>;
}
