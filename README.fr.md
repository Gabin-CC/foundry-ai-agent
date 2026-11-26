# Foundry AI Agent

Français · [English](README.md)

**Assistant IA pour Foundry VTT** : il reçoit les chuchotements adressés à un
compte dédié, transmet les demandes à [OpenCode](https://opencode.ai/) qui
utilise les outils MCP de Foundry, puis répond dans le chat privé en HTML.

Le pont est conçu pour un **groupe de joueurs de confiance**. Par défaut,
tous les joueurs peuvent interroger l'assistant. Les consignes réservant les
outils MJ au MJ et aux assistants MJ reposent sur le modèle : elles ne
constituent pas une restriction technique des permissions.

## Fonctionnalités

- Récupération des chuchotements par interrogation régulière du chat.
- Réponses privées au format HTML de Foundry.
- Une session OpenCode par interlocuteur, réinitialisée par défaut après
  24 heures d'inactivité ou 1 000 messages.
- Sauvegarde locale du dernier message traité et des identifiants de session
  pour reprendre les nouveaux messages après redémarrage.
- Transmission du rôle Foundry du joueur dans chaque demande.
- Accès aux fonctions Foundry via MCP (lecture, jets, interactions).
- Installation en anglais ou en français, avec réponses de l'assistant dans
  la langue de l'interlocuteur (français par défaut).

## Prérequis

- Node.js **20 minimum** et npm.
- [OpenCode](https://opencode.ai/docs/) installé et accessible dans le `PATH`.
- Un serveur Foundry VTT avec un point d'accès MCP (par exemple,
  `foundry-vtt-mcp-server`).
- Un compte Foundry dédié à l'agent, généralement **assistant MJ**.
- Une clé API pour un fournisseur de modèles compatible avec OpenCode.
- Sous Linux, l'utilitaire `script` (util-linux), utilisé par le pont actuel
  pour créer un pseudo-terminal.

## Installation

```bash
git clone https://github.com/Gabin-CC/foundry-ai-agent.git
cd foundry-ai-agent
./install.sh
```

L'installateur détecte la langue du système et permet de choisir entre
**English** et **Français**. Le choix peut aussi être forcé :

```bash
./install.sh --lang fr
./install.sh --lang en
./install.sh --lang fr --non-interactive
```

Il vérifie Node.js, installe les dépendances npm et crée `.env` à partir de
`.env.example` si nécessaire. **Un `.env` existant n'est jamais écrasé.**
L'option `--skip-deps` permet d'ignorer l'installation des dépendances.

Pour une installation manuelle :

```bash
npm install
cp .env.example .env
```

Renseigne ensuite les valeurs de `.env` :

- `AI_PASSWORD` : mot de passe du compte Foundry de l'agent.
- `OPENROUTER_API_KEY` : clé du fournisseur de modèles choisi (OpenRouter
  dans la configuration d'exemple).
- `FOUNDRY_MCP_URL` : adresse du serveur MCP.
- `FOUNDRY_MCP_AUTH_B64` : identifiants MCP en Basic encodés en Base64.
- `FOUNDRY_MCP_MODULE` : module npm exposant `FoundrySession`, ou chemin
  absolu d'un module installé localement.

Exemple de génération du mot de passe encodé :

```bash
printf 'AI:mot-de-passe' | base64
```

## Démarrage

```bash
./run.sh
```

Un exemple de service systemd est fourni dans
`foundry-ai-agent.service`. Adapte les chemins et l'utilisateur système
avant de l'activer sur un serveur de production :

```bash
sudo cp foundry-ai-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now foundry-ai-agent
journalctl -u foundry-ai-agent -f
```

Dans Foundry, adresse un chuchotement au compte `AI` :

```text
/whisper AI Bonjour, peux-tu lancer un jet de perception ?
```

La réponse arrive en message privé.

## Variables de configuration

| Variable | Défaut | Fonction |
| --- | --- | --- |
| `AI_USER` | `AI` | Compte Foundry dédié |
| `AI_PASSWORD` | requis | Mot de passe du compte |
| `ADMIN_PASSWORD` | vide | Mot de passe administrateur optionnel |
| `ALLOWED_SENDERS` | vide | Identifiants autorisés (vide = tous) |
| `OPENCODE_BIN` | `opencode` | Exécutable OpenCode |
| `OPENCODE_MODEL` | modèle OpenRouter d'exemple | Identifiant du modèle |
| `OPENROUTER_API_KEY` | requis avec OpenRouter | Clé API |
| `FOUNDRY_MCP_URL` | `http://127.0.0.1:8808/mcp` | Adresse MCP |
| `FOUNDRY_MCP_AUTH_B64` | valeur d'exemple | Authentification MCP |
| `FOUNDRY_MCP_MODULE` | `foundry-vtt-mcp-server` | Module `FoundrySession` |
| `POLL_MS` | `3000` | Intervalle en millisecondes |
| `MAX_REPLY` | `4000` | Taille maximale d'une réponse |
| `RESET_MS` | `86400000` | Délai d'inactivité avant réinitialisation |
| `RESET_MSGS` | `1000` | Nombre maximum de messages par session |
| `STATE_FILE` | `.state/bridge-state.json` | Fichier local de reprise |

Exemple pour un module MCP installé localement :

```dotenv
FOUNDRY_MCP_MODULE=/opt/foundry-vtt-mcp-server/src/foundry.mjs
```

## Sécurité et limites

- Ne versionne jamais `.env` ni de véritables identifiants.
- Donne au compte Foundry uniquement les droits nécessaires à ton groupe.
- Les consignes de rôle de `AGENTS.md` ne sont pas un contrôle des permissions
  au niveau des outils MCP.
- Le service systemd doit être adapté à un utilisateur non privilégié.
- Au premier lancement, les messages déjà présents sont considérés comme
  historiques. Ensuite, la reprise s'effectue à partir du dernier message
  traité. Conserve le répertoire `.state/` entre les déploiements et assure-toi
  que le compte du service peut y écrire. Il ne contient pas les messages,
  seulement leurs identifiants et ceux des sessions OpenCode.
- La livraison est **au moins une fois**, et non exactement une fois : un
  plantage entre l'envoi d'une réponse et l'enregistrement du point de reprise
  peut entraîner une réponse ou une action MCP en double.
- Le pont continue d'interroger tout l'historique du chat. Les tests utilisent
  des interfaces Foundry et OpenCode simulées ; le fonctionnement réel doit
  être vérifié avant déploiement.

## Contribution et licence

Consulte [CONTRIBUTING.md](CONTRIBUTING.md) pour contribuer et
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) pour les règles de la communauté.

Licence MIT — voir [LICENSE](LICENSE).
