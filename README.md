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
| `foundry-ai-agent.service` | Example systemd service |

## Requirements

- Node.js **20 or later** and npm.
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

It checks Node.js, installs npm dependencies, and creates `.env` from
`.env.example` if the file does not already exist. An existing `.env` is
never overwritten. Use `--skip-deps` if dependencies are already installed.

Alternatively, install manually:

```bash
npm install
cp .env.example .env
```

Then edit `.env` and configure at least:

- `AI_PASSWORD`: dedicated Foundry account password.
- `OPENROUTER_API_KEY`: provider API key (or the corresponding credentials
  for your chosen provider).
- `FOUNDRY_MCP_URL`: endpoint for the MCP server.
- `FOUNDRY_MCP_AUTH_B64`: Base64 of the MCP account's `username:password`.
- `FOUNDRY_MCP_MODULE`: npm module exporting `FoundrySession`, or an absolute
  path to the local server module.

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
| `FOUNDRY_MCP_MODULE` | `foundry-vtt-mcp-server` | Module exporting `FoundrySession` |
| `POLL_MS` | `3000` | Chat polling interval in milliseconds |
| `MAX_REPLY` | `4000` | Maximum reply length |
| `RESET_MS` | `86400000` | Inactivity timeout for a conversation |
| `RESET_MSGS` | `1000` | Maximum messages before resetting a conversation |

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
- This early version polls the full chat history and has no persistent
  message checkpoint or automated tests yet.

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow
and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community expectations.

## License

MIT — see [LICENSE](LICENSE).
