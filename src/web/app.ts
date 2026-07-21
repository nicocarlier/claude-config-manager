// Claude Config Manager — frontend. Compiled to public/app.js (classic script;
// no imports so the output stays a plain script the browser can load directly).

type Scope = 'personal' | 'shared';
type FileType = 'instructions' | 'settings' | 'skills' | 'agents' | 'commands' | 'memory';

interface FileEntry {
  path: string;
  name: string;
  rel: string;
  type: FileType;
  size: number;
  mtime: string | null;
  flags: string[];
  scope: Scope;
  repo: string | null;
}
interface Group {
  type: FileType;
  label: string;
  files: FileEntry[];
}
interface Context {
  id: string;
  label: string;
  root: string;
  kind: 'globals' | 'project';
  groups: Group[];
  summary?: { personal: number; shared: number };
  repos?: string[];
}
interface Discovery {
  contexts: Context[];
  extraRoots?: string[];
  created?: string;
}

type ViewMode = 'raw' | 'preview';

interface ActiveFile {
  path: string;
  type: FileType;
  scope: Scope;
  repo: string | null;
  name: string;
}

interface AppState {
  contexts: Context[];
  activeContext: string | null;
  activeFile: ActiveFile | null;
  dirty: boolean;
  scopeFilter: 'personal' | 'shared' | 'all';
  viewMode: ViewMode;
}

const state: AppState = {
  contexts: [],
  activeContext: null,
  activeFile: null,
  dirty: false,
  scopeFilter: 'personal',
  viewMode: 'raw',
};

function must<T extends Element>(sel: string): T {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`Missing element: ${sel}`);
  return el as T;
}

const el = {
  contexts: must<HTMLElement>('#contexts'),
  files: must<HTMLElement>('#files'),
  editor: must<HTMLTextAreaElement>('#editor'),
  preview: must<HTMLElement>('#preview'),
  viewToggle: must<HTMLElement>('#viewToggle'),
  editorHeader: must<HTMLElement>('#editorHeader'),
  emptyState: must<HTMLElement>('#emptyState'),
  filePath: must<HTMLElement>('#filePath'),
  fileInfo: must<HTMLElement>('#fileInfo'),
  dirty: must<HTMLElement>('#dirty'),
  saveBtn: must<HTMLButtonElement>('#saveBtn'),
  deleteBtn: must<HTMLButtonElement>('#deleteBtn'),
  rescanBtn: must<HTMLButtonElement>('#rescanBtn'),
  addBtn: must<HTMLButtonElement>('#addBtn'),
  addRoot: must<HTMLInputElement>('#addRoot'),
  status: must<HTMLElement>('#status'),
  banner: must<HTMLElement>('#banner'),
  themeToggle: must<HTMLButtonElement>('#themeToggle'),
};

function setStatus(msg: string): void {
  el.status.textContent = msg;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

function isMarkdown(name: string): boolean {
  return /\.md$/i.test(name);
}

function matchingFiles(ctx: Context): FileEntry[] {
  const all = ctx.groups.flatMap((g) => g.files);
  if (state.scopeFilter === 'all') return all;
  return all.filter((f) => f.scope === state.scopeFilter);
}

function firstMatchingFile(ctx: Context): FileEntry | null {
  return matchingFiles(ctx)[0] ?? null;
}

function confirmDiscard(): boolean {
  return !state.dirty || confirm('Discard unsaved changes?');
}

function applyScopeFilter(scope: AppState['scopeFilter']): void {
  state.scopeFilter = scope;
  document.querySelectorAll<HTMLElement>('.filter-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.scope === scope);
  });
}

function locateByPath(p: string): { ctxId: string; file: FileEntry } | null {
  for (const c of state.contexts) {
    for (const g of c.groups) {
      for (const f of g.files) {
        if (f.path === p) return { ctxId: c.id, file: f };
      }
    }
  }
  return null;
}

// ---- Minimal, escaped markdown renderer (offline, dependency-free) ----

function renderInline(escaped: string): string {
  let s = escaped;
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) =>
    /^(https?:|mailto:|#|\/)/.test(url)
      ? `<a href="${url}" target="_blank" rel="noopener">${text}</a>`
      : `[${text}](${url})`,
  );
  return s;
}

