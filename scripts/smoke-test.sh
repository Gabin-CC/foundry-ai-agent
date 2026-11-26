#!/usr/bin/env bash
# Load the same local credentials as run.sh without starting the message bridge.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

exec node scripts/smoke-test.mjs
