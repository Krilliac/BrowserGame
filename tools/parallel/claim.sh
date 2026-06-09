#!/usr/bin/env bash
# claim.sh — Register a session/agent as owning a set of files.
#
# Part of the BrowserGame parallel-session protocol (see CLAUDE_PARALLEL.md),
# adapted from DuetOS. In this repo, parallel work is usually done by sub-agents
# sharing one working tree, so a claim is an OWNERSHIP RECORD in the coordinator
# file PARALLEL_WORK.md — not a branch operation. Partition by files; the
# orchestrator integrates.
#
# Usage:   tools/parallel/claim.sh <subsystem> <files_or_dirs> [description]
# Example: tools/parallel/claim.sh progression "src/server/progression.ts" "XP + leveling"
#
# Exit codes: 0 claimed, 2 conflict with an active claim on the same files.
#
# Env:
#   CLAUDE_SESSION_ID  — session/agent identifier (default: host-PID).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT"

WORK_FILE="PARALLEL_WORK.md"
SESSION_ID="${CLAUDE_SESSION_ID:-$(hostname)-$$}"
TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

SUBSYSTEM="${1:-}"
FILES="${2:-}"
DESCRIPTION="${3:-No description provided}"

if [[ -z "$SUBSYSTEM" || -z "$FILES" ]]; then
    echo "Usage: $0 <subsystem> <files_or_dirs> [description]"
    echo "Example: $0 progression 'src/server/progression.ts' 'XP + leveling'"
    exit 1
fi

# Bootstrap the coordinator file on first use.
if [[ ! -f "$WORK_FILE" ]]; then
    cat > "$WORK_FILE" <<'EOF'
# Parallel Work Coordinator

Auto-managed by tools/parallel/claim.sh and release.sh — do not edit by hand.
See CLAUDE_PARALLEL.md for the protocol.

## Sessions
EOF
fi

# Warn if the target files are already claimed by an ACTIVE session.
CONFLICT_BLOCK="$(awk -v f="$FILES" '
    function flush() { if (show && blk != "") print blk; show = 0 }
    /^### / { flush(); active = ($0 ~ /ACTIVE/); blk = $0; next }
    blk != "" { blk = blk "\n" $0 }
    active && /\*\*Files\*\*:/ {
        v = $0; sub(/^[^`]*`/, "", v); sub(/`.*/, "", v)
        if (v == f) show = 1
    }
    END { flush() }
' "$WORK_FILE")"
if [[ -n "$CONFLICT_BLOCK" ]]; then
    echo "!! CONFLICT: '$FILES' is already claimed by an active session:"
    echo "$CONFLICT_BLOCK"
    echo "Coordinate or pick a different scope. Not claiming."
    exit 2
fi

# Append the claim entry.
cat >> "$WORK_FILE" <<EOF

### ACTIVE ${SUBSYSTEM}
- **Session**: \`${SESSION_ID}\`
- **Files**: \`${FILES}\`
- **Description**: ${DESCRIPTION}
- **Claimed**: ${TIMESTAMP}
- **Status**: IN PROGRESS
EOF

echo "OK Claimed: ${SUBSYSTEM}"
echo "   Files:   ${FILES}"
echo "   Session: ${SESSION_ID}"
echo "When done: tools/parallel/release.sh ${SUBSYSTEM}"