function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let inCode = false;
  let code: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let para: string[] = [];

  const flushPara = (): void => {
    if (para.length) {
      out.push(`<p>${renderInline(escapeHtml(para.join(' ')))}</p>`);
      para = [];
    }
  };
  const closeList = (): void => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const line of lines) {
    if (/^```/.test(line)) {
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
        code = [];
        inCode = false;
      } else {
        flushPara();
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      flushPara();
      closeList();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      closeList();
      const level = heading[1]!.length;
      out.push(`<h${level}>${renderInline(escapeHtml(heading[2]!))}</h${level}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara();
      closeList();
      out.push('<hr>');
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushPara();
      closeList();
      out.push(`<blockquote>${renderInline(escapeHtml(line.replace(/^>\s?/, '')))}</blockquote>`);
      continue;
    }
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const wanted: 'ul' | 'ol' = ul ? 'ul' : 'ol';
      if (listType !== wanted) {
        closeList();
        out.push(`<${wanted}>`);
        listType = wanted;
      }
      const item = (ul ? ul[1] : ol![1])!;
      out.push(`<li>${renderInline(escapeHtml(item))}</li>`);
      continue;
    }
    para.push(line.trim());
  }
  if (inCode) out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  flushPara();
  closeList();
  return out.join('\n');
}

// ---- Rendering ----

async function loadConfig(): Promise<void> {
  setStatus('Scanning…');
  const res = await fetch('/api/config');
  const data = (await res.json()) as Discovery;
  applyConfig(data);
}

function applyConfig(data: Discovery): void {
  state.contexts = data.contexts || [];
  const totalFiles = state.contexts.reduce(
    (n, c) => n + c.groups.reduce((m, g) => m + g.files.length, 0),
    0,
  );
  setStatus(`${state.contexts.length} contexts · ${totalFiles} files`);
  renderContexts();
  const stillThere = state.contexts.find((c) => c.id === state.activeContext);
  selectContext(stillThere ? stillThere.id : (state.contexts[0]?.id ?? null));
}

function addSectionTitle(text: string): void {
  const t = document.createElement('div');
  t.className = 'section-title';
  t.textContent = text;
  el.contexts.appendChild(t);
}

function renderContexts(): void {
  el.contexts.innerHTML = '';
  const visible = state.contexts.filter((c) => matchingFiles(c).length > 0);
  const globals = visible.filter((c) => c.kind === 'globals');
  const projects = visible.filter((c) => c.kind !== 'globals');

  const render = (ctx: Context): void => {
    const div = document.createElement('div');
    div.className = 'ctx' + (ctx.id === state.activeContext ? ' active' : '');
    const s = ctx.summary ?? { personal: 0, shared: 0 };
    const summary =
      state.scopeFilter === 'all'
        ? `<div class="ctx-summary"><span class="s-local">${s.personal} local</span><span class="s-shared">${s.shared} shared</span></div>`
        : `<div class="ctx-count">${matchingFiles(ctx).length} shown</div>`;
    div.innerHTML = `
      <div class="ctx-label">${escapeHtml(ctx.label)}</div>
      <div class="ctx-sub">${escapeHtml(ctx.repos?.length ? ctx.repos.join(', ') : ctx.root)}</div>
      ${summary}`;
    div.onclick = () => selectContext(ctx.id);
    el.contexts.appendChild(div);
  };

  if (globals.length) {
    addSectionTitle('Global');
    globals.forEach(render);
  }
  if (projects.length) {
    addSectionTitle(`Projects (${projects.length})`);
    projects.forEach(render);
  }
}

function selectContext(id: string | null): void {
  if (id === state.activeContext) return;
  if (!confirmDiscard()) return;
  state.activeContext = id;
  renderContexts();
  renderFiles();
  const ctx = state.contexts.find((c) => c.id === id);
  const first = ctx ? firstMatchingFile(ctx) : null;
  if (first) void loadFile(first);
  else clearEditor();
}

