# Contributing to Foundry AI Agent

Thank you for helping make the project more reliable and easier to install.
All repository source code, comments, documentation, pull requests, and issue
descriptions should be written in **English**. User-facing chat responses may
use the sender's language (French by default), and the installer must remain
available in **English and French**.

## Working agreement

1. Open an issue for substantial changes before starting implementation.
   Small, clearly scoped fixes can go directly into a pull request.
2. Keep each pull request focused on a single problem and describe the
   motivation, observable behavior, and any deployment implications.
3. Do not push directly to `main` for normal development. Use a topic branch,
   open a pull request, and obtain review before merging.
4. Preserve compatibility where practical. When configuration or startup
   behavior changes, document the migration in the PR and README files.
5. Never commit credentials, chat transcripts, campaign data, `.env`, or
   other private Foundry information. Use fictional values in examples.
6. Keep both README languages aligned when changing installation steps.
   Add both English and French strings for new installer messages.
7. Write tests for fixes and behavior changes whenever possible, especially
   message ordering, session handling, and permission-sensitive operations.
8. Prefer small dependencies and explain any new runtime requirement.

## Local checks

Before submitting a PR, run the checks that apply to your changes:

```bash
npm ci
node --check listen.mjs
for file in lib/*.mjs; do node --check "$file"; done
node -e 'JSON.parse(require("node:fs").readFileSync("opencode.json", "utf8"))'
bash -n install.sh run.sh
./install.sh --help
npm test
npm run check:release
```

The GitHub Actions workflow installs the pinned dependencies and runs static
checks and Node.js tests. If you have a live Foundry instance, stop the bridge
service before running the read-only `npm run smoke:foundry` check.
Do not claim an integration test passed unless you ran it against a compatible
Foundry and MCP environment.

## Pull request checklist

- [ ] Scope and motivation are clear.
- [ ] User-facing behavior and configuration changes are documented.
- [ ] English and French installation text remain consistent.
- [ ] Relevant checks have been run, with results included in the PR.
- [ ] No credentials or private game data are included.

Please also follow the [Code of Conduct](CODE_OF_CONDUCT.md).
