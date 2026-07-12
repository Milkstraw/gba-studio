/**
 * gba-studio exec/file contract — shared types (SYSTEM_PLAN §1.9, §1.2).
 *
 * This module is types + a few pure constructors ONLY. No I/O, no runtime
 * dependencies. Both adapters (local, remote) and the control plane import it.
 *
 * Design rule: errors are values. Every adapter op returns `Result<T>`.
 * Expected failures (missing file, build error, verify fail, timeout,
 * transport loss) are represented, never thrown. `throw` is reserved for
 * programmer error (a bug), not for outcomes the caller must handle.
 */

/** Transport/infra outcome of an adapter op. See the "build failure is a
 *  successful call" rule in CLAUDE.md: a failed *build* is
 *  `{ok:true, value:{ok:false, ...}}`; only infra failure is `{ok:false}`. */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: AdapterError };

export type AdapterErrorCode =
  | 'PATH_ESCAPE' // path-jail violation (absolute path or `..` escape)
  | 'NOT_FOUND' // file or ROM does not exist
  | 'TIMEOUT' // op exceeded its time limit
  | 'TRANSPORT' // adapter/infra failure: exec API down, VM gone, network
  | 'AUTH' // per-session token rejected by the VM daemon (§1.7)
  | 'INVALID'; // malformed request surfaced as a value rather than a throw

export interface AdapterError {
  code: AdapterErrorCode;
  message: string;
  /** Optional extra context (stderr excerpt, underlying error string). Untrusted text. */
  detail?: string;
}

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const err = (
  code: AdapterErrorCode,
  message: string,
  detail?: string,
): Result<never> => ({ ok: false, error: { code, message, detail } });

/**
 * Hardware/resource limits, from §1.7. Adapters use these as defaults; the
 * remote adapter also enforces them VM-side. Times in milliseconds.
 */
export const LIMITS = {
  bashTimeoutMs: 60_000,
  buildTimeoutMs: 120_000,
  verifyTimeoutMs: 60_000,
  /** Default frame count for verify/screenshot when the caller omits it. */
  verifyDefaultFrames: 300,
} as const;

// ── File ops ───────────────────────────────────────────────────────────────

/** readFile returns UTF-8 text. Binary artifacts (the built ROM) are fetched
 *  via the build result's `romPath` + a separate artifact channel, not here. */
export interface ReadFileResult {
  content: string;
}

export interface WriteFileResult {
  bytesWritten: number;
}

// ── bash ─────────────────────────────────────────────────────────────────

export interface BashResult {
  stdout: string;
  stderr: string;
  /** Process exit code, or -1 when killed by the timeout. */
  exitCode: number;
  timedOut: boolean;
}

// ── build ────────────────────────────────────────────────────────────────

/** A single parsed compiler/make diagnostic. The small model triages these
 *  into structured form (§1.2); the shape is fixed here so it can. */
export interface CompilerDiagnostic {
  /** Project-relative path (see path-jail). May be absent for link errors. */
  file?: string;
  line?: number;
  column?: number;
  severity: 'error' | 'warning';
  message: string;
}

export interface BuildResult {
  /** True iff the build produced a ROM. A false here is NOT an adapter error. */
  ok: boolean;
  /** Project-relative path to the `.gba`, present iff `ok`. */
  romPath?: string;
  diagnostics: CompilerDiagnostic[];
  /** Full raw make/compiler output. Untrusted text — render escaped, never eval. */
  rawLog: string;
  durationMs: number;
}

// ── verify_rom (the moat, §1.2) ────────────────────────────────────────────

/** Final ARM CPU state after the verify run. Filled by verify_rom.py (P0-V1). */
export interface CpuSnapshot {
  pc: number; // r15
  sp: number; // r13
  lr: number; // r14
  cpsr: number;
}

/** Final memory usage / counters after the verify run. */
export interface MemSnapshot {
  iwramUsedBytes?: number;
  ewramUsedBytes?: number;
  /** Free-form additional counters the verifier chooses to expose. */
  counters?: Record<string, number>;
}

export interface VerifyResult {
  /** True iff zero GAME_ERROR lines were emitted over the run. */
  pass: boolean;
  /** The mGBA GAME_ERROR log lines — the signal that catches the OAM bug class. */
  gameErrors: string[];
  framesRun: number;
  cpu: CpuSnapshot;
  memory: MemSnapshot;
}

// ── screenshot (§1.2 — images go into the model's context) ──────────────────

export interface Screenshot {
  frame: number;
  /** PNG bytes, base64-encoded, of the emulator framebuffer at `frame`. */
  pngBase64: string;
}

export interface ScreenshotResult {
  images: Screenshot[];
}

// ── op option bags ──────────────────────────────────────────────────────────

export interface BashOptions {
  /** Defaults to LIMITS.bashTimeoutMs. */
  timeoutMs?: number;
}

export interface BuildOptions {
  /** Defaults to LIMITS.buildTimeoutMs. */
  timeoutMs?: number;
}

export interface VerifyOptions {
  /** Frames to run headless before snapshotting. Defaults to LIMITS.verifyDefaultFrames. */
  frames?: number;
  /** Defaults to LIMITS.verifyTimeoutMs. */
  timeoutMs?: number;
}
