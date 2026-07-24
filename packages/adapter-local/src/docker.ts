/**
 * Thin wrapper around `docker run` — the local adapter's transport for the
 * four ops that need the toolchain image (bash/build/verifyRom/screenshot).
 * readFile/writeFile skip this entirely (plain host fs, see adapter.ts).
 *
 * Each call spins up a fresh, `--rm --network none` container: no daemon or
 * container-lifecycle management to build (ponytail: add a warm-container
 * pool only if per-call spin-up latency is measured to matter).
 */
import { execFile, type ExecFileException } from 'node:child_process';

export interface DockerRunOptions {
  image: string;
  /** Host path to the project root, mounted at /work. */
  projectRoot: string;
  /** Host path to this repo's verify_rom/ dir, mounted at /toolchain/verify_rom
   *  (not yet baked into the image — see toolchain/Dockerfile's P0-A2 seam). */
  verifyRomDir: string;
  /** Shell command run as `bash -lc "<command>"` with cwd /work. */
  command: string;
  timeoutMs: number;
}

export interface DockerRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

/** Docker Desktop's CLI wants forward-slash paths even from a Windows host. */
function toMountPath(hostPath: string): string {
  return hostPath.replace(/\\/g, '/');
}

/**
 * Rejects on spawn-level/infra failure (docker missing, daemon unreachable) —
 * the caller maps that to `AdapterError` TRANSPORT. Resolves for every
 * outcome that is really "the command ran and exited", timeouts included.
 */
export function runInContainer(opts: DockerRunOptions): Promise<DockerRunResult> {
  const args = [
    'run',
    '--rm',
    '--network',
    'none',
    '-v',
    `${toMountPath(opts.projectRoot)}:/work`,
    '-v',
    `${toMountPath(opts.verifyRomDir)}:/toolchain/verify_rom:ro`,
    '-w',
    '/work',
    opts.image,
    'bash',
    '-lc',
    opts.command,
  ];

  return new Promise((resolve, reject) => {
    execFile(
      'docker',
      args,
      { timeout: opts.timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: 'utf-8' },
      (error: ExecFileException | null, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr, exitCode: 0, timedOut: false });
          return;
        }
        if (error.killed) {
          resolve({ stdout, stderr, exitCode: -1, timedOut: true });
          return;
        }
        if (typeof error.code !== 'number') {
          // spawn-level failure (docker not found, daemon down, etc.), not a
          // process exit code — an infra failure, not an op outcome.
          reject(new Error(`docker exec failed: ${error.message}`));
          return;
        }
        resolve({ stdout, stderr, exitCode: error.code, timedOut: false });
      },
    );
  });
}
