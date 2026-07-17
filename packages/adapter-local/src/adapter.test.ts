/**
 * Integration test against the real P0-A1 toolchain image and the P0-FX1
 * known-good fixture — the smallest thing that fails if the local adapter's
 * docker wiring breaks. Requires Docker Desktop running with
 * `gba-studio-toolchain:dev` built (skips itself otherwise).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalAdapter } from './adapter.js';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const VERIFY_ROM_DIR = path.join(REPO_ROOT, 'verify_rom');
const FIXTURE_DIR = path.join(REPO_ROOT, 'fixtures', 'known-good');

function dockerAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('docker', ['image', 'inspect', 'gba-studio-toolchain:dev'], (error) => resolve(!error));
  });
}

async function copyFixtureSources(dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  for (const entry of ['src', 'include', 'graphics', 'audio', 'dmg_audio', 'Makefile']) {
    const from = path.join(FIXTURE_DIR, entry);
    try {
      await fs.cp(from, path.join(dest, entry), { recursive: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
}

test('LocalAdapter: build + verifyRom + screenshot against the known-good fixture', async (t) => {
  if (!(await dockerAvailable())) {
    t.skip('docker / gba-studio-toolchain:dev not available');
    return;
  }

  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gba-studio-adapter-local-'));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));
  await copyFixtureSources(projectRoot);

  const adapter = new LocalAdapter({ projectRoot, verifyRomDir: VERIFY_ROM_DIR });

  await t.test('readFile/writeFile round-trip on the host fs', async () => {
    const write = await adapter.writeFile('notes/todo.txt', 'hello gba-studio');
    assert.ok(write.ok);
    const read = await adapter.readFile('notes/todo.txt');
    assert.ok(read.ok);
    if (read.ok) assert.equal(read.value.content, 'hello gba-studio');
  });

  await t.test('readFile on a missing file is NOT_FOUND, not a throw', async () => {
    const read = await adapter.readFile('does/not/exist.txt');
    assert.ok(!read.ok);
    if (!read.ok) assert.equal(read.error.code, 'NOT_FOUND');
  });

  await t.test('path escapes are rejected', async () => {
    const read = await adapter.readFile('../outside.txt');
    assert.ok(!read.ok);
    if (!read.ok) assert.equal(read.error.code, 'PATH_ESCAPE');
  });

  await t.test('bash runs inside the toolchain container', async () => {
    const result = await adapter.bash('echo hello-from-container');
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.exitCode, 0);
      assert.match(result.value.stdout, /hello-from-container/);
    }
  });

  let romPath = '';
  await t.test('build compiles the fixture into a .gba', async () => {
    const result = await adapter.build();
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error));
    if (result.ok) {
      assert.equal(result.value.ok, true, result.value.rawLog.slice(-2000));
      assert.ok(result.value.romPath?.endsWith('.gba'));
      romPath = result.value.romPath ?? '';
    }
  });

  await t.test('verifyRom passes on the known-good build', async () => {
    assert.ok(romPath, 'build step must have produced a romPath');
    const result = await adapter.verifyRom(romPath, { frames: 60 });
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error));
    if (result.ok) {
      assert.equal(result.value.pass, true, JSON.stringify(result.value.gameErrors));
      assert.equal(result.value.framesRun, 60);
    }
  });

  await t.test('shell metacharacters in a romPath are not executed (regression, verification finding)', async () => {
    const maliciousName = 'poc$(touch INJECTED).gba';
    const write = await adapter.writeFile(maliciousName, 'not a real rom');
    assert.ok(write.ok);

    const result = await adapter.verifyRom(maliciousName, { frames: 1 });
    // Not a real ROM, so verify_rom.py fails to load it — that's expected.
    assert.ok(!result.ok);
    if (!result.ok) assert.equal(result.error.code, 'INVALID');

    // The real assertion: the embedded `$(touch INJECTED)` must never have
    // run as a shell command inside the container.
    const injected = await fs
      .access(path.join(projectRoot, 'INJECTED'))
      .then(() => true)
      .catch(() => false);
    assert.equal(injected, false, 'shell substitution in the romPath executed inside the container');
  });

  await t.test('screenshot captures requested frames as PNGs', async () => {
    assert.ok(romPath, 'build step must have produced a romPath');
    const result = await adapter.screenshot(romPath, [1, 30]);
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error));
    if (result.ok) {
      assert.equal(result.value.images.length, 2);
      const png = Buffer.from(result.value.images[0]?.pngBase64 ?? '', 'base64');
      assert.deepEqual(png.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
  });
});
