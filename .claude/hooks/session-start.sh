#!/bin/bash
set -euo pipefail

# Only run in remote (web) environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

echo '{"async": true, "asyncTimeout": 300000}'

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
npm install

# Restore global CLI tools
npm install -g notebooklm 2>/dev/null || true
