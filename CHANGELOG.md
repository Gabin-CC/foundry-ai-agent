# Changelog

Notable changes to Foundry AI Agent are recorded here. Version 0.1.0 is the
first stable GitHub release, published on November 26, 2026.

## [Unreleased]

## [0.1.0] - 2026-11-26

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
- Non-root systemd service template with explicit account provisioning,
  writable OpenCode home and safe permission guidance.
- Updated the pinned Foundry client to the MCP server revision with
  socket-backed chat caching and verified timestamp-filtered reads.
