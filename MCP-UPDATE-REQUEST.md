# Demande d'évolution — Lecture incrémentale du chat (filtrage temporel)

## Contexte

Je développe `foundry-ai-agent`, un pont qui connecte un compte Foundry dédié à
OpenCode (agent IA assistant MJ). Le pont lit le chat en **polling** toutes les
3 s pour détecter les chuchotements adressés au compte de l'agent.

Aujourd'hui, chaque cycle récupère **l'intégralité de l'historique du chat**
(plus de 2000 messages dans mon monde). À mesure que la partie avance, ce coût
croît sans borne (CPU, réseau, latence), alors que seuls quelques messages
récents sont pertinents.

## Comportement observé

Le pont appelle, via `FoundrySession.doc(...)` :

```js
session.doc("get", "ChatMessage", { query: { timestamp: { $gte: <ts> } } })
```

ce qui déclenche l'event socket `modifyDocument` (`action: "get"`,
`type: "ChatMessage"`, `operation.query`).

**Résultat constaté sur mon installation (Foundry 14.370, dnd5e 6.1.0) :** le
filtre `timestamp: { $gte }` **n'est pas honoré** — la réponse contient tous les
messages, y compris ceux antérieurs au seuil. J'ai donc dû ajouter une sonde de
vérification + un fallback vers le polling complet (PR #5 de mon projet).

## Demande

Permettre une **lecture incrémentale** du chat, c'est-à-dire ne renvoyer que les
messages dont le `timestamp` (ou `_stats.createdTime`) est **supérieur ou égal**
à un seuil fourni par le client. Idéalement :

1. **Option A (préférée)** — faire en sorte que `modifyDocument` / `doc("get", ...)`
   respecte un query avec opérateur, au minimum `{ timestamp: { $gte: <ms> } }`
   sur `ChatMessage`. Cela rend la lecture incrémentale transparente pour les
   clients existants.
2. **Option B** — exposer un paramètre dédié dans l'outil `list_documents`
   (ex. `since_timestamp` ou `after: <messageId>`) qui filtre côté serveur et
   renvoie un ordre chronologique stable.
3. **Option C** — un endpoint/event dédié `getChatSince` renvoyant
   `{ messages, latestTimestamp }` pour permettre au client de maintenir un
   curseur.

## Contraintes / compatibilité

- **Rétrocompatibilité** : un client qui n'utilise pas le filtre doit continuer
  à recevoir l'historique complet (comportement actuel).
- **Ordre stable** : la réponse filtrée doit rester déterministe (par
  `timestamp` puis `_id`) pour permettre un curseur fiable.
- **Sémantique du seuil** : `>=` (inclusif) est important pour ne pas perdre un
  message arrivé à la même milliseconde qu'un autre déjà traité.
- Idéalement, exposer aussi le `latestTimestamp` observé pour aider le client à
  caler son prochain curseur sans dépendre de l'horloge murale.

## Bénéfice

- Réduction massive du volume transféré (seule la fenêtre récente remonte).
- Latence et CPU en baisse, montée en charge du monde sans dégradation.
- Le pont peut alors activer l'incrémental automatiquement (il détecte déjà le
  support via une sonde et retombe proprement sur le polling complet sinon).

## Pistes de test

1. `get ChatMessage` avec `{ timestamp: { $gte: T } }` ne renvoie que les
   messages `>= T`.
2. Un message créé pendant l'appel est bien renvoyé au cycle suivant.
3. Deux messages au même `timestamp` sont tous deux renvoyés (inclusivité).
4. Sans filtre, l'historique complet est renvoyé (non-régression).

---

*Ouvert depuis le projet `foundry-ai-agent`. Je peux fournir un correctif côté
client (sonde + fallback) déjà en place, et un test d'intégration si utile.*