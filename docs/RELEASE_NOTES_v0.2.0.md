# Foundry AI Agent v0.2.0

**Prepared release notes — not yet tagged or published.** This version brings
source-grounded D&D 2024 rules answers, a reproducible rules evaluation suite,
and an intentional **OpenCode V2-only breaking change**. The published v0.1.0
release remains available independently.

## Highlights

- **D&D 2024, backed by sources:** an optional local, read-only MCP server
  indexes official **English SRD 5.2.1** pages. Operators can add compatible,
  lawfully obtained PDFs under `rules-private/` for their own installations.
  The project does **not** ship commercial books. French questions can be
  answered using English source passages.
- **Citation provenance gate:** for explicit rules questions, the bridge
  checks that a cited source/page exists in the local index **and was actually
  retrieved during that request**. It replaces unsupported claims/citations
  with a cautious reply. Ordinary rolls and non-rules actions are unaffected.
- **Accuracy evaluation:** a 13-case bilingual SRD-only offline benchmark
  covers 2024 rule differences, citations, source-free refusals, and human
  review. An optional isolated live-model evaluator collects actual responses
  without Foundry access or private rulebook pages.
- **OpenCode V2:** only major version **2.x** is accepted. Model errors and
  incomplete results are retried without consuming the player's chat cursor.
- **Bilingual installer:** checks V2 and can offer to install the official npm
  package **`@opencode/cli@^2`** after confirmation. An unattended install
  requires `--install-opencode` for that global change.

## Breaking change: OpenCode V1 is no longer supported

OpenCode **1.x cannot start this version**. The bridge checks the executable
before connecting to Foundry; future untested major versions are rejected
too. The rules live-evaluation configuration also requires V2.

**Old V1 conversations are deliberately not migrated.** On first startup,
saved V1 OpenCode session references are discarded, so players begin new V2
conversations. Foundry's chat checkpoints and individual sender cursors are
retained, avoiding a replay of already processed whispers. Subsequent restarts
continue the new V2 sessions.

### Fresh installation

Requires Node.js 20+, npm, Git, OpenCode V2, a Foundry MCP server, a dedicated
assistant account, and a compatible model provider. Linux also needs the
`script` utility (util-linux); rules indexing needs Poppler (`pdftotext`).

```bash
git clone https://github.com/Gabin-CC/foundry-ai-agent.git
cd foundry-ai-agent
./install.sh --lang en
# Edit .env with Foundry credentials and model-provider configuration.
npm run check:opencode:v2
npm test
npm run rules:setup  # Optional: download/index official SRD 5.2.1
./run.sh
```

Use `./install.sh --lang fr` for French prompts. In non-interactive setups,
`./install.sh --lang en --non-interactive --install-opencode` explicitly
authorizes global installation of OpenCode V2 via npm. The installer will not
uninstall V1 silently. Its `--skip-opencode` flag defers the check but does
not permit running the bridge with V1.

### Existing v0.1.0 installation

1. **Stop the bridge**. Do not run two copies against the same Foundry
   assistant account.
2. Replace the OpenCode V1 CLI with V2, using the service account's `PATH`
   (and `OPENCODE_BIN` if configured). The V2 npm package is `@opencode/cli`,
   **not** `opencode-ai`. Resolve any conflicting V1 installation manually.
3. Update the repository and run `npm ci`,
   `npm run check:opencode:v2`, and `npm test`.
4. Preserve existing **`.env`, `.state/`, `.rules/` and `rules-private/`**.
   Do not import old V1 OpenCode sessions. Keep `.state/` for Foundry cursors.
5. Restart the service and verify a sourced D&D rule, an unanswerable rule,
   a normal dice roll, and reuse of a **new V2** session for a second whisper.

See the [V2 deployment guide](OPENCODE_V2.md) and
[release checklist](RELEASE_CHECKLIST.md) before publishing.

## Verification and limitations

- The release preparation suite passes **86/86 local unit tests**; CI tests
  Node.js 20 and 22. These checks simulate the model and Foundry endpoints.
- The maintainer reported a production V2.4.2 whisper response in about four
  seconds, a reused V2 session, and verified incremental chat filtering.
  This is an observation on one installation, **not a latency guarantee**.
- Citations establish that a page was consulted, **not** that the model
  interpreted it correctly. The 13-case evaluation still requires human
  source review, and SRD 5.2.1 does not contain the complete 2024 rulebooks.
- The tool instructions for GM-only actions are **not a security boundary**;
  this bridge is intended for a trusted Foundry group.
- Delivery is **at least once**. A crash after replying but before persisting
  the cursor can duplicate a response or Foundry action.
- Local private PDFs remain untracked, but retrieved excerpts may be sent by
  OpenCode to the configured model provider. Only use sources whose terms and
  privacy requirements permit that processing.
- Live SRD model evaluation is **opt-in** and can incur provider charges.
  Neither CI nor normal unit tests invoke a paid model.

The project remains distributed from GitHub source rather than the npm
registry. Do not confuse the agent repository with the separate OpenCode CLI
package. See [README](../README.md) or [README français](../README.fr.md).

## Release publication (maintainer)

After merging the version-preparation PR and completing the release checklist,
date the changelog and remove the draft status from these notes in the **final
verified release commit**. Then create the **`v0.2.0` tag from that commit**
and publish a GitHub release using these notes. **No tag or GitHub release is
created as part of preparing this PR.**
