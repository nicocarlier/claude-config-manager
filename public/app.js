const $ = (sel) => document.querySelector(sel);

const state = {
  contexts: [],
  activeContext: null,
  activeFile: null, // { path, type, scope, repo }
  dirty: false,
  scopeFilter: 'personal', // 'personal' | 'shared' | 'all' — Local is the primary view
};

const el = {
  contexts: $('#contexts'),
  files: $('#files'),
  editor: $('#editor'),
  editorHeader: $('#editorHeader'),
  emptyState: $('#emptyState'),
  filePath: $('#filePath'),
  fileInfo: $('#fileInfo'),
  dirty: $('#dirty'),
  saveBtn: $('#saveBtn'),
  deleteBtn: $('#deleteBtn'),
  rescanBtn: $('#rescanBtn'),
  addBtn: $('#addBtn'),
  addRoot: $('#addRoot'),
  status: $('#status'),
  banner: $('#banner'),
};

/** Files in a context that match the active scope filter. */
function matchingFiles(ctx) {
  const all = ctx.groups.flatMap((g) => g.files);
  if (state.scopeFilter === 'all') return all;
  return all.filter((f) => f.scope === state.scopeFilter);
}

/** First file in a context (group order) that matches the active filter. */
function firstMatchingFile(ctx) {
  return matchingFiles(ctx)[0] || null;
}

/** True if it's safe to replace the editor contents (no unsaved work, or user OK'd). */
function confirmDiscard() {
  return !state.dirty || confirm('Discard unsaved changes?');
}

function applyScopeFilter(scope) {
  state.scopeFilter = scope;
  document.querySelectorAll('.filter-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.scope === scope);
  });
}

function locateByPath(p) {
  for (const c of state.contexts) {
    for (const g of c.groups) {
      for (const f of g.files) {
        if (f.path === p) return { ctxId: c.id, file: f };
      }
    }
  }
  return null;
}

/** Create a new config file in the active context, then open it for editing. */
async function newFile() {
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
  const data = await res.json();
  if (!res.ok) {
    alert(`Could not create file: ${data.error || res.status}`);
    return;
  }

  state.contexts = data.contexts;
  const found = locateByPath(data.created);
  if (!found) {
    applyConfig(data);
    return;
  }
  // Make sure the new (untracked = local) file is visible under the filter.
  if (state.scopeFilter !== 'all' && found.file.scope !== state.scopeFilter) {
    applyScopeFilter('all');
  }
  state.activeContext = found.ctxId;
  renderContexts();
  renderFiles();
  loadFile(found.file);
  setStatus('Created');
}

function setStatus(msg) {
  el.status.textContent = msg;
}

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function loadConfig() {
  setStatus('Scanning…');
  const res = await fetch('/api/config');
  const data = await res.json();
  applyConfig(data);
}

function applyConfig(data) {
  state.contexts = data.contexts || [];
  const totalFiles = state.contexts.reduce(
    (n, c) => n + c.groups.reduce((m, g) => m + g.files.length, 0),
    0,
  );
  setStatus(`${state.contexts.length} contexts · ${totalFiles} files`);
  renderContexts();

  // Keep the active context selected if it still exists; else pick the first.
  const stillThere = state.contexts.find((c) => c.id === state.activeContext);
  selectContext(stillThere ? stillThere.id : state.contexts[0]?.id);
}

function renderContexts() {
  el.contexts.innerHTML = '';
  const visible = state.contexts.filter((c) => matchingFiles(c).length > 0);
  const globals = visible.filter((c) => c.kind === 'globals');
  const projects = visible.filter((c) => c.kind !== 'globals');

  const render = (ctx) => {
    const div = document.createElement('div');
    div.className = 'ctx' + (ctx.id === state.activeContext ? ' active' : '');
    const s = ctx.summary || { personal: 0, shared: 0 };
    const summary =
      state.scopeFilter === 'all'
        ? `<div class="ctx-summary">
             <span class="s-local">${s.personal} local</span>
             <span class="s-shared">${s.shared} shared</span>
           </div>`
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

function addSectionTitle(text) {
  const t = document.createElement('div');
  t.className = 'section-title';
  t.textContent = text;
  el.contexts.appendChild(t);
}

function selectContext(id) {
  if (id === state.activeContext) return; // re-selecting the same tab is a no-op
  if (!confirmDiscard()) return; // keep unsaved work; abort the switch
  state.activeContext = id;
  renderContexts();
  renderFiles();
  // Follow the tab: open the first file in the newly selected context so the
  // editor always reflects the active tab (respecting the scope filter).
  const ctx = state.contexts.find((c) => c.id === id);
  const first = ctx ? firstMatchingFile(ctx) : null;
  if (first) loadFile(first);
  else clearEditor();
}

function renderFiles() {
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
  newBtn.onclick = newFile;
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
      div.onclick = () => openFile(file);
      el.files.appendChild(div);
    }
  }
}

