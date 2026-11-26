# Changelog

Notable changes to Foundry AI Agent are recorded here. Version 0.1.0 is the
first stable GitHub release, published on November 26, 2026.

## [Unreleased]

## [0.2.0] - November 26, 2026

### Breaking: OpenCode V2 required

- OpenCode **2.x only** (V1 and untested future majors are rejected before
  Foundry login). The isolated live rules evaluator also requires V2.
- **No V1 conversation migration**: the first V2 startup discards old OpenCode
  session references and starts fresh sessions for players. Foundry chat
  checkpoints and per-sender cursors are retained so processed whispers are
  not replayed. New V2 sessions resume normally after later restarts.

### D&D 2024 rule accuracy

- Add read-only local MCP search for the official English **SRD 5.2.1**, with
  verified source pages and links. Optional **private PDF rulebooks** can be
  indexed locally without committing or distributing commercial material.
  Remove the arbitrary 250 MB limit for private PDFs; extraction still has
  resource/time limits.
- Enforce source/page **citation provenance** against rules tools actually
  consulted for each answer. Missing or invented citations receive a cautious
  fallback; ordinary Foundry rolls remain unaffected. This is not semantic
  proof of the model's interpretation.
- Add a reproducible **13-case** offline D&D 2024 SRD benchmark with bilingual
  questions, 2014/2024 pitfalls, and separate human review of correctness.
- Add opt-in live-model collection in an isolated **SRD-only** OpenCode V2
  workspace, excluding Foundry access and private rulebooks. No provider calls
  occur during unit tests or a dry run.

### Reliability and installation

- Retry OpenCode failures/incomplete responses without advancing a player's
  Foundry chat cursor; reject error events and unexpected resumed session IDs.
- Add a read-only V2 CLI prerequisite check and improve the English/French
  installer to detect V2, optionally install the official npm package
  `@opencode/cli@^2`, and handle unattended installation explicitly. The
  installer does not silently uninstall V1 or overwrite `.env`.
- Document the breaking change, privacy boundaries and deployment checks in
  English and French.

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
