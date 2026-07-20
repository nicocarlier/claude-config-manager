import fs from 'node:fs';

/**
 * Resolve a path to its canonical absolute form. Uses realpath when the file
 * exists (defeats symlink escapes); otherwise returns the resolved path.
 */
function canonical(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Guard: the target must be a member of the discovered allowlist. This is what
 * keeps the API constrained to config files the tool actually surfaced, rather
 * than arbitrary files on disk.
 */
function assertAllowed(target, allow) {
  const abs = canonical(target);
  if (!allow.has(abs) && !allow.has(target)) {
    const err = new Error('Path is not in the discovered config set');
    err.status = 403;
    throw err;
  }
  return abs;
}

export function readFile(target, allow) {
  const abs = assertAllowed(target, allow);
  const content = fs.readFileSync(abs, 'utf8');
  const st = fs.statSync(abs);
  return { path: abs, content, size: st.size, mtime: st.mtime.toISOString() };
}

export function writeFile(target, content, allow) {
  const abs = assertAllowed(target, allow);
  if (typeof content !== 'string') {
    const err = new Error('content must be a string');
    err.status = 400;
    throw err;
  }
  fs.writeFileSync(abs, content, 'utf8');
  const st = fs.statSync(abs);
  return { path: abs, size: st.size, mtime: st.mtime.toISOString() };
}

export function deleteFile(target, allow) {
  const abs = assertAllowed(target, allow);
  fs.unlinkSync(abs);
  allow.delete(abs);
  allow.delete(target);
  return { path: abs, deleted: true };
}
