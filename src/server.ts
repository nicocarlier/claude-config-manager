import express, { type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec, execFileSync } from 'node:child_process';

import { discoverAll, collectPaths, classify } from './lib/discover.js';
import { readFile, writeFile, deleteFile, type HttpError } from './lib/files.js';
import type { Discovery } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8787;
const HOST = '127.0.0.1';

// The git commit this build is running, so the launcher can detect a stale
// server and restart it. Empty when the app dir isn't a git checkout.
const REPO_ROOT = path.join(__dirname, '..');
function currentSha(): string {
  try {
    return execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}
const VERSION = currentSha();

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

interface State {
  discovery: Discovery;
  allow: Set<string>;
  extraRoots: string[];
}

const state: State = {
  discovery: { contexts: [] },
  allow: new Set<string>(),
  extraRoots: [],
};

function rescan(): Discovery {
  state.discovery = discoverAll(state.extraRoots);
  state.allow = collectPaths(state.discovery);
  return state.discovery;
}

function handle(res: Response, fn: () => unknown): void {
  try {
    res.json(fn());
  } catch (err) {
    const e = err as HttpError;
    res.status(e.status ?? 500).json({ error: e.message });
  }
}

/**
 * Create a new (empty) config file inside a known context, then rescan.
 * Constrained to recognized config paths under a context root.
 */
function createConfigFile(contextId: unknown, relPathRaw: unknown): Discovery & { created: string } {
  const ctx = state.discovery.contexts.find((c) => c.id === contextId);
  if (!ctx) {
    const e: HttpError = new Error('Unknown context'); e.status = 400; throw e;
  }
  const rel = String(relPathRaw ?? '').trim().replace(/^\/+/, '');
  if (!rel) {
    const e: HttpError = new Error('A file name is required'); e.status = 400; throw e;
  }
  const root = ctx.root;
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) {
    const e: HttpError = new Error('Path escapes the context directory'); e.status = 400; throw e;
  }
  if (!classify(full)) {
    const e: HttpError = new Error(
      'Not a recognized Claude config file. Try CLAUDE.md, AGENTS.md, ' +
        '.claude/settings.json, .claude/skills/<name>/SKILL.md, ' +
        '.claude/agents/<name>.md, or .claude/commands/<name>.md',
    );
    e.status = 400; throw e;
  }
  if (fs.existsSync(full)) {
    const e: HttpError = new Error('That file already exists'); e.status = 409; throw e;
  }
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, '', 'utf8');
  rescan();
  return { ...state.discovery, created: full };
}

app.get('/api/version', (_req: Request, res: Response) => {
  res.type('text/plain').send(VERSION);
});

app.get('/api/config', (_req: Request, res: Response) => {
  if (!state.discovery.contexts.length) rescan();
  res.json({ ...state.discovery, extraRoots: state.extraRoots });
});

app.post('/api/scan', (req: Request, res: Response) => {
  handle(res, () => {
    const root = typeof req.body?.root === 'string' ? req.body.root.trim() : '';
    if (root && !state.extraRoots.includes(root)) state.extraRoots.push(root);
    return { ...rescan(), extraRoots: state.extraRoots };
  });
});

app.post('/api/file/create', (req: Request, res: Response) => {
  handle(res, () => createConfigFile(req.body?.contextId, req.body?.relPath));
});

app.get('/api/file', (req: Request, res: Response) => {
  handle(res, () => readFile(String(req.query.path ?? ''), state.allow));
});

app.put('/api/file', (req: Request, res: Response) => {
  handle(res, () => writeFile(req.body?.path, req.body?.content, state.allow));
});

app.delete('/api/file', (req: Request, res: Response) => {
  handle(res, () => deleteFile(String(req.query.path ?? ''), state.allow));
});

app.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  rescan();
  const n = state.discovery.contexts.length;
  console.log(`\n  Claude Config Manager`);
  console.log(`  → ${url}`);
  console.log(`  Indexed ${n} context${n === 1 ? '' : 's'} (${state.allow.size} config files)\n`);
  if (process.platform === 'darwin' && !process.env.NO_OPEN) {
    exec(`open ${url}`, () => {});
  }
});
