#!/usr/bin/env bash
# Interactive, bilingual installer for the Foundry AI Agent bridge.
set -euo pipefail

cd "$(dirname "$0")"

language=""
interactive=1
skip_deps=0
install_opencode=0
skip_opencode=0
opencode_bin="${OPENCODE_BIN:-opencode}"

usage() {
  printf '%s\n' \
    'Usage / Utilisation: ./install.sh [--lang en|fr] [--non-interactive] [--skip-deps] [--install-opencode|--skip-opencode] [--opencode-bin PATH]' \
    '  --lang en|fr       Installation language / Langue d’installation' \
    '  --non-interactive  Use the selected or detected language without asking' \
    '  --skip-deps        Skip npm installation / Ignorer l’installation npm' \
    '  --install-opencode Install V2 globally / Installer V2 globalement (opt-in)' \
    '  --skip-opencode    Defer V2 check / Reporter la vérification V2' \
    '  --opencode-bin P   Check executable / Vérifier cet exécutable' \
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
    --install-opencode) install_opencode=1; shift ;;
    --skip-opencode) skip_opencode=1; shift ;;
    --opencode-bin)
      if (( $# < 2 )); then usage >&2; exit 2; fi
      opencode_bin="$2"
      shift 2
      ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option / Option inconnue: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

if (( install_opencode && skip_opencode )); then
  printf '%s\n' 'Choose --install-opencode or --skip-opencode, not both. / Choisis une seule option.' >&2
  exit 2
fi

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
    en:done) printf 'Next: edit .env, verify OpenCode V2 as the service user, then run ./run.sh.\n' ;;
    fr:done) printf 'Suite : renseigne .env, vérifie OpenCode V2 avec le compte du service, puis lance ./run.sh.\n' ;;
    en:opencode_ok) printf 'OpenCode V2 prerequisite satisfied.\n' ;;
    fr:opencode_ok) printf 'Prérequis OpenCode V2 validé.\n' ;;
    en:opencode_missing) printf 'OpenCode V2 is missing or incompatible (V1 is unsupported).\n' ;;
    fr:opencode_missing) printf 'OpenCode V2 est absent ou incompatible (V1 non pris en charge).\n' ;;
    en:opencode_prompt) printf 'Install OpenCode V2 globally from @opencode/cli@^2 with npm? [y/N] ' ;;
    fr:opencode_prompt) printf 'Installer OpenCode V2 globalement avec npm via @opencode/cli@^2 ? [o/N] ' ;;
    en:opencode_install) printf 'Installing OpenCode V2 from official npm package @opencode/cli...\n' ;;
    fr:opencode_install) printf 'Installation d’OpenCode V2 depuis le paquet npm officiel @opencode/cli...\n' ;;
    en:opencode_failed) printf 'Installation/check failed. If opencode-ai V1 conflicts, remove it manually, then retry. See docs/OPENCODE_V2.md.\n' ;;
    fr:opencode_failed) printf 'Échec de l’installation/vérification. Si opencode-ai V1 gêne, désinstalle-le manuellement puis réessaie. Voir docs/OPENCODE_V2.md.\n' ;;
    en:opencode_manual) printf 'Install V2 yourself (npm install -g @opencode/cli@^2) or rerun with --install-opencode. Use --skip-opencode only to defer the check.\n' ;;
    fr:opencode_manual) printf 'Installe V2 (npm install -g @opencode/cli@^2) ou relance avec --install-opencode. --skip-opencode reporte uniquement le contrôle.\n' ;;
    en:opencode_skipped) printf 'OpenCode V2 check skipped; the bridge will refuse to start without V2.\n' ;;
    fr:opencode_skipped) printf 'Vérification OpenCode V2 ignorée ; le pont refusera de démarrer sans V2.\n' ;;
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

if (( skip_opencode )); then
  message opencode_skipped
elif node scripts/check-opencode-v2.mjs --binary "$opencode_bin" >/dev/null 2>&1; then
  message opencode_ok
else
  message opencode_missing >&2
  if (( !install_opencode && interactive )) && [[ -t 0 ]]; then
    message opencode_prompt
    IFS= read -r answer || answer=""
    case "$answer" in
      y|Y|yes|YES|o|O|oui|OUI) install_opencode=1 ;;
    esac
  fi
  if (( !install_opencode )); then
    message opencode_manual >&2
    exit 1
  fi
  if ! command -v npm >/dev/null 2>&1; then
    message npm_missing >&2
    exit 1
  fi
  message opencode_install
  # Never uninstall/overwrite a V1 package silently. npm will report a
  # conflicting executable, which the operator must resolve explicitly.
  if ! npm install --global '@opencode/cli@^2' ||
     ! node scripts/check-opencode-v2.mjs --binary "$opencode_bin"; then
    message opencode_failed >&2
    exit 1
  fi
  message opencode_ok
fi
message done
