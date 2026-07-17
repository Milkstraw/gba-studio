/**
 * LocalAdapter — the local implementation of `ExecFileAdapter` (P0-L1,
 * SYSTEM_PLAN §1.9). readFile/writeFile hit the host filesystem directly;
 * bash/build/verifyRom/screenshot shell out to the P0-A1 toolchain image
 * via `docker run` (docker.ts). Swapping to the remote (Fly) adapter later
 * is a config change at the call site, not a rewrite — both satisfy the
 * same `ExecFileAdapter` contract.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  ok,
  err,
  LIMITS,
  resolveJailedPath,
  jailRelativePath,
  type ExecFileAdapter,
  type Result,
  type ReadFileResult,
  type WriteFileResult,
  type BashResult,
  type BashOptions,
  type BuildResult,
  type BuildOptions,
  type VerifyResult,
  type VerifyOptions,
  type ScreenshotResult,
} from '@gba-studio/contract';
import { runInContainer } from './docker.js';
import { parseDiagnostics } from './diagnostics.js';

const BUILD_EXIT_MARKER = 'GBA_STUDIO_BUILD_EXIT';

/** Single-quote a value for safe interpolation into the `bash -lc` command
 *  string. Path-jailing stops directory escapes but not shell metacharacters
 *  in a filename (e.g. `poc$(touch x).gba`) — confirmed exploitable in
 *  verification, fixed here rather than relying on jailing alone. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface LocalAdapterOptions {
  /** Host directory that is the project root (mounted at /work in-container). */
  projectRoot: string;
  /** Host path to this repo's verify_rom/ dir (holds verify_rom.py + screenshot_rom.py). */
  verifyRomDir: string;
  /** Defaults to the P0-A1 image tag. */
  dockerImage?: string;
}

export class LocalAdapter implements ExecFileAdapter {
  private readonly projectRoot: string;
  private readonly verifyRomDir: string;
  private readonly dockerImage: string;

  constructor(opts: LocalAdapterOptions) {
    this.projectRoot = opts.projectRoot;
    this.verifyRomDir = opts.verifyRomDir;
    this.dockerImage = opts.dockerImage ?? 'gba-studio-toolchain:dev';
  }

  async readFile(requested: string): Promise<Result<ReadFileResult>> {
    const jailed = resolveJailedPath(this.projectRoot, requested);
    if (!jailed.ok) return jailed;
    try {
      const content = await fs.readFile(jailed.value, 'utf-8');
      return ok({ content });
    } catch (e) {
      return this.fsError(e, requested);
    }
  }

  async writeFile(requested: string, content: string): Promise<Result<WriteFileResult>> {
    const jailed = resolveJailedPath(this.projectRoot, requested);
    if (!jailed.ok) return jailed;
    try {
      await fs.mkdir(path.dirname(jailed.value), { recursive: true });
      await fs.writeFile(jailed.value, content, 'utf-8');
      return ok({ bytesWritten: Buffer.byteLength(content, 'utf-8') });
    } catch (e) {
      return this.fsError(e, requested);
    }
  }

  async bash(command: string, opts?: BashOptions): Promise<Result<BashResult>> {
    try {
      const result = await runInContainer({
        image: this.dockerImage,
        projectRoot: this.projectRoot,
        verifyRomDir: this.verifyRomDir,
        command,
        timeoutMs: opts?.timeoutMs ?? LIMITS.bashTimeoutMs,
      });
      return ok({
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
      });
    } catch (e) {
      return err('TRANSPORT', 'docker exec failed', String(e));
    }
  }

