#!/bin/bash
# SessionStart hook — prepares a Claude Code on the web session so linters and tests
# are ready immediately. Synchronous: the session waits until deps are installed, which
# avoids race conditions where the agent runs `npm test`/`npm run lint` too early.
set -euo pipefail

# Only do work in the remote (web) environment; local machines manage their own deps.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# Idempotent: `npm install` is a no-op when node_modules is already in sync, and it
# benefits from the container's cached state between sessions.
echo "[session-start] installing npm dependencies…"
npm install --no-audit --no-fund

echo "[session-start] dependencies ready."
