# Claude Config Manager

<img width="1672" height="941" alt="IMG_2545" src="https://github.com/user-attachments/assets/db411aa4-66e6-4413-a3bc-176a17b1faf6" />


## About

Find, view, and edit **all** your Claude Code configuration in one local UI —
global settings, instructions, skills, agents, memory, and every project's
config — instead of hunting through scattered files you may have created months
ago and forgotten.

Runs entirely on your machine. A small local server reads/writes the files;
the UI is served on `127.0.0.1` only. Nothing leaves your computer.

## Install as a Claude Code plugin

Add this repo as a plugin marketplace, install the plugin, then open the UI with
a single command:

```
/plugin marketplace add nicocarlier/claude-config-manager
/plugin install config-manager-ui@claude-config-manager
/config-manager-ui
```

`/config-manager-ui` clones the app, installs its dependencies on first run,
starts the local server, and opens your browser. Later runs are instant and
reuse a running server. Requires `git` and `node`/`npm` on your PATH.

## Run from source

```bash
npm install
npm start
```

Then open **http://127.0.0.1:8787** (it opens automatically on macOS).

To use a different port: `PORT=9000 npm start`. To skip auto-open: `NO_OPEN=1 npm start`.

## What it finds

- **Globals** — `~/.claude/`: `CLAUDE.md`, `settings.json`, `settings.local.json`,
  `skills/*/SKILL.md`, `agents/`, `commands/`, and home-scoped memory.
- **Projects** — every project you've used Claude in, discovered from
  `~/.claude/projects/` (each resolved to its real path via the recorded session
  `cwd`). For each project it surfaces `CLAUDE.md` / `AGENTS.md` (including nested
  workspace files), `.claude/settings*.json`, `.claude/skills`, `.claude/agents`,
  `.claude/commands`, and that project's memory.
- **Add a folder** — scan an arbitrary path for a project you haven't run Claude
  in yet (top-right input).

## Local vs shared

Every file is tagged by **scope** so you can tell your own config from a team
repo's:

- **Local** — not git-tracked (untracked / gitignored like `settings.local.json`
  or `CLAUDE.local.md`), outside any repo, or under `~/.claude`. Yours; edit
  freely.
- **Shared** — git-tracked in a repo (the badge shows `org/repo`, e.g.
  `your-org/your-repo`). You can still edit and save, but landing the change
  means a commit / PR — the editor shows a banner to remind you.

The **Local / Shared / All** filter in the top bar narrows the whole view to one
scope, and each context shows its local vs shared counts.

## Editing

Select a file to view it, edit in place, and **Save** (`⌘/Ctrl+S`) or **Delete**
(with confirmation). For safety the server only reads/writes/deletes files that
discovery actually surfaced — it can't touch arbitrary files on disk.

## Layout

Three columns: **Contexts** (Globals + one per project) → **Files** (grouped by
type) → **Editor**.

## Roadmap

- **V2 — Effective/merged view.** Compute the config that actually governs a
  given context by applying Claude's precedence rules, with every line attributed
  to its source file: resolved `CLAUDE.md`/`AGENTS.md` import chains, deep-merged
  settings with a permission **shadow graph** (which narrow rules a wildcard
  swallows), skill collisions, and staleness diagnostics (empty files, dead
  permissions, broken imports).

## Config file types recognized

`CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `settings.json`,
`settings.local.json`, `SKILL.md`, `.claude/agents/*.md`,
`.claude/commands/**/*.md`, and `memory/*.md`.

## Screenshot

<img width="3458" height="1696" alt="IMG_0998" src="https://github.com/user-attachments/assets/aeb6c914-404c-4022-9a37-8444f7df0df9" />

## License

[MIT](LICENSE)
