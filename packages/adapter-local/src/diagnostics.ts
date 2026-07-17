/**
 * Parse GCC/devkitARM-style compiler output into `CompilerDiagnostic[]`
 * (contract §types.ts). Link errors have no `file:line:col` prefix — the
 * type marks `file`/`line` optional for exactly that case.
 */
import type { CompilerDiagnostic } from '@gba-studio/contract';

const DIAGNOSTIC_LINE = /^(?:(.+?):(\d+):(\d+):\s*)?(error|warning):\s*(.*)$/;

/** Strip the in-container /work mount prefix so paths come back project-relative. */
function toProjectRelative(file: string): string {
  return file.startsWith('/work/') ? file.slice('/work/'.length) : file;
}

export function parseDiagnostics(rawLog: string): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  for (const line of rawLog.split('\n')) {
    const match = DIAGNOSTIC_LINE.exec(line.trim());
    if (!match) continue;
    const [, file, lineNo, col, severity, message] = match;
    diagnostics.push({
      ...(file ? { file: toProjectRelative(file) } : {}),
      ...(lineNo ? { line: Number(lineNo) } : {}),
      ...(col ? { column: Number(col) } : {}),
      severity: severity as 'error' | 'warning',
      message: message ?? '',
    });
  }
  return diagnostics;
}
