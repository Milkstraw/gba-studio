import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDiagnostics } from './diagnostics.js';

test('parses file:line:col errors and warnings, strips the /work mount prefix', () => {
  const log = [
    '/work/src/main.cpp:10:5: error: \'foo\' was not declared in this scope',
    '/work/src/main.cpp:3:1: warning: unused variable \'x\' [-Wunused-variable]',
    'compiling main.cpp...',
  ].join('\n');
  const diags = parseDiagnostics(log);
  assert.equal(diags.length, 2);
  assert.deepEqual(diags[0], {
    file: 'src/main.cpp',
    line: 10,
    column: 5,
    severity: 'error',
    message: "'foo' was not declared in this scope",
  });
  assert.equal(diags[1]?.severity, 'warning');
});

test('captures link errors with no file:line prefix', () => {
  const diags = parseDiagnostics('undefined reference to `bn::core::init()\'\nerror: ld returned 1 exit status');
  assert.equal(diags.length, 1);
  assert.equal(diags[0]?.file, undefined);
  assert.equal(diags[0]?.severity, 'error');
});
