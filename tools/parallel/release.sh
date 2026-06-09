#!/usr/bin/env bash
# release.sh — Mark a subsystem complete in the coordinator.
#
# Part of the BrowserGame parallel-session protocol (see CLAUDE_PARALLEL.md),
# adapted from DuetOS. In the shared-tree sub-agent model the orchestrator owns
# integration + git, so this just flips the claim ACTIVE -> DONE. Pass --push to
# also push the current branch (multi-machine git model).
#
# Usage:   tools/parallel/release.sh <subsystem> [--push]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT"

WORK_FILE="PARALLEL_WORK.md"
TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

SUBSYSTEM="${1:-}"
PUSH_FLAG="${2:-}"

if [[ -z "$SUBSYSTEM" ]]; then
    echo "Usage: $0 <subsystem> [--push]"
    exit 1
fi
if [[ ! -f "$WORK_FILE" ]]; then
    echo "ERROR: $WORK_FILE not found. Nothing to release."
    exit 1
fi

# Flip the subsystem's marker ACTIVE -> DONE and stamp completion on its Status.
awk -v subsystem="$SUBSYSTEM" -v timestamp="$TIMESTAMP" '
    /^### ACTIVE / && $3 == subsystem { sub(/ACTIVE/, "DONE"); found = 1 }
    found && /- \*\*Status\*\*: IN PROGRESS/ {
        sub(/IN PROGRESS/, "COMPLETED @ " timestamp); found = 0
    }
    { print }
' "$WORK_FILE" > "${WORK_FILE}.tmp" && mv "${WORK_FILE}.tmp" "$WORK_FILE"

echo "OK Released: ${SUBSYSTEM}"

if [[ "$PUSH_FLAG" == "--push" ]]; then
    BRANCH="$(git rev-parse --abbrev-ref HEAD)"
    echo "-> Pushing ${BRANCH}..."
    git push -u origin "${BRANCH}" --force-with-lease
fi
