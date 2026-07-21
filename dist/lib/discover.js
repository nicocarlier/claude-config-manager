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
const MAX_DEPTH = 8;
const MAX_ENTRIES = 60000;
/**
 * Classify a file path into a config type, or return null if it is not a
 * Claude config/context file we care about.
 */
export function classify(fullPath) {
    const base = path.basename(fullPath);
    const inClaudeDir = fullPath.split(path.sep).includes('.claude');
    if (base === 'CLAUDE.md' || base === 'CLAUDE.local.md')
        return 'instructions';
    if (base === 'AGENTS.md' || base === 'AGENT.md')
        return 'instructions';
    if (inClaudeDir) {
        if (/^settings(\.local)?\.json$/.test(base))
            return 'settings';
        if (base === 'SKILL.md')
            return 'skills';
        if (fullPath.includes(`${path.sep}agents${path.sep}`) && base.endsWith('.md'))
            return 'agents';
        if (fullPath.includes(`${path.sep}commands${path.sep}`) && base.endsWith('.md'))
            return 'commands';
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
    }
    catch {
        return null;
    }
    const flags = [];
    if (size < 40 && type === 'instructions')
        flags.push('looks-empty');
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
 * Bounded breadth-first walk of a directory tree, returning only files that
 * classify as Claude config. Skips heavy/dot directories, caps depth + entries,
 * and prunes subtrees that belong to a more-specific project root.
 */
function walkConfig(root, rootForRel = root, pruneRoots = []) {
    const found = [];
    const pruneSet = new Set(pruneRoots);
    let visited = 0;
    const queue = [[root, 0]];
    let cursor = 0;
    while (cursor < queue.length) {
        const entry = queue[cursor++];
        if (!entry)
            break;
        const [dir, depth] = entry;
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const e of entries) {
            if (++visited > MAX_ENTRIES)
                return found;
            const full = path.join(dir, e.name);
            if (e.isSymbolicLink())
                continue;
            if (e.isDirectory()) {
                if (depth >= MAX_DEPTH)
                    continue;
                if (EXCLUDE_DIRS.has(e.name))
                    continue;
                if (e.name.startsWith('.') && e.name !== '.claude')
                    continue;
                if (pruneSet.has(full))
                    continue;
                queue.push([full, depth + 1]);
            }
            else if (e.isFile()) {
                const type = classify(full);
                if (type) {
                    const f = statFile(full, type, rootForRel);
                    if (f)
                        found.push(f);
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
    }
    catch {
        return out;
    }
    for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
            const f = statFile(path.join(memoryDir, entry.name), 'memory', memoryDir);
            if (f)
                out.push(f);
        }
    }
    return out;
}
/** Read the recorded `cwd` from a session `.jsonl` in a projects/ entry, if any. */
function cwdFromSession(entryDir) {
    let files;
    try {
        files = fs.readdirSync(entryDir);
    }
    catch {
        return null;
    }
    const sessionFile = files.find((f) => f.endsWith('.jsonl'));
    if (!sessionFile)
        return null;
    try {
        const content = fs.readFileSync(path.join(entryDir, sessionFile), 'utf8');
        for (const line of content.split('\n').slice(0, 50)) {
            if (!line.trim())
                continue;
            try {
                const obj = JSON.parse(line);
                if (typeof obj.cwd === 'string' && fs.existsSync(obj.cwd))
                    return obj.cwd;
            }
            catch {
                /* keep scanning lines */
            }
        }
    }
    catch {
        /* ignore */
    }
    return null;
}
/**
 * Decode a dash-encoded projects/ name (`/` and `.` both became `-`) to a real
 * path by matching each segment against actual directory children — robust to
 * real dashes and dots.
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
        }
        catch {
            return null;
        }
        let best = null;
        for (const child of children) {
            const enc = child.replace(/\./g, '-');
            if (remaining === enc || remaining.startsWith(`${enc}-`)) {
                if (!best || enc.length > best.enc.length)
                    best = { child, enc };
            }
        }
        if (!best)
            return null;
        current = path.join(current, best.child);
        remaining = remaining.slice(best.enc.length).replace(/^-/, '');
    }
    return current;
}
/** Resolve a projects/ entry to its real working directory. */
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
    const byType = new Map();
    for (const f of files) {
        const list = byType.get(f.type) ?? [];
        list.push(f);
        byType.set(f.type, list);
    }
    const groups = [];
    for (const type of order) {
        const list = byType.get(type);
        if (list?.length) {
            list.sort((a, b) => a.rel.localeCompare(b.rel));
            groups.push({ type, label: labels[type], files: list });
        }
    }
    return groups;
}
/**
 * Annotate every discovered file with `scope` and (when in a git repo) `repo`.
 * A file is **shared** when git-tracked; **personal** otherwise (untracked /
 * gitignored, outside any repo, or under `~/.claude`).
 */
