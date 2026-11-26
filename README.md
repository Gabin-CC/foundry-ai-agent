# foundry-ai-agent

Un **agent IA assistant MJ** pour [Foundry VTT](https://foundryvtt.com/) : il
écoute les **chuchotements** (whispers) adressés à un compte dédié, transmet le
message à [opencode](https://opencode.ai) (qui raisonne via un LLM et agit sur le
monde par **MCP**), puis répond en **whisper privé** en HTML.

> Statut : **assistant MJ public**. N'importe quel joueur (ou le MJ) peut lui
> parler en chuchotement. Les outils MJ (`gm_*`) restent réservés au MJ / aux
> assistants MJ via le prompt `AGENTS.md`.

## Fonctionnalités

- **Écoute par polling** des messages de chat (robuste, sans dépendre des
  broadcasts socket d'un client headless).
- **Réponse en whisper privé** (HTML, rendu natif Foundry : gras, listes…).
- **Un fil de conversation par interlocuteur** (session opencode dédiée), avec
  **reset automatique** après 24 h d'inactivité ou 1000 messages.
- **Rôle transmis au LLM** à chaque message (MJ / assistant MJ / joueur), lu
  depuis la table `User` de Foundry.
- **Agent = compte MJ assistant** via MCP : lit/écrit les documents, lance des
  jets, etc.

## Architecture

```
Foundry (chat whispers) ──polling──▶ listen.mjs ──exec──▶ opencode run ──MCP──▶ Foundry
        ▲                                   │
        └────────── whisper (HTML) ◀────────┘
```

- `listen.mjs` : le pont (polling, fils, reset, réponse).
- `opencode.json` : modèle + connexion MCP (variables `{env:...}`).
- `AGENTS.md` : prompt système (rôle, sécurité, format HTML).
- `run.sh` : charge `.env` puis lance `listen.mjs`.

## Prérequis

- **Node.js ≥ 20**
- **opencode** installé (`opencode` dans le `PATH`)
- Un **serveur MCP Foundry** joignable (ex. `foundry-vtt-mcp-server`)
- Un **compte Foundry dédié** (rôle *assistant MJ*) pour l'agent
- Une **clé API** d'un provider supporté par opencode (ex. OpenRouter)

> Note : opencode exige un **pseudo-terminal (TTY)**. Le pont lance donc
> `opencode` via `script -q -e -c …` pour lui fournir un pty (sinon il bloque).

## Installation

```bash
git clone <ce-repo> foundry-ai-agent
cd foundry-ai-agent
npm install            # installe @foundry-vtt-mcp/server
cp .env.example .env   # puis remplis les valeurs
chmod +x run.sh
```

Renseigne au minimum dans `.env` :

- `AI_PASSWORD` : mot de passe du compte Foundry de l'agent
- `OPENROUTER_API_KEY` : ta clé provider
- `FOUNDRY_MCP_URL` et `FOUNDRY_MCP_AUTH_B64` : connexion MCP
  (`printf 'AI:monmotdepasse' | base64`)

## Lancement

### Manuel

```bash
./run.sh
```

### Service systemd (production)

```bash
sudo cp foundry-ai-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now foundry-ai-agent
journalctl -u foundry-ai-agent -f
```

## Configuration (variables d'env)

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `AI_USER` | `AI` | Nom du compte Foundry de l'agent |
| `AI_PASSWORD` | — | Mot de passe du compte (requis) |
| `ADMIN_PASSWORD` | vide | Mot de passe admin Foundry (optionnel) |
| `ALLOWED_SENDERS` | vide | Ids Foundry autorisés (vide = tout le monde) |
| `OPENCODE_BIN` | `opencode` | Chemin de l'exécutable opencode |
| `OPENCODE_MODEL` | `openrouter/baidu/ernie-5.5-flash-preview:free` | Modèle |
| `OPENROUTER_API_KEY` | — | Clé provider |
| `FOUNDRY_MCP_URL` | `http://127.0.0.1:8808/mcp` | URL du MCP |
| `FOUNDRY_MCP_AUTH_B64` | — | En-tête Basic base64 du MCP |
| `POLL_MS` | `3000` | Intervalle de polling (ms) |
| `MAX_REPLY` | `4000` | Taille max d'une réponse |
| `RESET_MS` | `86400000` | Reset du fil après inactivité (24 h) |
| `RESET_MSGS` | `1000` | Reset du fil après N messages |

## Utilisation

En jeu, chuchote au compte de l'agent :

```
/whisper AI Bonjour, peux-tu lancer un jet de perception ?
```

La réponse revient en **whisper privé**, en HTML.

## Sécurité

- **Ne versionne jamais `.env`** (il contient les secrets). `.gitignore` le
  protège.
- Utilise un **compte Foundry dédié** au rôle *assistant MJ*, pas ton compte MJ.
- Le prompt `AGENTS.md` empêche l'usage des outils `gm_*` par les joueurs, mais
  **ce n'est pas une barrière de sécurité stricte** : l'agent agit avec les
  droits de son compte. Restreins `ALLOWED_SENDERS` ou les droits du compte
  selon ton besoin.

## Licence

MIT — voir [LICENSE](LICENSE).