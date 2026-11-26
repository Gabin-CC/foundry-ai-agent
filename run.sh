#!/usr/bin/env bash
# Start the Foundry chat -> OpenCode bridge.
# Configuration is supplied through environment variables (see .env.example).
set -euo pipefail
cd "$(dirname "$0")"

# Source .env if present (useful for local development).
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

: "${AI_PASSWORD:?set AI_PASSWORD (password for the dedicated Foundry account)}"
export AI_USER="${AI_USER:-AI}"
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
export ALLOWED_SENDERS="${ALLOWED_SENDERS:-}"
export OPENCODE_BIN="${OPENCODE_BIN:-opencode}"
export AGENT_DIR="$PWD"

exec node listen.mjs