  async build(opts?: BuildOptions): Promise<Result<BuildResult>> {
    const startedAt = Date.now();
    // One container round-trip: run make, echo its real exit code behind a
    // marker (the outer bash -lc exit code would otherwise be `ls`'s, not
    // make's), then list the newest .gba so we don't need a second exec.
    const command = [
      'make LIBBUTANO=/opt/butano/butano 2>&1',
      `echo "${BUILD_EXIT_MARKER}:$?"`,
      'ls -1t *.gba 2>/dev/null | head -n1',
    ].join('\n');

    let raw;
    try {
      raw = await runInContainer({
        image: this.dockerImage,
        projectRoot: this.projectRoot,
        verifyRomDir: this.verifyRomDir,
        command,
        timeoutMs: opts?.timeoutMs ?? LIMITS.buildTimeoutMs,
      });
    } catch (e) {
      return err('TRANSPORT', 'docker exec failed', String(e));
    }
    if (raw.timedOut) return err('TIMEOUT', 'build exceeded its time limit');

    const durationMs = Date.now() - startedAt;
    const markerIdx = raw.stdout.indexOf(`${BUILD_EXIT_MARKER}:`);
    if (markerIdx === -1) {
      return err('TRANSPORT', 'build output missing exit marker', raw.stdout.slice(-2000));
    }
    const makeLog = raw.stdout.slice(0, markerIdx);
    const afterMarker = raw.stdout.slice(markerIdx + `${BUILD_EXIT_MARKER}:`.length);
    const newlineIdx = afterMarker.indexOf('\n');
    const exitCodeStr = (newlineIdx === -1 ? afterMarker : afterMarker.slice(0, newlineIdx)).trim();
    const romLine = (newlineIdx === -1 ? '' : afterMarker.slice(newlineIdx + 1)).trim();
    const makeExitCode = Number(exitCodeStr);

    if (makeExitCode !== 0) {
      return ok({
        ok: false,
        diagnostics: parseDiagnostics(makeLog),
        rawLog: makeLog,
        durationMs,
      });
    }
    if (!romLine) {
      return ok({
        ok: false,
        diagnostics: [{ severity: 'error', message: 'make succeeded but produced no .gba in the project root' }],
        rawLog: makeLog,
        durationMs,
      });
    }
    return ok({ ok: true, romPath: romLine, diagnostics: parseDiagnostics(makeLog), rawLog: makeLog, durationMs });
  }

  async verifyRom(romPath: string, opts?: VerifyOptions): Promise<Result<VerifyResult>> {
    const jailed = resolveJailedPath(this.projectRoot, romPath);
    if (!jailed.ok) return jailed;
    const exists = await fileExists(jailed.value);
    if (!exists) return err('NOT_FOUND', `ROM not found: ${romPath}`);

    const frames = opts?.frames ?? LIMITS.verifyDefaultFrames;
    const relRom = jailRelativePath(romPath);
    if (!relRom.ok) return relRom;
    const command = `python3 /toolchain/verify_rom/verify_rom.py ${shellQuote(relRom.value)} --frames ${frames} --json`;

    let raw;
    try {
      raw = await runInContainer({
        image: this.dockerImage,
        projectRoot: this.projectRoot,
        verifyRomDir: this.verifyRomDir,
        command,
        timeoutMs: opts?.timeoutMs ?? LIMITS.verifyTimeoutMs,
      });
    } catch (e) {
      return err('TRANSPORT', 'docker exec failed', String(e));
    }
    if (raw.timedOut) return err('TIMEOUT', 'verify exceeded its time limit');
    if (raw.exitCode === 2) {
      return err('INVALID', 'verify_rom could not load the ROM', raw.stderr || raw.stdout);
    }
    try {
      return ok(JSON.parse(raw.stdout.trim()) as VerifyResult);
    } catch {
      return err('TRANSPORT', 'verify_rom produced unparsable output', raw.stdout.slice(-2000));
    }
  }

  async screenshot(romPath: string, frames: number[]): Promise<Result<ScreenshotResult>> {
    if (frames.length === 0) return err('INVALID', 'frames must be non-empty');
    const jailed = resolveJailedPath(this.projectRoot, romPath);
    if (!jailed.ok) return jailed;
    const exists = await fileExists(jailed.value);
    if (!exists) return err('NOT_FOUND', `ROM not found: ${romPath}`);

    const relRom = jailRelativePath(romPath);
    if (!relRom.ok) return relRom;
    const frameArgs = frames.map((f) => String(f)).join(' ');
    const command = `python3 /toolchain/verify_rom/screenshot_rom.py ${shellQuote(relRom.value)} --frames ${frameArgs} --json`;

    let raw;
    try {
      raw = await runInContainer({
        image: this.dockerImage,
        projectRoot: this.projectRoot,
        verifyRomDir: this.verifyRomDir,
        command,
        timeoutMs: LIMITS.verifyTimeoutMs,
      });
    } catch (e) {
      return err('TRANSPORT', 'docker exec failed', String(e));
    }
    if (raw.timedOut) return err('TIMEOUT', 'screenshot exceeded its time limit');
    if (raw.exitCode === 2) {
      return err('INVALID', 'screenshot_rom could not load the ROM', raw.stderr || raw.stdout);
    }
    try {
      return ok(JSON.parse(raw.stdout.trim()) as ScreenshotResult);
    } catch {
      return err('TRANSPORT', 'screenshot_rom produced unparsable output', raw.stdout.slice(-2000));
    }
  }

  private fsError(e: unknown, requested: string): Result<never> {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return err('NOT_FOUND', `not found: ${requested}`);
    return err('TRANSPORT', `filesystem error on ${requested}`, String(e));
  }
}

async function fileExists(realPath: string): Promise<boolean> {
  try {
    await fs.access(realPath);
    return true;
  } catch {
    return false;
  }
}
