#!/usr/bin/env bash
# Interactive, bilingual installer for the Foundry AI Agent bridge.
set -euo pipefail

cd "$(dirname "$0")"

language=""
interactive=1
skip_deps=0

usage() {
  printf '%s\n' \
    'Usage / Utilisation: ./install.sh [--lang en|fr] [--non-interactive] [--skip-deps]' \
    '  --lang en|fr       Installation language / Langue d’installation' \
    '  --non-interactive  Use the selected or detected language without asking' \
    '  --skip-deps        Skip npm installation / Ignorer l’installation npm' \
    '  --help             Show this help / Afficher cette aide'
}

while (( $# )); do
  case "$1" in
    --lang)
      if (( $# < 2 )); then usage >&2; exit 2; fi
      language="$2"
      shift 2
      ;;
    --lang=*) language="${1#*=}"; shift ;;
    --non-interactive) interactive=0; shift ;;
    --skip-deps) skip_deps=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option / Option inconnue: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

case "${LC_ALL:-${LC_MESSAGES:-${LANG:-en}}}" in
  fr*|FR*) detected_language="fr" ;;
  *) detected_language="en" ;;
esac

if [[ -z "$language" ]]; then
  language="$detected_language"
  if (( interactive )) && [[ -t 0 ]]; then
    printf 'Installation language / Langue d’installation [en/fr] (%s): ' "$language"
    IFS= read -r answer || answer=""
    if [[ -n "$answer" ]]; then language="$answer"; fi
  fi
fi

if [[ "$language" != "en" && "$language" != "fr" ]]; then
  printf 'Unsupported language / Langue non prise en charge: %s (en, fr)\n' "$language" >&2
  exit 2
fi

message() {
  case "$language:$1" in
    en:welcome) printf 'Installing Foundry AI Agent (English).\n' ;;
    fr:welcome) printf 'Installation de Foundry AI Agent (français).\n' ;;
    en:node_missing) printf 'Node.js 20 or later is required.\n' ;;
    fr:node_missing) printf 'Node.js 20 ou une version ultérieure est nécessaire.\n' ;;
    en:npm_missing) printf 'npm is required.\n' ;;
    fr:npm_missing) printf 'npm est nécessaire.\n' ;;
    en:deps) printf 'Installing Node.js dependencies...\n' ;;
    fr:deps) printf 'Installation des dépendances Node.js...\n' ;;
    en:deps_skipped) printf 'Skipping dependency installation.\n' ;;
    fr:deps_skipped) printf 'Installation des dépendances ignorée.\n' ;;
    en:env_created) printf 'Created .env from .env.example (owner-only permissions).\n' ;;
    fr:env_created) printf 'Fichier .env créé depuis .env.example (accès réservé au propriétaire).\n' ;;
    en:env_kept) printf 'Existing .env preserved.\n' ;;
    fr:env_kept) printf 'Fichier .env existant conservé.\n' ;;
    en:done) printf 'Next: edit .env with your credentials, install OpenCode, then run ./run.sh.\n' ;;
    fr:done) printf 'Suite : renseigne tes identifiants dans .env, installe OpenCode, puis lance ./run.sh.\n' ;;
    en:warning) printf 'Warning: OpenCode is not on PATH; install it before starting the agent.\n' ;;
    fr:warning) printf 'Attention : OpenCode est absent du PATH ; installe-le avant de lancer l’agent.\n' ;;
  esac
}

message welcome

if ! command -v node >/dev/null 2>&1; then
  message node_missing >&2
  exit 1
fi
node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( node_major < 20 )); then
  message node_missing >&2
  exit 1
fi

if (( skip_deps )); then
  message deps_skipped
else
  if ! command -v npm >/dev/null 2>&1; then
    message npm_missing >&2
    exit 1
  fi
  message deps
  if [[ -f package-lock.json ]]; then npm ci; else npm install; fi
fi

if [[ ! -e .env ]]; then
  (umask 077; cp .env.example .env)
  message env_created
else
  message env_kept
fi

if ! command -v opencode >/dev/null 2>&1; then message warning >&2; fi
message done
