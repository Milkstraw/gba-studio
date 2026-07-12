/**
 * Path-jailing — the single sanctioned enforcement point (SYSTEM_PLAN §1.2/§1.7).
 *
 * Every caller-supplied path is relative to the project root (`/work`). This is
 * the ONLY place that decision is enforced; both adapters route through it so
 * the rule can't drift or be forgotten in one implementation. (ponytail: one
 * guard in the shared function, not a guard re-derived per adapter.)
 *
 * Validation is deliberately host-independent: it checks the *logical* path
 * (POSIX semantics, backslashes treated as separators to catch Windows-style
 * escapes) and never touches the filesystem. Adapters join the returned safe
 * relative path onto their own real root — a win32 temp dir locally, POSIX
 * `/work` remotely — with their own path module.
 */

import path from 'node:path';
import { ok, err, type Result } from './types.js';

/**
 * Validate that `requested` stays within the project root, returning the
 * normalized POSIX-relative form (e.g. `src/main.cpp`). Rejects absolute
 * paths, drive letters, and any `..` sequence that escapes the root.
 */
export function jailRelativePath(requested: string): Result<string> {
  if (requested === '') return err('INVALID', 'empty path');

  // Treat backslashes as separators so `..\..\x` and `C:\x` are caught too.
  const logical = requested.replace(/\\/g, '/');

  if (logical.startsWith('/')) {
    return err('PATH_ESCAPE', `absolute path not allowed: ${requested}`);
  }
  if (/^[a-zA-Z]:/.test(logical)) {
    return err('PATH_ESCAPE', `absolute path not allowed: ${requested}`);
  }

  const normalized = path.posix.normalize(logical);

  if (
    normalized === '..' ||
    normalized.startsWith('../') ||
    path.posix.isAbsolute(normalized)
  ) {
    return err('PATH_ESCAPE', `path escapes project root: ${requested}`);
  }

  // Strip a leading `./` for a clean relative path; `.` (the root) stays as-is.
  const clean = normalized === '.' ? '.' : normalized.replace(/^\.\//, '');
  return ok(clean);
}

/**
 * Join a caller path onto a real project root after jailing it. The `join`
 * function lets the remote adapter pass `path.posix.join` for `/work`; local
 * defaults to the host-native join.
 */
export function resolveJailedPath(
  projectRoot: string,
  requested: string,
  join: (...parts: string[]) => string = path.join,
): Result<string> {
  const jailed = jailRelativePath(requested);
  if (!jailed.ok) return jailed;
  return ok(join(projectRoot, jailed.value));
}