function renderFiles(): void {
  el.files.innerHTML = '';
  const ctx = state.contexts.find((c) => c.id === state.activeContext);
  if (!ctx) return;

  const header = document.createElement('div');
  header.className = 'files-header';
  const hdrTitle = document.createElement('span');
  hdrTitle.className = 'files-header-title';
  hdrTitle.textContent = ctx.label;
  const newBtn = document.createElement('button');
  newBtn.className = 'btn btn-small';
  newBtn.textContent = '+ New file';
  newBtn.title = 'Create a new config file in this context';
  newBtn.onclick = () => void newFile();
  header.append(hdrTitle, newBtn);
  el.files.appendChild(header);

  for (const group of ctx.groups) {
    const files = group.files.filter(
      (f) => state.scopeFilter === 'all' || f.scope === state.scopeFilter,
    );
    if (!files.length) continue;
    const title = document.createElement('div');
    title.className = 'group-title';
    title.textContent = group.label;
    el.files.appendChild(title);
    for (const file of files) {
      const div = document.createElement('div');
      div.className = 'file' + (file.path === state.activeFile?.path ? ' active' : '');
      const empty = file.flags?.includes('looks-empty');
      const scopeLabel = file.scope === 'shared' ? 'shared' : 'local';
      const scopeTitle =
        file.scope === 'shared'
          ? `Tracked in ${file.repo || 'a git repo'} — editing needs a commit/PR`
          : 'Local file — edit freely';
      div.innerHTML = `
        <span class="file-main">
          <span class="scope scope-${file.scope}" title="${escapeHtml(scopeTitle)}">${scopeLabel}</span>
          <span class="file-name" title="${escapeHtml(file.rel)}">${escapeHtml(file.rel)}</span>
        </span>
        <span class="file-right">
          <span class="file-badge ${empty ? 'badge-empty' : ''}">${empty ? 'empty?' : fmtSize(file.size)}</span>
        </span>`;
      div.onclick = () => void openFile(file);
      el.files.appendChild(div);
    }
  }
}

// ---- Editor ----

async function openFile(file: FileEntry): Promise<void> {
  if (!confirmDiscard()) return;
  await loadFile(file);
}

async function loadFile(file: FileEntry): Promise<void> {
  const res = await fetch(`/api/file?path=${encodeURIComponent(file.path)}`);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    alert(`Could not open file: ${err.error || res.status}`);
    return;
  }
  const data = (await res.json()) as { path: string; content: string; size: number; mtime: string };
  state.activeFile = { path: data.path, type: file.type, scope: file.scope, repo: file.repo, name: file.name };
  el.editor.value = data.content;
  el.editor.disabled = false;
  el.filePath.textContent = data.path;
  el.fileInfo.textContent = `${fmtSize(data.size)} · modified ${new Date(data.mtime).toLocaleString()}`;
  el.editorHeader.classList.remove('hidden');
  el.emptyState.classList.add('hidden');
  if (file.scope === 'shared') {
    el.banner.innerHTML = `Shared repo file — tracked in <code>${escapeHtml(file.repo || 'a git repo')}</code>. You can edit and save here, but landing the change means a commit / PR.`;
    el.banner.classList.remove('hidden');
  } else {
    el.banner.classList.add('hidden');
  }
  setDirty(false);
  updateView();
  renderFiles();
}

function updateView(): void {
  const md = state.activeFile ? isMarkdown(state.activeFile.name) : false;
  el.viewToggle.classList.toggle('hidden', !md);
  const showPreview = md && state.viewMode === 'preview';
  if (showPreview) {
    el.preview.innerHTML = renderMarkdown(el.editor.value);
    el.preview.classList.remove('hidden');
    el.editor.classList.add('hidden');
  } else {
    el.preview.classList.add('hidden');
    el.editor.classList.remove('hidden');
  }
  el.viewToggle.querySelectorAll<HTMLElement>('.view-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === (showPreview ? 'preview' : 'raw'));
  });
}

function setView(mode: ViewMode): void {
  state.viewMode = mode;
  updateView();
}

function setDirty(d: boolean): void {
  state.dirty = d;
  el.dirty.classList.toggle('hidden', !d);
  el.saveBtn.disabled = !d;
}

async function saveFile(): Promise<void> {
  if (!state.activeFile) return;
  el.saveBtn.disabled = true;
  const res = await fetch('/api/file', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: state.activeFile.path, content: el.editor.value }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    alert(`Save failed: ${err.error || res.status}`);
    el.saveBtn.disabled = false;
    return;
  }
  const data = (await res.json()) as { size: number; mtime: string };
  el.fileInfo.textContent = `${fmtSize(data.size)} · saved ${new Date(data.mtime).toLocaleString()}`;
  setDirty(false);
  setStatus('Saved');
}