function annotateScopes(contexts) {
    const repoRootCache = new Map();
    const trackedCache = new Map();
    const labelCache = new Map();
    const findRepoRoot = (startDir) => {
        let dir = startDir;
        const chain = [];
        for (;;) {
            if (repoRootCache.has(dir)) {
                const cached = repoRootCache.get(dir) ?? null;
                for (const d of chain)
                    repoRootCache.set(d, cached);
                return cached;
            }
            chain.push(dir);
            if (fs.existsSync(path.join(dir, '.git'))) {
                for (const d of chain)
                    repoRootCache.set(d, dir);
                return dir;
            }
            const parent = path.dirname(dir);
            if (parent === dir) {
                for (const d of chain)
                    repoRootCache.set(d, null);
                return null;
            }
            dir = parent;
        }
    };
    const trackedSet = (repoRoot) => {
        const cached = trackedCache.get(repoRoot);
        if (cached)
            return cached;
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
                    if (rel)
                        set.add(path.join(repoRoot, rel));
                    start = i + 1;
                }
            }
        }
        catch {
            /* git missing or not a repo → empty set (all personal) */
        }
        trackedCache.set(repoRoot, set);
        return set;
    };
    const repoLabel = (repoRoot) => {
        const cached = labelCache.get(repoRoot);
        if (cached)
            return cached;
        let label = path.basename(repoRoot);
        try {
            const url = execFileSync('git', ['-C', repoRoot, 'remote', 'get-url', 'origin'], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
            }).trim();
            const m = url.match(/[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
            if (m)
                label = `${m[1]}/${m[2]}`;
        }
        catch {
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
                }
                else {
                    const root = findRepoRoot(path.dirname(f.path));
                    if (!root) {
                        f.scope = 'personal';
                        f.repo = null;
                    }
                    else {
                        const isShared = trackedSet(root).has(f.path);
                        f.scope = isShared ? 'shared' : 'personal';
                        f.repo = repoLabel(root);
                        if (isShared)
                            repos.add(f.repo);
                    }
                }
                if (f.scope === 'shared')
                    shared += 1;
                else
                    personal += 1;
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
    }
    catch {
        return p;
    }
}
/** Disambiguate contexts that share a basename by prefixing the parent dir. */
function disambiguateLabels(contexts) {
    const counts = new Map();
    for (const c of contexts)
        counts.set(c.label, (counts.get(c.label) ?? 0) + 1);
    for (const c of contexts) {
        if ((counts.get(c.label) ?? 0) > 1) {
            c.label = `${path.basename(path.dirname(c.root))}/${path.basename(c.root)}`;
        }
    }
}
function discoverGlobals() {
    const files = [];
    const push = (p, type) => {
        if (fs.existsSync(p)) {
            const f = statFile(p, type, CLAUDE_DIR);
            if (f)
                files.push(f);
        }
    };
    push(path.join(CLAUDE_DIR, 'CLAUDE.md'), 'instructions');
    push(path.join(CLAUDE_DIR, 'settings.json'), 'settings');
    push(path.join(CLAUDE_DIR, 'settings.local.json'), 'settings');
    for (const sub of ['skills', 'agents', 'commands']) {
        const dir = path.join(CLAUDE_DIR, sub);
        if (fs.existsSync(dir))
            files.push(...walkConfig(dir, CLAUDE_DIR));
    }
    return { files, root: CLAUDE_DIR };
}
/** Full discovery. */
export function discoverAll(extraRoots = []) {
    const contexts = [];
    const globals = discoverGlobals();
    const globalsFiles = [...globals.files];
    const memoryByRoot = new Map();
    const projectRoots = new Set();
    let projectEntries = [];
    try {
        projectEntries = fs.readdirSync(PROJECTS_DIR);
    }
    catch {
        /* no projects dir */
    }
    const HOME_CANON = canon(HOME);
    for (const enc of projectEntries) {
        const resolved = resolveProjectRoot(enc);
        if (!resolved)
            continue;
        const root = canon(resolved);
        const mem = collectMemory(path.join(PROJECTS_DIR, enc, 'memory'));
        if (mem.length) {
            const list = memoryByRoot.get(root) ?? [];
            list.push(...mem);
            memoryByRoot.set(root, list);
        }
        if (root !== HOME_CANON)
            projectRoots.add(root);
    }
    if (memoryByRoot.has(HOME_CANON))
        globalsFiles.push(...memoryByRoot.get(HOME_CANON));
    contexts.push({
        id: 'globals',
        label: 'Globals',
        root: CLAUDE_DIR,
        kind: 'globals',
        groups: groupFiles(globalsFiles),
    });
    const extra = extraRoots
        .map((r) => canon(r))
        .filter((r) => r && fs.existsSync(r) && r !== HOME_CANON);
    const allRoots = new Set([...projectRoots, ...extra]);
    const sortedRoots = [...allRoots].sort((a, b) => a.localeCompare(b));
    const projectContexts = [];
    for (const root of sortedRoots) {
        const prune = sortedRoots.filter((r) => r !== root && r.startsWith(root + path.sep));
        const files = walkConfig(root, root, prune);
        const mem = memoryByRoot.get(root) ?? [];
        files.push(...mem);
        if (!files.length)
            continue;
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
            for (const f of group.files)
                set.add(f.path);
        }
    }
    return set;
}
