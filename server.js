import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

import { discoverAll, collectPaths } from './lib/discover.js';
import { readFile, writeFile, deleteFile } from './lib/files.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8787;
const HOST = '127.0.0.1';

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory index, refreshed on scan.
const state = {
  discovery: { contexts: [] },
  allow: new Set(),
  extraRoots: [],
};

function rescan() {
  state.discovery = discoverAll(state.extraRoots);
  state.allow = collectPaths(state.discovery);
  return state.discovery;
}

function handle(res, fn) {
  try {
    res.json(fn());
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

app.get('/api/config', (_req, res) => {
  if (!state.discovery.contexts.length) rescan();
  res.json({ ...state.discovery, extraRoots: state.extraRoots });
});

app.post('/api/scan', (req, res) => {
  handle(res, () => {
    const root = req.body?.root?.trim();
    if (root && !state.extraRoots.includes(root)) state.extraRoots.push(root);
    return { ...rescan(), extraRoots: state.extraRoots };
  });
});

app.get('/api/file', (req, res) => {
  handle(res, () => readFile(String(req.query.path || ''), state.allow));
});

app.put('/api/file', (req, res) => {
  handle(res, () => writeFile(req.body?.path, req.body?.content, state.allow));
});

app.delete('/api/file', (req, res) => {
  handle(res, () => deleteFile(String(req.query.path || ''), state.allow));
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
