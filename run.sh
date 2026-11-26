#!/usr/bin/env bash
# Lance le pont chat Foundry -> opencode (agent IA MJ public).
# Toute la configuration passe par l'environnement (voir .env.example).
set -euo pipefail
cd "$(dirname "$0")"

# Charge .env s'il existe (optionnel en production, pratique en dev).
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

: "${AI_PASSWORD:?définir AI_PASSWORD (mot de passe du compte Foundry AI)}"
export AI_USER="${AI_USER:-AI}"
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
export ALLOWED_SENDERS="${ALLOWED_SENDERS:-}"
export OPENCODE_BIN="${OPENCODE_BIN:-opencode}"
export AGENT_DIR="$PWD"

exec node listen.mjs