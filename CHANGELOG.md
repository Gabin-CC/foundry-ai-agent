# Changelog

Notable changes to Foundry AI Agent are recorded here. Version 0.1.0 is the
first stable GitHub release, published on November 26, 2026.

## [Unreleased]

- Interactive English/French installer now verifies OpenCode V2, optionally
  installs the official npm package `@opencode/cli@^2`, and offers explicit
  flags for unattended installation or deferred checks. V1 packages are never
  removed silently.

### Breaking: OpenCode V2 only

- Require OpenCode 2.x at startup; reject V1 and untested major versions
  before logging into Foundry. Add a read-only V2 CLI prerequisite check.
- Cleanly discard legacy V1 OpenCode session IDs without importing or
  migrating V1 conversations. Preserve Foundry chat cursors and per-player
  ordering; fresh V2 sessions persist across subsequent restarts.
- Retry failed/incomplete OpenCode requests without consuming the chat
  checkpoint, and reject error events or mismatched resumed session IDs.
- Require V2 for the isolated live SRD evaluation before creating its output.
- Document the V2-only breaking change in both supported README languages.

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