async function deleteFile(): Promise<void> {
  if (!state.activeFile) return;
  if (!confirm(`Delete this file?\n\n${state.activeFile.path}\n\nThis cannot be undone.`)) return;
  const res = await fetch(`/api/file?path=${encodeURIComponent(state.activeFile.path)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    alert(`Delete failed: ${err.error || res.status}`);
    return;
  }
  clearEditor();
  setStatus('Deleted');
  await loadConfig();
}

function clearEditor(): void {
  state.activeFile = null;
  el.editor.value = '';
  el.editor.disabled = true;
  el.editor.classList.remove('hidden');
  el.preview.classList.add('hidden');
  el.viewToggle.classList.add('hidden');
  el.editorHeader.classList.add('hidden');
  el.banner.classList.add('hidden');
  el.emptyState.classList.remove('hidden');
  setDirty(false);
}

async function newFile(): Promise<void> {
  const ctx = state.contexts.find((c) => c.id === state.activeContext);
  if (!ctx) return;
  if (!confirmDiscard()) return;
  const rel = prompt(
    `New file in ${ctx.label}\n${ctx.root}\n\n` +
      'Relative path — e.g. CLAUDE.md, AGENTS.md, .claude/settings.json',
    'CLAUDE.md',
  );
  if (rel === null) return;
  const relPath = rel.trim();
  if (!relPath) return;

  const res = await fetch('/api/file/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contextId: ctx.id, relPath }),
  });
  const data = (await res.json()) as Discovery & { error?: string };
  if (!res.ok) {
    alert(`Could not create file: ${data.error || res.status}`);
    return;
  }

  state.contexts = data.contexts;
  const found = data.created ? locateByPath(data.created) : null;
  if (!found) {
    applyConfig(data);
    return;
  }
  if (state.scopeFilter !== 'all' && found.file.scope !== state.scopeFilter) {
    applyScopeFilter('all');
  }
  state.activeContext = found.ctxId;
  renderContexts();
  renderFiles();
  void loadFile(found.file);
  setStatus('Created');
}

async function rescan(root?: string): Promise<void> {
  setStatus('Scanning…');
  const res = await fetch('/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(root ? { root } : {}),
  });
  const data = (await res.json()) as Discovery & { error?: string };
  if (!res.ok) {
    alert(`Scan failed: ${data.error || res.status}`);
    return;
  }
  applyConfig(data);
}

function setFilter(scope: AppState['scopeFilter']): void {
  applyScopeFilter(scope);
  renderContexts();
  const active = state.contexts.find((c) => c.id === state.activeContext);
  if (!active || matchingFiles(active).length === 0) {
    const firstVisible = state.contexts.find((c) => matchingFiles(c).length > 0);
    selectContext(firstVisible ? firstVisible.id : null);
  } else {
    renderFiles();
  }
}

// ---- Events ----

document.querySelectorAll<HTMLElement>('.filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => setFilter(btn.dataset.scope as AppState['scopeFilter']));
});
el.viewToggle.querySelectorAll<HTMLElement>('.view-btn').forEach((btn) => {
  btn.addEventListener('click', () => setView(btn.dataset.view as ViewMode));
});
el.editor.addEventListener('input', () => setDirty(true));
el.saveBtn.addEventListener('click', () => void saveFile());
el.deleteBtn.addEventListener('click', () => void deleteFile());
el.rescanBtn.addEventListener('click', () => void rescan());
el.addBtn.addEventListener('click', () => {
  const root = el.addRoot.value.trim();
  if (root) {
    void rescan(root);
    el.addRoot.value = '';
  }
});
el.addRoot.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el.addBtn.click();
});
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    if (state.dirty) void saveFile();
  }
});
window.addEventListener('beforeunload', (e) => {
  if (state.dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Theme toggle (initial theme set pre-paint by the inline script in index.html).
const currentTheme = (): 'light' | 'dark' =>
  document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
const paintThemeToggle = (): void => {
  el.themeToggle.textContent = currentTheme() === 'dark' ? '🌙' : '☀️';
};
el.themeToggle.addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('theme', next);
  paintThemeToggle();
});
paintThemeToggle();

void loadConfig();
