#!/usr/bin/env bash
# Sync pr-watch from this repo to ~/.claude/pr-watch (global Claude install).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${PR_WATCH_HOME:-$HOME/.claude/pr-watch}"
CMD_DEST="${PR_WATCH_COMMANDS:-$HOME/.claude/commands}"

mkdir -p "$DEST"
cp "$ROOT/poll.mjs" "$ROOT/lib.mjs" "$ROOT/index.html" "$ROOT/styles.css" "$ROOT/app.js" "$DEST/"

if [[ -f "$ROOT/pr-watch.md" ]]; then
  mkdir -p "$CMD_DEST"
  cp "$ROOT/pr-watch.md" "$CMD_DEST/pr-watch.md"
fi

VERSION="$(sed -n '2p' "$DEST/poll.mjs" | sed 's/.*version //')"
echo "Synced pr-watch ${VERSION} → ${DEST}"
[[ -f "$CMD_DEST/pr-watch.md" ]] && echo "Command → ${CMD_DEST}/pr-watch.md"

if [[ "${1:-}" == "--test" ]]; then
  echo ""
  echo "── Unit tests (repo lib.mjs) ──"
  node --test "$ROOT/test/poll.test.mjs"
  echo ""
  echo "── Smoke tests (global lib.mjs) ──"
  PR_WATCH_HOME="$DEST" node "$ROOT/scripts/smoke-global.mjs"
fi
