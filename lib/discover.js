import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

// Directories we never descend into when walking a project tree.
const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.turbo', '.cache',
  'coverage', 'vendor', 'tmp', 'temp', '.venv', 'venv', '__pycache__', 'target',
  '.gradle', 'Pods', 'DerivedData', '.svn', '.hg', 'Library', '.Trash',
]);

const MAX_DEPTH = 8;        // how deep to walk under a project root
const MAX_ENTRIES = 60000;  // hard cap on filesystem entries visited per root

/**
 * Classify a file path into a config "type", or return null if it is not a
 * Claude config/context file we care about.
 */
function classify(fullPath) {
  const base = path.basename(fullPath);
  const inClaudeDir = fullPath.split(path.sep).includes('.claude');

  if (base === 'CLAUDE.md' || base === 'CLAUDE.local.md') return 'instructions';
  if (base === 'AGENTS.md' || base === 'AGENT.md') return 'instructions';

  if (inClaudeDir) {
    if (/^settings(\.local)?\.json$/.test(base)) return 'settings';
    if (base === 'SKILL.md') return 'skills';
    if (fullPath.includes(`${path.sep}agents${path.sep}`) && base.endsWith('.md')) return 'agents';
    if (fullPath.includes(`${path.sep}commands${path.sep}`) && base.endsWith('.md')) return 'commands';
  }
  return null;
}

function statFile(fullPath, type, rootForRel) {
  let size = 0;
  let mtime = null;
  try {
    const st = fs.statSync(fullPath);
    size = st.size;
    mtime = st.mtime.toISOString();
  } catch {
    return null;
  }
  const flags = [];
  if (size < 40 && (type === 'instructions')) flags.push('looks-empty');
  return {
    path: fullPath,
    name: path.basename(fullPath),
    rel: rootForRel ? path.relative(rootForRel, fullPath) : path.basename(fullPath),
    type,
    size,
    mtime,
    flags,
  };
}

/**
 * Bounded walk of a directory tree, returning only files that classify as
 * Claude config. Skips heavy/dot directories and caps depth + entries visited.
 */
function walkConfig(root, rootForRel = root, pruneRoots = []) {
  const found = [];
  const pruneSet = new Set(pruneRoots);
  let visited = 0;
  // Breadth-first (queue + cursor) so shallow, higher-signal files are found
  // before the entry cap is reached.
  const queue = [[root, 0]];
  let cursor = 0;
  while (cursor < queue.length) {
    const [dir, depth] = queue[cursor++];
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (++visited > MAX_ENTRIES) return found;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (depth >= MAX_DEPTH) continue;
        if (EXCLUDE_DIRS.has(entry.name)) continue;
        // Skip dot-directories except `.claude` (where project settings live).
        if (entry.name.startsWith('.') && entry.name !== '.claude') continue;
        // Don't descend into a subtree that is itself a more-specific project
        // root — its files belong to that context, not this parent.
        if (pruneSet.has(full)) continue;
        queue.push([full, depth + 1]);
      } else if (entry.isFile()) {
        const type = classify(full);
        if (type) {
          const f = statFile(full, type, rootForRel);
          if (f) found.push(f);
        }
      }
    }
  }
  return found;
}

/** Collect `*.md` memory files from a memory directory. */
function collectMemory(memoryDir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(memoryDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      const f = statFile(path.join(memoryDir, entry.name), 'memory', memoryDir);
      if (f) out.push(f);
    }
  }
  return out;
}

/**
 * Read the recorded `cwd` from a session `.jsonl` in a projects/ entry, if one
 * exists. Cheapest and exact when available (many entries have no sessions).
 */
