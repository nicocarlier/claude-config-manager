#!/usr/bin/env bash
# Launch the Claude Config Manager web UI.
# Clones/updates the app, installs deps on first run, starts the local server
# (detached), and opens the browser. Safe to re-run - reuses a running server.
set -euo pipefail

REPO_URL="https://github.com/nicocarlier/claude-config-manager.git"
APP_DIR="${CLAUDE_CONFIG_MANAGER_DIR:-$HOME/.claude-config-manager}"
PORT="${CLAUDE_CONFIG_MANAGER_PORT:-8787}"
URL="http://127.0.0.1:${PORT}"

open_url() {
  if command -v open >/dev/null 2>&1; then open "$1"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1 || true
  else echo "Open $1 in your browser."; fi
}

is_up() { curl -fsS -o /dev/null "$URL" 2>/dev/null; }

# Already running? Just reopen it.
if is_up; then
  echo "Claude Config Manager already running at $URL"
  open_url "$URL"
  exit 0
fi

command -v git >/dev/null 2>&1 || { echo "git is required but not on PATH."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "node/npm is required but not on PATH."; exit 1; }

# Get or update the app.
if [ -d "$APP_DIR/.git" ]; then
  echo "Updating claude-config-manager..."
  git -C "$APP_DIR" pull --ff-only --quiet 2>/dev/null || echo "(update skipped; using existing copy)"
else
  echo "Cloning claude-config-manager into $APP_DIR..."
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"

# Install deps on first run.
if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run)..."
  npm install --silent
fi

# Start the server detached; this script opens the browser once it's up.
echo "Starting Claude Config Manager..."
LOG="$APP_DIR/.server.log"
NO_OPEN=1 PORT="$PORT" nohup npm start >"$LOG" 2>&1 &

# Wait up to ~15s for it to come up.
for _ in $(seq 1 30); do
  is_up && break
  sleep 0.5
done

if is_up; then
  echo "Running at $URL"
  open_url "$URL"
else
  echo "Server did not start; last log lines:"
  tail -n 20 "$LOG" 2>/dev/null || true
  exit 1
fi
