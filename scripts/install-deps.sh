#!/usr/bin/env bash
set -euo pipefail

# Claude Code Cloud Agent uses a fresh VM. Local sessions keep their existing
# dependency setup and do not run this hook.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

npm ci