function cwdFromSession(entryDir) {
  let files;
  try {
    files = fs.readdirSync(entryDir);
  } catch {
    return null;
  }
  const sessionFile = files.find((f) => f.endsWith('.jsonl'));
  if (!sessionFile) return null;
  try {
    const content = fs.readFileSync(path.join(entryDir, sessionFile), 'utf8');
    for (const line of content.split('\n').slice(0, 50)) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj && typeof obj.cwd === 'string' && fs.existsSync(obj.cwd)) return obj.cwd;
      } catch {
        /* keep scanning lines */
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Decode a dash-encoded projects/ name (`/` and `.` both became `-`) to a real
 * path by walking the filesystem: at each level, match the next path segment
 * against the actual directory children (comparing their own encoded form). This
 * is robust to real dashes (`crud-migration-workspace`) and dots
 * (`.claude-worktrees`) that a naive `-`→`/` replace can't disambiguate.
 */
function decodeByListing(encodedDir) {
  let remaining = encodedDir.replace(/^-/, '');
  let current = '/';
  while (remaining.length) {
    let children;
    try {
      children = fs
        .readdirSync(current, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      return null;
    }
    let best = null;
    for (const child of children) {
      const enc = child.replace(/\./g, '-');
      if (remaining === enc || remaining.startsWith(`${enc}-`)) {
        if (!best || enc.length > best.enc.length) best = { child, enc };
      }
    }
    if (!best) return null;
    current = path.join(current, best.child);
    remaining = remaining.slice(best.enc.length).replace(/^-/, '');
  }
  return current;
}

/**
 * Resolve a `~/.claude/projects/<encoded>` entry to its real working directory.
 * Prefers the exact recorded session `cwd`; falls back to filesystem decode.
 */
function resolveProjectRoot(encodedDir) {
  return cwdFromSession(path.join(PROJECTS_DIR, encodedDir)) || decodeByListing(encodedDir);
}

function groupFiles(files) {
  const order = ['instructions', 'settings', 'skills', 'agents', 'commands', 'memory'];
  const labels = {
    instructions: 'Instructions',
    settings: 'Settings',
    skills: 'Skills',
    agents: 'Agents',
    commands: 'Commands',
    memory: 'Memory',
  };
  const byType = {};
  for (const f of files) (byType[f.type] ||= []).push(f);
  const groups = [];
  for (const type of order) {
    if (byType[type]?.length) {
      byType[type].sort((a, b) => a.rel.localeCompare(b.rel));
      groups.push({ type, label: labels[type], files: byType[type] });
    }
  }
  return groups;
}

/** Discover the global (~/.claude) context. */
function discoverGlobals() {
  const files = [];
  const push = (p, type) => {
    if (fs.existsSync(p)) {
      const f = statFile(p, type, CLAUDE_DIR);
      if (f) files.push(f);
    }
  };
  push(path.join(CLAUDE_DIR, 'CLAUDE.md'), 'instructions');
  push(path.join(CLAUDE_DIR, 'settings.json'), 'settings');
  push(path.join(CLAUDE_DIR, 'settings.local.json'), 'settings');

  for (const sub of ['skills', 'agents', 'commands']) {
    const dir = path.join(CLAUDE_DIR, sub);
    if (fs.existsSync(dir)) files.push(...walkConfig(dir, CLAUDE_DIR));
  }

  return { files, root: CLAUDE_DIR };
}

/**
 * Annotate every discovered file with `scope` ('personal' | 'shared') and, when
 * it lives in a git repo, `repo` (e.g. `your-org/your-repo`).
 *
 * A file is **shared** when it is git-tracked — landing a change means a commit
 * (and, on a team repo, a PR). It is **personal** when it is not tracked
 * (untracked/gitignored, like `settings.local.json` or `CLAUDE.local.md`), lives
 * outside any repo, or lives under `~/.claude` (your own machine-local config).
 *
 * Caches are created per-call so a rescan always reflects current git state.
 */
function annotateScopes(contexts) {
  const repoRootCache = new Map(); // dir -> repoRoot | null
  const trackedCache = new Map(); // repoRoot -> Set<absPath>
  const labelCache = new Map(); // repoRoot -> display label

  const findRepoRoot = (startDir) => {
    let dir = startDir;
    const chain = [];
    for (;;) {
      if (repoRootCache.has(dir)) {
        const cached = repoRootCache.get(dir);
        for (const d of chain) repoRootCache.set(d, cached);
        return cached;
      }
      chain.push(dir);
      if (fs.existsSync(path.join(dir, '.git'))) {
        for (const d of chain) repoRootCache.set(d, dir);
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        for (const d of chain) repoRootCache.set(d, null);
        return null;
      }
      dir = parent;
    }
  };

  const trackedSet = (repoRoot) => {
    if (trackedCache.has(repoRoot)) return trackedCache.get(repoRoot);
    const set = new Set();
    try {
      const out = execFileSync('git', ['-C', repoRoot, 'ls-files', '-z'], {
        maxBuffer: 1 << 28,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let start = 0;
      for (let i = 0; i < out.length; i++) {
        if (out[i] === 0) {
          const rel = out.toString('utf8', start, i);
          if (rel) set.add(path.join(repoRoot, rel));
          start = i + 1;
        }
      }
    } catch {
      /* git missing or not a repo → empty set (all personal) */
    }
    trackedCache.set(repoRoot, set);
    return set;
  };

  const repoLabel = (repoRoot) => {
    if (labelCache.has(repoRoot)) return labelCache.get(repoRoot);
    let label = path.basename(repoRoot);
    try {
      const url = execFileSync('git', ['-C', repoRoot, 'remote', 'get-url', 'origin'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      const m = url.match(/[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
      if (m) label = `${m[1]}/${m[2]}`;
    } catch {
      /* no origin remote → fall back to dir name */
    }
    labelCache.set(repoRoot, label);
    return label;
  };

  for (const ctx of contexts) {
    let personal = 0;
    let shared = 0;
    const repos = new Set();
    for (const group of ctx.groups) {
      for (const f of group.files) {
        if (f.path.startsWith(CLAUDE_DIR + path.sep)) {
          f.scope = 'personal';
          f.repo = null;
        } else {
          const root = findRepoRoot(path.dirname(f.path));
          if (!root) {
            f.scope = 'personal';
            f.repo = null;
          } else {
            f.scope = trackedSet(root).has(f.path) ? 'shared' : 'personal';
            f.repo = repoLabel(root);
            if (f.scope === 'shared') repos.add(f.repo);
          }
        }
        if (f.scope === 'shared') shared += 1;
        else personal += 1;
      }
    }
    ctx.summary = { personal, shared };
    ctx.repos = [...repos];
  }
}

/** Canonicalize a path (resolve symlinks) so duplicate roots collapse. */
function canon(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Disambiguate contexts that share a basename by prefixing the parent directory
 * (e.g. two `clinician-web` checkouts → `nico2/clinician-web`,
 * `crud-migration-workspace/clinician-web`).
 */
function disambiguateLabels(contexts) {
  const counts = {};
  for (const c of contexts) counts[c.label] = (counts[c.label] || 0) + 1;
  for (const c of contexts) {
    if (counts[c.label] > 1) {
      c.label = `${path.basename(path.dirname(c.root))}/${path.basename(c.root)}`;
    }
  }
}

/**
 * Full discovery. Returns { contexts: [...] }.
 * Each context = { id, label, root, kind, groups: [{type,label,files}] }.
 */
export function discoverAll(extraRoots = []) {
  const contexts = [];

  // --- Globals ---
  const globals = discoverGlobals();
  const globalsFiles = [...globals.files];

  // Map every projects/ entry to a real root; collect memory per root.
  const memoryByRoot = new Map();
  const projectRoots = new Set();
  let projectEntries = [];
  try {
    projectEntries = fs.readdirSync(PROJECTS_DIR);
  } catch {
    /* no projects dir */
  }
  const HOME_CANON = canon(HOME);
  for (const enc of projectEntries) {
    const resolved = resolveProjectRoot(enc);
    if (!resolved) continue;
    const root = canon(resolved);
    const mem = collectMemory(path.join(PROJECTS_DIR, enc, 'memory'));
    if (mem.length) {
      const list = memoryByRoot.get(root) || [];
      list.push(...mem);
      memoryByRoot.set(root, list);
    }
    // The home dir is surfaced as Globals, not as a project (walking it is huge).
    if (root !== HOME_CANON) projectRoots.add(root);
  }

  // Home-scoped memory belongs to Globals.
  if (memoryByRoot.has(HOME_CANON)) globalsFiles.push(...memoryByRoot.get(HOME_CANON));

  contexts.push({
    id: 'globals',
    label: 'Globals',
    root: CLAUDE_DIR,
    kind: 'globals',
    groups: groupFiles(globalsFiles),
  });

  // --- Projects ---
  const extra = extraRoots
    .map((r) => canon(r))
    .filter((r) => r && fs.existsSync(r) && r !== HOME_CANON);
  const allRoots = new Set([...projectRoots, ...extra]);
  const sortedRoots = [...allRoots].sort((a, b) => a.localeCompare(b));

  const projectContexts = [];
  for (const root of sortedRoots) {
    // A more-specific root nested under this one owns its own subtree; prune it
    // so files aren't double-counted across parent and child contexts.
    const prune = sortedRoots.filter((r) => r !== root && r.startsWith(root + path.sep));
    const files = walkConfig(root, root, prune);
    const mem = memoryByRoot.get(root) || [];
    files.push(...mem);
    if (!files.length) continue; // nothing Claude-related here; skip
    projectContexts.push({
      id: root,
      label: path.basename(root) || root,
      root,
      kind: 'project',
      groups: groupFiles(files),
    });
  }
  disambiguateLabels(projectContexts);
  contexts.push(...projectContexts);

  annotateScopes(contexts);

  return { contexts, generatedAt: new Date().toISOString() };
}

/** Flatten a discovery result into the set of absolute paths (the allowlist). */
export function collectPaths(discovery) {
  const set = new Set();
  for (const ctx of discovery.contexts) {
    for (const group of ctx.groups) {
      for (const f of group.files) set.add(f.path);
    }
  }
  return set;
}
