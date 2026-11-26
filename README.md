# Foundry AI Agent

[Français](README.fr.md) · English

An **AI assistant for Foundry VTT** that listens for private chat messages
(whispers) sent to a dedicated account, passes each request to
[OpenCode](https://opencode.ai/) and its [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
tools, and replies privately in Foundry's HTML chat format.

The bridge is designed for a **trusted group of players and Game Masters**.
By default, any player can whisper to the assistant. The prompt asks it to
reserve GM tools for GMs and Assistant GMs; this is guidance, **not an
enforced permission boundary**. Deploy it only with a Foundry/MCP account
whose access is appropriate for your group.

## Features

- Polls Foundry chat for new whispers to the assistant account.
- Sends HTML-formatted private replies.
- Keeps separate OpenCode sessions for each sender, resetting them after
  24 hours of inactivity or 1,000 messages by default.
- Saves a local message checkpoint and conversation session IDs so that new
  messages can be resumed after a bridge restart.
- Processes each player's requests in order, while allowing up to three
  players to be served concurrently by default. Incoming whispers continue
  to be discovered while the model is working.
- Automatically checks whether Foundry supports timestamp-filtered chat
  queries, uses smaller incremental reads when verified, and falls back to
  full reads when unsupported.
- Includes a read-only connection smoke test for the real Foundry server,
  separate from the unit tests.
- Includes the sender's Foundry role in each request.
- Uses Foundry MCP tools to retrieve data, roll dice, and interact with the world.
- Offers an English/French interactive installer; the runtime can answer in
  the language of the player, with French as the default.

## Architecture

```text
Foundry whispers -> listen.mjs -> OpenCode -> Foundry MCP
       ^                               |
       +--------- private HTML reply --+
```

| File | Purpose |
| --- | --- |
| `listen.mjs` | Foundry chat polling, per-sender sessions, OpenCode bridge |
| `opencode.json` | Model and remote Foundry MCP configuration |
| `AGENTS.md` | Instructions for the in-game AI assistant |
| `install.sh` | Interactive English/French installation |
| `run.sh` | Load `.env` and start the bridge |
| `scripts/smoke-test.sh` | Read-only Foundry connection check |
| `foundry-ai-agent.service` | Example systemd service |

## Requirements

- Node.js **20 or later**, npm and Git (npm installs the pinned Foundry client
  source directly from GitHub; it is not published as an npm package).
- [OpenCode](https://opencode.ai/docs/) installed and accessible from `PATH`.
- A running Foundry VTT server and a reachable Foundry MCP endpoint (for
  example, `foundry-vtt-mcp-server`).
- A dedicated Foundry account for the assistant (typically Assistant GM).
- An API key for an OpenCode-compatible model provider, such as OpenRouter.
- On Linux, `script` from util-linux is used by the current bridge to run
  OpenCode inside a pseudo-terminal.

## Installation

```bash
git clone https://github.com/Gabin-CC/foundry-ai-agent.git
cd foundry-ai-agent
./install.sh
```

The installer detects your system language and offers **English** or
**Français** when running interactively. You can also choose explicitly:

```bash
./install.sh --lang en
./install.sh --lang fr
./install.sh --lang fr --non-interactive
```

It checks Node.js, installs npm dependencies from the committed lockfile, and creates `.env` from
`.env.example` if the file does not already exist. An existing `.env` is
never overwritten. Use `--skip-deps` if dependencies are already installed.

Alternatively, install manually:

```bash
npm ci
cp .env.example .env
```

Then edit `.env` and configure at least:

- `AI_PASSWORD`: dedicated Foundry account password.
- `OPENROUTER_API_KEY`: provider API key (or the corresponding credentials
  for your chosen provider).
- `FOUNDRY_MCP_URL`: endpoint for the MCP server.
- `FOUNDRY_MCP_AUTH_B64`: Base64 of the MCP account's `username:password`.
- `FOUNDRY_MCP_MODULE`: `foundry-vtt-mcp-server/src/foundry.mjs` (installed
  from a pinned GitHub commit), or an absolute path to the local client module.
  The old package-only value is accepted for existing installations.

For example, generate a Basic authentication value with:

```bash
printf 'AI:your-password' | base64
```

## Running

Start manually:

```bash
./run.sh
```

Or use the example systemd service, adjusting its paths and service account
for your server first:

```bash
sudo cp foundry-ai-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now foundry-ai-agent
journalctl -u foundry-ai-agent -f
```

In Foundry, whisper to your dedicated assistant account:

```text
/whisper AI Bonjour, peux-tu lancer un jet de perception ?
```

The assistant replies in a private chat message.

## Verification before release

Run the unit suite after installation:

```bash
npm test
```

With `.env` configured and Foundry running, **stop the bridge service first**
so the smoke test does not compete for the same assistant login. Check the real Foundry login and
read access **without posting any message, starting OpenCode, or modifying
game data**:

```bash
npm run smoke:foundry
```

The smoke test logs in as `AI_USER`, reads `User` and `ChatMessage`, reports
only the number of records, then closes the session. It does not test model
authentication, the MCP endpoint, or the end-to-end whisper path. To verify
those, start `./run.sh` and send an actual whisper from Foundry, then confirm
an HTML reply, per-player session reuse and that existing `.state/` survives a
restart. See [release checklist](docs/RELEASE_CHECKLIST.md).

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `AI_USER` | `AI` | Dedicated Foundry account name |
| `AI_PASSWORD` | required | Account password |
| `ADMIN_PASSWORD` | empty | Optional Foundry administrator password |
| `ALLOWED_SENDERS` | empty | Comma-separated user IDs (empty = all players) |
| `OPENCODE_BIN` | `opencode` | OpenCode executable |
| `OPENCODE_MODEL` | example OpenRouter model | Model identifier |
| `OPENROUTER_API_KEY` | required for OpenRouter | Provider API key |
| `FOUNDRY_MCP_URL` | `http://127.0.0.1:8808/mcp` | MCP endpoint |
| `FOUNDRY_MCP_AUTH_B64` | example value | MCP Basic authentication value |
| `FOUNDRY_MCP_MODULE` | `foundry-vtt-mcp-server/src/foundry.mjs` | Module exporting `FoundrySession` |
| `POLL_MS` | `3000` | Chat polling interval in milliseconds |
| `MAX_REPLY` | `4000` | Maximum reply length |
| `RESET_MS` | `86400000` | Inactivity timeout for a conversation |
| `RESET_MSGS` | `1000` | Maximum messages before resetting a conversation |
| `MAX_CONCURRENT` | `3` | Maximum simultaneous players (1–16) |
| `CHAT_FILTER_MODE` | `auto` | Probe timestamp filtering (`off` forces full polling) |
| `CHAT_RESYNC_MS` | `120000` | Full chat rescan interval, in milliseconds |
| `CHAT_LOOKBACK_MS` | `120000` | Overlap for incremental chat queries, in milliseconds |
| `STATE_FILE` | `.state/bridge-state.json` | Local durable checkpoint file |

For a locally installed MCP server, an example module setting is:

```dotenv
FOUNDRY_MCP_MODULE=/opt/foundry-vtt-mcp-server/src/foundry.mjs
```

## Security and limitations

- Never commit `.env` or real credentials. `.gitignore` excludes `.env`.
- Use a dedicated Foundry account with only the access your group needs.
- The assistant's role-aware rules currently rely on the model following
  `AGENTS.md`; the bridge does not enforce tool-level authorization.
- The service example should be adapted to run as a dedicated, unprivileged
  system user on production servers.
- On the first start, existing chat messages are treated as history. After
  that, the bridge resumes new messages from individual per-sender checkpoints.
  Existing state files from the original global-checkpoint implementation are
  migrated automatically.
  Keep the `.state/` directory across deployments, and ensure the service
  account can write to it. The state contains message IDs and OpenCode session
  IDs, but not chat content.
- Delivery is **at least once**, not exactly once: a crash after sending a
  reply but before saving its checkpoint may cause a duplicate response or
  repeated MCP action when restarting.
- The bridge first fetches the chat history and checks an actual timestamp
  query against it. Only if the returned IDs match does it enable incremental
  queries. It also performs a complete rescan every two minutes by default,
  and immediately falls back to full polling when a query fails or behaves
  unexpectedly. This prevents a permanently missed message if the MCP server
  does not support the optimization, although recovery of a missed message
  may be delayed until the next rescan.
- Unit tests use mocked Foundry and OpenCode interfaces. The separate
  read-only Foundry smoke test checks login and queries, but live whispers
  must still be verified before deployment.

If your Foundry/MCP version behaves unexpectedly, set `CHAT_FILTER_MODE=off`
in `.env` and restart the bridge. This immediately restores the previous
full-history polling behavior without resetting conversations or checkpoints.

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow
and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community expectations.

## License

MIT — see [LICENSE](LICENSE).
