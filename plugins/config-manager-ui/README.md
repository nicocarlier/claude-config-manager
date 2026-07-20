# config-manager-ui

Open the [Claude Config Manager](https://github.com/nicocarlier/claude-config-manager)
— a local web UI that finds **all** your Claude Code config (global `~/.claude`
settings, instructions, skills, agents, memory, and every project's config) and
lets you view, edit, and delete it from one page. Each file is tagged **local**
(yours to edit) or **shared** (git-tracked — needs a PR).

## Install

```
/plugin marketplace add nicocarlier/claude-config-manager
/plugin install config-manager-ui@claude-config-manager
```

## Use

```
/config-manager-ui
```

First run clones the app into `~/.claude-config-manager`, installs dependencies,
starts a local server on `127.0.0.1`, and opens your browser. Later runs are
instant and reuse a running server.

## Requirements

`git` and `node`/`npm` on your PATH.

## Config

- `CLAUDE_CONFIG_MANAGER_PORT` — port (default `8787`)
- `CLAUDE_CONFIG_MANAGER_DIR` — install location (default `~/.claude-config-manager`)

Runs entirely locally; nothing leaves your machine.
