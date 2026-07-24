/**
 * Self-check for the path-jail (the one security-relevant bit of logic in the
 * contract). ponytail: non-trivial guard leaves one runnable check behind.
 * Run with `npm test` (compiles, then `node --test dist`).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { jailRelativePath } from './paths.js';

test('accepts safe relative paths and normalizes them', () => {
  const cases: Array<[string, string]> = [
    ['src/main.cpp', 'src/main.cpp'],
    ['./a/b.c', 'a/b.c'],
    ['a/../b', 'b'], // stays inside root after normalization
    ['.', '.'], // the root itself
  ];
  for (const [input, expected] of cases) {
    const r = jailRelativePath(input);
    assert.ok(r.ok, `${input} should be accepted`);
    if (r.ok) assert.equal(r.value, expected);
  }
});

test('rejects absolute paths and root escapes as PATH_ESCAPE', () => {
  const escapes = [
    '/etc/passwd',
    '/work/x',
    '../secret',
    'a/../../b',
    'C:\\Windows\\System32',
    '..\\..\\x',
  ];
  for (const input of escapes) {
    const r = jailRelativePath(input);
    assert.ok(!r.ok, `${input} should be rejected`);
    if (!r.ok) assert.equal(r.error.code, 'PATH_ESCAPE', `${input} → PATH_ESCAPE`);
  }
});

test('rejects empty path as INVALID', () => {
  const r = jailRelativePath('');
  assert.ok(!r.ok && r.error.code === 'INVALID');
});
