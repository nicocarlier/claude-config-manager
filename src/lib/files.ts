import fs from 'node:fs';

export interface HttpError extends Error {
  status?: number;
}

/**
 * Resolve a path to its canonical absolute form. Uses realpath when the file
 * exists (defeats symlink escapes); otherwise returns the resolved path.
 */
function canonical(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Guard: the target must be a member of the discovered allowlist — this keeps
 * the API constrained to config files the tool actually surfaced.
 */
function assertAllowed(target: string, allow: Set<string>): string {
  const abs = canonical(target);
  if (!allow.has(abs) && !allow.has(target)) {
    const err: HttpError = new Error('Path is not in the discovered config set');
    err.status = 403;
    throw err;
  }
  return abs;
}

export interface ReadResult {
  path: string;
  content: string;
  size: number;
  mtime: string;
}

export function readFile(target: string, allow: Set<string>): ReadResult {
  const abs = assertAllowed(target, allow);
  const content = fs.readFileSync(abs, 'utf8');
  const st = fs.statSync(abs);
  return { path: abs, content, size: st.size, mtime: st.mtime.toISOString() };
}

export function writeFile(
  target: string,
  content: unknown,
  allow: Set<string>,
): { path: string; size: number; mtime: string } {
  const abs = assertAllowed(target, allow);
  if (typeof content !== 'string') {
    const err: HttpError = new Error('content must be a string');
    err.status = 400;
    throw err;
  }
  fs.writeFileSync(abs, content, 'utf8');
  const st = fs.statSync(abs);
  return { path: abs, size: st.size, mtime: st.mtime.toISOString() };
}

export function deleteFile(target: string, allow: Set<string>): { path: string; deleted: true } {
  const abs = assertAllowed(target, allow);
  fs.unlinkSync(abs);
  allow.delete(abs);
  allow.delete(target);
  return { path: abs, deleted: true };
}
