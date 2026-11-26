# Changelog

Notable changes to Foundry AI Agent are recorded here. No public release has
been tagged yet; changes remain under **Unreleased** until explicitly released.

## Unreleased

- English project documentation and French translation, bilingual installer,
  contribution guidelines and code of conduct.
- Modern OpenCode provider and remote MCP configuration with Node.js CI.
- Durable per-player chat checkpoints and OpenCode session continuity across
  restarts, with per-player ordered queues and configurable concurrency.
- Validated timestamp-filtered chat polling, automatic full-polling fallback
  and periodic resynchronization.
- Reproducible Foundry client dependency pinned to a GitHub commit,
  lockfile, installed-dependency checks in CI, and a read-only live Foundry
  smoke test with a release checklist.
