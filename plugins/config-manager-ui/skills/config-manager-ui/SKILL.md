---
name: config-manager-ui
description: Open the Claude Config Manager — a local web UI to view and edit all your Claude Code config (global settings, instructions, skills, agents, memory) and every project's config in one place, with local-vs-shared (git-tracked) tagging. Use when the user runs /config-manager-ui or asks to open/launch the Claude config manager/console/UI.
disable-model-invocation: true
allowed-tools:
  - Bash(./scripts/*)
---

# Claude Config Manager UI

Launch the [Claude Config Manager](https://github.com/nicocarlier/claude-config-manager)
web UI. It discovers every Claude config file on the machine — global (`~/.claude`)
and per-project — and lets you view, edit, and delete them from one page, tagging
each as **local** (yours) or **shared** (git-tracked, needs a PR).

## Procedure

Run the launcher:

```bash
./scripts/launch.sh
```

It clones or updates the app into `~/.claude-config-manager`, installs
dependencies on first run, starts the local server (bound to `127.0.0.1`), and
opens the browser. First run takes ~30s (clone + `npm install`); later runs are
instant, and if it's already running it just reopens the tab.

Then tell the user it's open at the printed URL (default
`http://127.0.0.1:8787`). If the script exits non-zero, show the tail of its
output — it prints the reason (e.g. `git`/`node` missing, or a port in use).

## Notes

- Runs entirely locally; nothing leaves the machine.
- Override the port with `CLAUDE_CONFIG_MANAGER_PORT`, or the install location
  with `CLAUDE_CONFIG_MANAGER_DIR`.
- Requires `git` and `node`/`npm` on PATH.
