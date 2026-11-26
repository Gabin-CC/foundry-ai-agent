# Foundry AI Agent

[Français](README.fr.md) · English

An **AI assistant for Foundry VTT** that listens for private chat messages
(whispers) sent to a dedicated account, passes each request to
[OpenCode](https://opencode.ai/) and its [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
tools, and replies privately in Foundry's HTML chat format.

> **Breaking change — OpenCode V2 only.** OpenCode 1.x is unsupported. Old V1
> conversation sessions are abandoned (no migration), while Foundry chat
> checkpoints are preserved. See [OpenCode V2 setup](docs/OPENCODE_V2.md).

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
- Includes an optional local, read-only D&D 2024 rules MCP tool that retrieves
  English SRD 5.2.1 passages with verifiable PDF page links, plus extra locally
  supplied PDF rulebooks. The agent can explain those rules in French.
- Offers an English/French interactive installer; the runtime can answer in
  the language of the player, with French as the default.

## Architecture

```text
Foundry whispers -> listen.mjs -> OpenCode -> Foundry MCP
                                    |-----> local SRD rules MCP
       ^                               |
       +--------- private HTML reply --+
```

| File | Purpose |
| --- | --- |
| `listen.mjs` | Foundry chat polling, per-sender sessions, OpenCode bridge |
| `opencode.json` | Model and remote Foundry MCP configuration |
| `rules-mcp.mjs` | Local read-only SRD 5.2.1 search and page lookup |
| `rules-private/` | Optional private rulebook PDFs (ignored by Git) |
| `AGENTS.md` | Instructions for the in-game AI assistant |
| `install.sh` | Interactive English/French installation |
| `run.sh` | Load `.env` and start the bridge |
| `scripts/smoke-test.sh` | Read-only Foundry connection check |
| `foundry-ai-agent.service` | Example systemd service |

## Requirements

- Node.js **20 or later**, npm and Git (npm installs the pinned Foundry client
  source directly from GitHub; it is not published as an npm package).
- [OpenCode V2.x](https://opencode.ai/docs/) installed and accessible from
  `PATH`. V1.x is rejected at startup.
- A running Foundry VTT server and a reachable Foundry MCP endpoint (for
  example, `foundry-vtt-mcp-server`).
- A dedicated Foundry account for the assistant (typically Assistant GM).
- An API key for an OpenCode-compatible model provider, such as OpenRouter.
- On Linux, `script` from util-linux is used by the current bridge to run
  OpenCode inside a pseudo-terminal.
- For rules lookup: Poppler `pdftotext`, plus outbound HTTPS access to download
  the official English SRD once (or a local copy of that same PDF).

## Installation

```bash
git clone https://github.com/Gabin-CC/foundry-ai-agent.git
cd foundry-ai-agent
./install.sh
```

The installer checks that **OpenCode V2** is present. If missing or still V1,
it offers to install the official npm package **`@opencode/cli@^2`** globally
when running interactively. It never removes the old `opencode-ai` package
automatically. For unattended setups, choose explicitly:

```bash
./install.sh --lang en --non-interactive --install-opencode
```

Global npm installation may require elevated package-manager permissions and
can conflict with an existing V1 binary; resolve those conflicts manually.
You can instead install V2 yourself via the
[official OpenCode CLI instructions](https://opencode.ai/docs/). To configure
a separate binary, use `--opencode-bin PATH` during installation and set
`OPENCODE_BIN` in `.env`. To defer the check (for an offline/bootstrap setup),
pass `--skip-opencode`; the bridge still refuses to start without V2.

Then verify the binary available to the service account:

```bash
npm run check:opencode:v2
```

The check is read-only. An OpenCode V1 executable cannot run this release.
[V2-only setup and deployment notes](docs/OPENCODE_V2.md).

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

Or use the example systemd service. It intentionally runs as an unprivileged
`foundry-agent` system account, rather than root. If you installed the agent
under `/opt/foundry-ai-agent`, create that account and give it access to
the existing credentials and checkpoint state:

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

These account creation commands are one-time setup; skip them if the account
already exists. Check that OpenCode is installed in the service's `PATH`
(or set an absolute `OPENCODE_BIN` in `.env`), and that the account can write
to `/var/lib/foundry-agent`. Adapt the paths if your checkout is elsewhere.
Existing deployments using a root-based unit should **not** replace their
service file without first creating the user and fixing the permissions;
merging this repository change alone does not change a running service.
Old OpenCode V1 conversations are not retained by this version, regardless of
the previous account's `HOME`. Do not move or import V1 session data. Preserve
`.state/` instead: it keeps Foundry chat cursors and prevents replaying old
whispers. New conversations use OpenCode V2 under the service account.

In Foundry, whisper to your dedicated assistant account:

```text
/whisper AI Bonjour, peux-tu lancer un jet de perception ?
```

The assistant replies in a private chat message.

## Grounded D&D 2024 rules (optional setup)

The example `AGENTS.md` is configured for **D&D 2024, no house rules**. It
instructs OpenCode to search the **English SRD 5.2.1** through its local MCP
server for every rules question, and to cite the actual official PDF page.
Players can ask in French; the assistant searches English terms and explains
the sourced rule in French. The rules server cannot change Foundry data.

Run this once after `npm ci`, from the project directory:

```bash
# Debian/Ubuntu: sudo apt install poppler-utils
npm run rules:setup
```

This downloads the **official English SRD 5.2.1** PDF and creates a searchable
index under `.rules/`. It does not download or use SRD 5.1 or the 2014 rules.
To build without a download, use `npm run rules:setup -- --en /path/to/SRD_CC_v5.2.1.pdf`.
Both the PDF and the generated index are ignored by Git. Keep the `.rules/`
directory on deploy and ensure that the service account can **read** it.
If you run as `foundry-agent` under systemd, create the directory as that user
and run the setup command with that account (or arrange equivalent ownership).
Restart OpenCode/bridge after setup if it was already running.

### Add your own PDF rulebooks

If you already own additional compatible official D&D 2024 rulebooks, put
their readable PDF files directly in **`rules-private/`** (e.g.
`rules-private/Players_Handbook_2024.pdf`) and re-run:

```bash
npm run rules:setup
```

This extends the same local index with the contents of those books. The local
rules MCP server can list all sources, search them, and return the exact PDF
page. Official SRD results include a clickable D&D Beyond PDF URL; private
books are cited by **filename and PDF page** (without a fabricated web link).
Only the instruction file in `rules-private/` is committed; PDFs and their
indexed text are excluded from Git. The tool cannot independently verify
whether a user-provided PDF is an official 2024 book, so add only sources
appropriate to your game. See [private-rulebook instructions](rules-private/README.md)
for details. There is no arbitrary private-PDF size cap; large files may take
longer to parse and require more resources. Re-index after adding, changing or
removing books.

**Privacy:** the books and index stay on the machine, but **relevant excerpts
from them are sent to the configured AI model provider by OpenCode** when the
assistant consults them. Do not add books whose license or your privacy
requirements prohibit that use.

The assistant can cite, for example, *SRD 5.2.1 (EN), PDF p. 15* with an
official PDF link, or *Players_Handbook_2024.pdf, PDF p. 87*. The bridge now
**checks the cited source and PDF page against successful rules MCP lookups
performed for that specific reply**, then validates that the page exists in
the local index. An explicit rules question answered without a citation, or
one with an unverified citation, receives a cautious fallback whisper instead.
If the index is missing, explicit rules questions also fail closed; ordinary
gameplay requests and rolls continue to work.

This is a **citation provenance check**, not a proof that the model interpreted
the passage correctly. Rule-question detection uses deliberately conservative
wording patterns and cannot catch every implicit rules discussion. Review
important rulings against the cited page. To temporarily restore the earlier
prompt-only behavior, set `RULES_CITATION_MODE=off` in `.env` and restart.

To measure rule-answer regressions separately, run the **optional offline
13-case D&D 2024 benchmark** (`npm run eval:rules -- --prompts`, then
`npm run eval:rules -- --responses /path/to/replies.jsonl`). It checks common
2014/2024 mistakes, references, and any recorded tool provenance, while
requiring **human source review** for semantic correctness. It does not invoke
OpenCode, connect to Foundry or change the live service. See the
[evaluation guide](docs/RULES_EVALUATION.md).

An **explicit live-model evaluation** is also available: run
`npm run eval:rules:live -- --dry-run --model openrouter/provider/model`
to inspect its configuration, then use `--execute --output .rules/results.jsonl`
with an explicitly exported `OPENROUTER_API_KEY` to collect real OpenCode
answers. The runner uses a temporary **SRD-only** MCP and denies all other
OpenCode tools; it never loads the production Foundry configuration or private
rulebooks. Provider calls can cost money, and human source review is still
required. [Full instructions](docs/RULES_EVALUATION.md).

**Scope:** SRD 5.2.1 contains only part of the 2024 rules. The project does
not ship or download any commercial books. Additional books are used **only
when an operator explicitly places their PDFs in the local private folder**.

Attribution required for the source material:

> This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

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
| `OPENCODE_BIN` | `opencode` | OpenCode V2 executable (major version 2 required) |
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
| `RULES_CITATION_MODE` | `enforce` | Validate rule citations before replying; `off` disables the guard |
| `RULES_INDEX_PATH` | `.rules/srd-5.2.1.json` | Optional custom local rules index path |

For a locally installed MCP server, an example module setting is:

```dotenv
FOUNDRY_MCP_MODULE=/opt/foundry-vtt-mcp-server/src/foundry.mjs
```

## Security and limitations

- Never commit `.env` or real credentials. `.gitignore` excludes `.env`.
- Use a dedicated Foundry account with only the access your group needs.
- The assistant's role-aware rules currently rely on the model following
  `AGENTS.md`; the bridge does not enforce tool-level authorization.
- The citation gate verifies lookup provenance and page identity, but cannot
  establish semantic accuracy or detect every implicit rules question.
- The service example uses a dedicated, unprivileged system user. Its `.env`,
  `.state/`, and OpenCode home must be accessible to that account.
- On the first V2-only start, the bridge discards previously saved **V1**
  OpenCode session IDs. It retains the Foundry message checkpoints, so those
  old whispers are not replayed. Each player then starts a new V2 session.
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
- On OpenCode errors, a player's request remains unacknowledged and is retried
  rather than sending a misleading error whisper. Repair persistent provider
  errors to unblock that player's queued requests.
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
