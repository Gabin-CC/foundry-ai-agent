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
- Traitement des demandes dans l'ordre pour chaque joueur, avec jusqu'à trois
  joueurs servis en parallèle par défaut. Les nouveaux messages continuent
  d'être détectés pendant les réponses du modèle.
- Détection automatique de la prise en charge des filtres temporels par
  Foundry : lectures incrémentales si le filtre fonctionne, sinon lectures
  complètes comme auparavant.
- Test de connexion en lecture seule sur le vrai serveur Foundry, indépendant
  des tests unitaires.
- Transmission du rôle Foundry du joueur dans chaque demande.
- Accès aux fonctions Foundry via MCP (lecture, jets, interactions).
- Recherche locale en lecture seule dans le SRD officiel 5.2.1 **anglais**,
  complétée si souhaité par des PDF privés, avec références aux pages exactes.
- Installation en anglais ou en français, avec réponses de l'assistant dans
  la langue de l'interlocuteur (français par défaut).

## Prérequis

- Node.js **20 minimum**, npm et Git (le client Foundry est installé depuis
  un commit GitHub figé, car il n'est pas publié sur npm).
- [OpenCode](https://opencode.ai/docs/) installé et accessible dans le `PATH`.
- Un serveur Foundry VTT avec un point d'accès MCP (par exemple,
  `foundry-vtt-mcp-server`).
- Un compte Foundry dédié à l'agent, généralement **assistant MJ**.
- Une clé API pour un fournisseur de modèles compatible avec OpenCode.
- Sous Linux, l'utilitaire `script` (util-linux), utilisé par le pont actuel
  pour créer un pseudo-terminal.
- Pour les règles sourcées, `pdftotext` (paquet `poppler-utils`) et un accès
  HTTPS ponctuel au SRD officiel, ou une copie locale du même PDF.

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

Il vérifie Node.js, installe les dépendances npm depuis le fichier de verrouillage et crée `.env` à partir de
`.env.example` si nécessaire. **Un `.env` existant n'est jamais écrasé.**
L'option `--skip-deps` permet d'ignorer l'installation des dépendances.

Pour une installation manuelle :

```bash
npm ci
cp .env.example .env
```

Renseigne ensuite les valeurs de `.env` :

- `AI_PASSWORD` : mot de passe du compte Foundry de l'agent.
- `OPENROUTER_API_KEY` : clé du fournisseur de modèles choisi (OpenRouter
  dans la configuration d'exemple).
- `FOUNDRY_MCP_URL` : adresse du serveur MCP.
- `FOUNDRY_MCP_AUTH_B64` : identifiants MCP en Basic encodés en Base64.
- `FOUNDRY_MCP_MODULE` : `foundry-vtt-mcp-server/src/foundry.mjs` (fourni par
  la dépendance GitHub figée), ou chemin absolu du module client local.
  L'ancienne valeur contenant uniquement le nom du paquet reste compatible.

Exemple de génération du mot de passe encodé :

```bash
printf 'AI:mot-de-passe' | base64
```

## Démarrage

```bash
./run.sh
```

Un exemple de service systemd est fourni dans
`foundry-ai-agent.service`. Il fonctionne sous un compte système non privilégié
`foundry-agent` plutôt que sous root. Si l'agent est installé dans
`/opt/foundry-ai-agent`, crée ce compte et autorise l'accès à la configuration
et aux fichiers de reprise :

```bash
sudo groupadd --system foundry-agent
sudo useradd --system --gid foundry-agent --home-dir /var/lib/foundry-agent --create-home --shell /usr/sbin/nologin foundry-agent
sudo install -d -m 700 -o foundry-agent -g foundry-agent /opt/foundry-ai-agent/.state
sudo chown foundry-agent:foundry-agent /opt/foundry-ai-agent/.env
sudo chown -R foundry-agent:foundry-agent /opt/foundry-ai-agent/.state
sudo chmod 600 /opt/foundry-ai-agent/.env
sudo install -m 644 foundry-ai-agent.service /etc/systemd/system/foundry-ai-agent.service
sudo systemctl daemon-reload
sudo systemctl enable --now foundry-ai-agent
journalctl -u foundry-ai-agent -f
```

La création du compte ne se fait qu'une fois ; ignore ces commandes s'il
existe déjà. Vérifie qu'OpenCode est disponible dans le `PATH` du service
(ou renseigne le chemin absolu dans `OPENCODE_BIN`) et que ce compte peut
écrire dans `/var/lib/foundry-agent`. Adapte les chemins si nécessaire.
**Si ton service actuel fonctionne sous root, ne remplace pas son unité avant
d'avoir créé ce compte et adapté les droits.** La fusion du code seule ne
modifie pas le service déjà installé. Pense aussi à sauvegarder ou migrer les
données de session OpenCode stockées dans le répertoire personnel de root :
sinon, les identifiants de session des joueurs peuvent devenir introuvables.
Il n'est pas nécessaire de changer de compte pour simplement mettre le code
à jour.

Dans Foundry, adresse un chuchotement au compte `AI` :

```text
/whisper AI Bonjour, peux-tu lancer un jet de perception ?
```

La réponse arrive en message privé.

## Règles D&D 2024 avec sources vérifiables

Le fichier `AGENTS.md` est configuré pour **D&D 2024, sans règles maison**.
Pour chaque question de règles, l'IA doit rechercher le passage pertinent
dans le **SRD 5.2.1 anglais**, grâce à son serveur MCP local, et citer la
**page exacte du PDF officiel**. Elle peut chercher en anglais puis expliquer
le résultat en français. Cet outil est en lecture seule et ne modifie
jamais les données Foundry.

Après `npm ci`, prépare une fois le corpus depuis le dossier du projet :

```bash
# Debian/Ubuntu : sudo apt install poppler-utils
npm run rules:setup
```

Cette commande télécharge le PDF anglais officiel et crée l'index local
`.rules/`, ignoré par Git. Il n'emploie **ni le SRD 5.1 ni les règles 2014**.
Sans téléchargement, tu peux indiquer ton exemplaire du même PDF :
`npm run rules:setup -- --en /chemin/vers/SRD_CC_v5.2.1.pdf`.
Conserve `.rules/` pendant les déploiements ; le compte `foundry-agent`
doit pouvoir le lire. Pour un service non-root, exécute idéalement la préparation
avec ce compte, dans un dossier `.rules/` dont il est propriétaire.
Si OpenCode tourne déjà, redémarre le pont après la préparation.

### Ajouter ses propres livres PDF

Si tu possèdes d'autres livres de règles officiels compatibles D&D 2024,
dépose leurs PDF **directement dans `rules-private/`**, par exemple :

```text
rules-private/Players_Handbook_2024.pdf
rules-private/Dungeon_Masters_Guide_2024.pdf
```

Puis relance `npm run rules:setup` et redémarre le pont. L'agent pourra
interroger le SRD **et** les livres présents, avec une citation « nom du PDF,
page PDF ». Tes livres et l'index restent **exclus de Git** : seul le mode
d'emploi du dossier est public. Les fichiers doivent contenir du texte
extractible (pas de simples scans sans OCR). Il n'y a pas de plafond de taille
arbitraire par PDF, mais les gros livres peuvent demander plus de mémoire,
d'espace disque et de temps d'indexation.
L'agent ne peut pas certifier automatiquement qu'un PDF ajouté correspond
réellement aux règles 2024 ; n'ajoute ni règles 2014 ni documents maison.

**Confidentialité importante :** les PDF restent sur le serveur, mais les
**extraits retrouvés sont transmis par OpenCode à ton fournisseur IA** pour
générer les réponses. Assure-toi d'avoir le droit et de souhaiter cet usage.

**Limites :** le SRD ne contient **pas toutes** les règles des livres achetés.
Le dépôt ne distribue aucun livre commercial. Si une réponse n'est pas
vérifiable dans les sources disponibles, l'IA doit l'indiquer plutôt que
l'inventer. Ses consignes ne garantissent pas à elles seules l'exactitude :
vérifie une citation lors d'un arbitrage important.

Attribution du SRD 5.2.1 (CC-BY-4.0) :

> This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

## Vérification avant publication

Exécute les tests unitaires :

```bash
npm test
```

Une fois `.env` renseigné et Foundry démarré, **arrête d'abord le service de
l'agent** pour éviter deux connexions du même compte. Vérifie la connexion réelle,
**sans envoyer de message, démarrer OpenCode ou modifier la partie** :

```bash
npm run smoke:foundry
```

Ce test ouvre une session avec `AI_USER`, lit les listes `User` et
`ChatMessage`, affiche uniquement leur taille puis referme la connexion.
Il ne valide pas la clé du modèle, le serveur MCP HTTP ni le traitement
complet des chuchotements. Pour ce dernier point, lance `./run.sh` et envoie
un vrai whisper depuis Foundry ; vérifie la réponse HTML, la reprise de
session par joueur et la conservation de `.state/` après redémarrage.
Voir la [checklist de release](docs/RELEASE_CHECKLIST.md).

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
| `FOUNDRY_MCP_MODULE` | `foundry-vtt-mcp-server/src/foundry.mjs` | Module `FoundrySession` |
| `POLL_MS` | `3000` | Intervalle en millisecondes |
| `MAX_REPLY` | `4000` | Taille maximale d'une réponse |
| `RESET_MS` | `86400000` | Délai d'inactivité avant réinitialisation |
| `RESET_MSGS` | `1000` | Nombre maximum de messages par session |
| `MAX_CONCURRENT` | `3` | Joueurs traités simultanément (de 1 à 16) |
| `CHAT_FILTER_MODE` | `auto` | Test du filtrage temporel (`off` = lecture complète) |
| `CHAT_RESYNC_MS` | `120000` | Intervalle entre deux relectures complètes (ms) |
| `CHAT_LOOKBACK_MS` | `120000` | Chevauchement des requêtes incrémentales (ms) |
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
- Les citations de règles dépendent aussi du bon usage des outils par l'IA :
  une preuve absente ou insuffisante ne permet pas d'affirmer une règle.
- L'exemple systemd utilise un compte non privilégié. `.env`, `.state/` et
  le répertoire OpenCode doivent être accessibles à ce compte.
- Au premier lancement, les messages déjà présents sont considérés comme
  historiques. Ensuite, la reprise s'effectue à partir du dernier message
  traité **pour chaque joueur**. Les anciens fichiers d'état sont repris
  automatiquement. Conserve le répertoire `.state/` entre les déploiements et assure-toi
  que le compte du service peut y écrire. Il ne contient pas les messages,
  seulement leurs identifiants et ceux des sessions OpenCode.
- La livraison est **au moins une fois**, et non exactement une fois : un
  plantage entre l'envoi d'une réponse et l'enregistrement du point de reprise
  peut entraîner une réponse ou une action MCP en double.
- Le pont vérifie d'abord le résultat d'une requête temporelle sur des
  messages réels. Il n'active les lectures incrémentales que si les
  identifiants correspondent. Une relecture complète est réalisée toutes
  les deux minutes par défaut, et le mode complet est rétabli en cas d'erreur
  ou d'incohérence. Un message omis peut donc être récupéré avec un délai
  allant jusqu'à la prochaine relecture complète.
- Les tests unitaires simulent Foundry et OpenCode. Le test de connexion
  en lecture seule vérifie la connexion réelle, mais le parcours complet
  des chuchotements doit aussi être validé avant déploiement.

En cas de comportement inattendu sur ta version de Foundry/MCP, renseigne
`CHAT_FILTER_MODE=off` dans `.env` puis redémarre le pont. Cela rétablit les
lectures complètes sans supprimer les conversations ni les points de reprise.

## Contribution et licence

Consulte [CONTRIBUTING.md](CONTRIBUTING.md) pour contribuer et
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) pour les règles de la communauté.

Licence MIT — voir [LICENSE](LICENSE).
