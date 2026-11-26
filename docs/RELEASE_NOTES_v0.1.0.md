# Foundry AI Agent v0.1.0

The first stable GitHub release of Foundry AI Agent, published on
November 26, 2026. The source is available from the `v0.1.0` Git tag.

## What it does

Foundry AI Agent is a lightweight chat bridge for a trusted Foundry VTT group.
Players or GMs whisper to a dedicated assistant account, the bridge forwards
their requests to OpenCode with Foundry MCP tools, and the assistant replies
privately in HTML chat.

## Highlights

- English source documentation, a French README, and an English/French
  interactive installer.
- A separate OpenCode conversation per sender, with saved session IDs and
  per-player checkpoints that survive restarts.
- Ordered requests per sender, with up to three concurrent senders by default.
- Chat polling that verifies timestamp-filter support before enabling it,
  with automatic full-polling fallback and regular resynchronization. The
  pinned Foundry client includes socket-backed chat caching and a 15-second
  full-history safety refresh, so supported installations avoid re-reading
  thousands of chat messages every cycle.
- Reproducible Node.js dependency installation using a lockfile and a pinned
  Foundry MCP client source, tested on Node.js 20 and 22.
- Read-only live Foundry login test, plus a non-root systemd service example.

## Install and verify

Requires Node.js 20+, npm, Git, OpenCode, a compatible Foundry MCP server and
a dedicated Foundry account. On Linux, the runtime also uses `script` from
util-linux.

```bash
git clone https://github.com/Gabin-CC/foundry-ai-agent.git
cd foundry-ai-agent
./install.sh --lang en
# Edit .env with your own Foundry and model-provider credentials.
npm test
# Stop the bridge service first, and keep Foundry running:
npm run smoke:foundry
./run.sh
```

Use `./install.sh --lang fr` for French installation messages. The smoke
test only logs in and reads users and chat history; it does not call OpenCode,
send chat messages, or modify game data. Complete the end-to-end test by
sending a harmless whisper to the assistant in Foundry.

## Important limitations

- Designed for a **trusted group**. GM tool restrictions in `AGENTS.md` are
  instructions to the model, not a technical authorization boundary.
- Delivery is **at least once**. An interrupted request can be retried and
  may duplicate a reply or a Foundry action. Keep `.state/` across restarts.
- Some Foundry MCP installations do not support timestamp-filtered chat
  queries, particularly if `FOUNDRY_MCP_MODULE` points to an older local
  client. The bridge safely uses full-history polling in that case.
- Changing the system service user changes OpenCode's home directory. Migrate
  session data deliberately before switching a running root-based deployment.
- The package is private to npm; this release is intended for GitHub source
  distribution, not an npm registry publication.

## Live integration evidence

On the maintainer's Foundry server (November 26, 2026), a whisper received a
private HTML reply in four seconds, its prior per-player OpenCode session was
reused, and the agent logged `verified server-side chat timestamp filtering`
with the updated MCP server. This is a deployment observation, not a latency
  guarantee for every installation. Run the separate read-only smoke check
  against your own Foundry server before using the agent in production.

## Release verification

The `v0.1.0` tag points to the released `main` commit, and GitHub Actions
passed on Node.js 20 and 22. The project was installed and tested from a clean
tag checkout (37 tests passing). The reachable Git history was scanned for
secrets; one hit was confirmed to be the documented example credential, not a
real secret.

For future releases, use the
[release checklist](https://github.com/Gabin-CC/foundry-ai-agent/blob/v0.1.0/docs/RELEASE_CHECKLIST.md)
and verify the live whisper path on the target Foundry instance.