async function openFile(file) {
  if (!confirmDiscard()) return;
  await loadFile(file);
}

/** Fetch a file and render it into the editor. Assumes discard already confirmed. */
async function loadFile(file) {
  const res = await fetch(`/api/file?path=${encodeURIComponent(file.path)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(`Could not open file: ${err.error || res.status}`);
    return;
  }
  const data = await res.json();
  state.activeFile = { path: data.path, type: file.type, scope: file.scope, repo: file.repo };
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
  renderFiles();
}

function setDirty(d) {
  state.dirty = d;
  el.dirty.classList.toggle('hidden', !d);
  el.saveBtn.disabled = !d;
}

async function saveFile() {
  if (!state.activeFile) return;
  el.saveBtn.disabled = true;
  const res = await fetch('/api/file', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: state.activeFile.path, content: el.editor.value }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(`Save failed: ${err.error || res.status}`);
    el.saveBtn.disabled = false;
    return;
  }
  const data = await res.json();
  el.fileInfo.textContent = `${fmtSize(data.size)} · saved ${new Date(data.mtime).toLocaleString()}`;
  setDirty(false);
  setStatus('Saved');
}

async function deleteFile() {
  if (!state.activeFile) return;
  if (!confirm(`Delete this file?\n\n${state.activeFile.path}\n\nThis cannot be undone.`)) return;
  const res = await fetch(`/api/file?path=${encodeURIComponent(state.activeFile.path)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(`Delete failed: ${err.error || res.status}`);
    return;
  }
  clearEditor();
  setStatus('Deleted');
  await loadConfig();
}

function clearEditor() {
  state.activeFile = null;
  el.editor.value = '';
  el.editor.disabled = true;
  el.editorHeader.classList.add('hidden');
  el.banner.classList.add('hidden');
  el.emptyState.classList.remove('hidden');
  setDirty(false);
}

async function rescan(root) {
  setStatus('Scanning…');
  const res = await fetch('/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(root ? { root } : {}),
  });
  const data = await res.json();
  if (!res.ok) {
    alert(`Scan failed: ${data.error || res.status}`);
    return;
  }
  applyConfig(data);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function setFilter(scope) {
  state.scopeFilter = scope;
  document.querySelectorAll('.filter-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.scope === scope);
  });
  renderContexts();
  // If the active context has no files under this filter, jump to the first that does.
  const active = state.contexts.find((c) => c.id === state.activeContext);
  if (!active || matchingFiles(active).length === 0) {
    const firstVisible = state.contexts.find((c) => matchingFiles(c).length > 0);
    selectContext(firstVisible ? firstVisible.id : null);
  } else {
    renderFiles();
  }
}

// Events
document.querySelectorAll('.filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => setFilter(btn.dataset.scope));
});
el.editor.addEventListener('input', () => setDirty(true));
el.saveBtn.addEventListener('click', saveFile);
el.deleteBtn.addEventListener('click', deleteFile);
el.rescanBtn.addEventListener('click', () => rescan());
el.addBtn.addEventListener('click', () => {
  const root = el.addRoot.value.trim();
  if (root) {
    rescan(root);
    el.addRoot.value = '';
  }
});
el.addRoot.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el.addBtn.click();
});
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    if (state.dirty) saveFile();
  }
});
window.addEventListener('beforeunload', (e) => {
  if (state.dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

loadConfig();
