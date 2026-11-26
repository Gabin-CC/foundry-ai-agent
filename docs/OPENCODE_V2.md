# OpenCode V2 only — breaking change

**This bridge requires OpenCode 2.x. OpenCode 1.x is no longer supported.**
The isolated D&D 2024 evaluation uses V2-native `permissions`, `policies`
and `agents` configuration, which fails on OpenCode 1.x.

This is a deliberate **clean break**, not a session migration. Existing
OpenCode V1 conversations are **not imported, converted or reused**. On the
first start, legacy session references in the bridge checkpoint are discarded.
Each player starts a fresh OpenCode V2 conversation with their next request.
The Foundry message checkpoints (`lastTimestamp`, `seenAtTimestamp` and
per-sender cursors) remain unchanged, preventing replay of already handled
whispers merely because the model backend changed.

## Installation / first V2 startup

1. Stop the `foundry-ai-agent` service before replacing OpenCode or the code.
   Do not run V1 and V2 against the same live assistant simultaneously.
2. Install the **V2 CLI** with the [official instructions](https://opencode.ai/docs/).
   For example, on supported Linux hosts:

   ```bash
   curl -fsSL https://opencode.ai/v2/install | bash
   ```

   If V1 was installed through a package manager, remove its conflicting
   package first. Both use the `opencode` command. Check the V2 install path
   **as the same non-root user that runs the service**.
3. Keep the existing `.env`, `.state/`, `.rules/` and `rules-private/`
   directories. Ensure `OPENCODE_BIN` points to the V2 executable. No V1
   conversation backup/import is required, since old sessions are deliberately
   abandoned. Do not delete `.state/`: it also holds Foundry chat cursors.
4. With the service account's `PATH` and environment, run:

   ```bash
   npm ci
   npm run check:opencode:v2
   npm test
   npm run eval:rules:live -- --dry-run --model openrouter/baidu/ernie-5.5-flash-preview:free
   ```

   The version check only runs `opencode --version`: no provider call,
   Foundry connection or MCP action. It rejects both V1 and untested V3.
5. If an optional live SRD evaluation is desired, export a separate
   `OPENROUTER_API_KEY` explicitly and run `--execute` following
   [the evaluation guide](RULES_EVALUATION.md). This can incur provider costs;
   it does not use production Foundry or commercial PDF data.
6. Restart the service and test a Foundry whisper (sourced rule, unanswerable
   rule, then a normal roll). Send a second whisper from the same player to
   verify that the **new V2 session** is reused. Review the logs.

## Behavior and troubleshooting

- The bridge fails startup **before connecting to Foundry** if `OPENCODE_BIN`
  is missing or its version does not have major version `2`.
- Failed OpenCode calls, error events, incomplete output or unexpected session
  IDs **do not advance the Foundry chat cursor** and do not produce an error
  whisper. The message is retried during a later poll. Fix the model/provider
  failure to allow progress; later requests from that player must wait.
- A restart within V2 keeps V2 sessions as before (until the configured
  inactivity/message limit resets a conversation).
- Rollback to a V1 runtime is not supported with the new bridge. Do not reuse
  old session references from an older checkpoint snapshot against V2.
- V2 may require compatible provider credentials or plugins. Verify the
  configured model and MCP endpoints in the actual deployment environment.

References: [OpenCode V2 CLI](https://opencode.ai/docs/cli/commands/),
[V2 configuration](https://opencode.ai/docs/config/), and
[upstream V1/V2 differences](https://opencode.ai/docs/migrate-v1/).
