# Release checklist

Use this checklist before tagging a public version of **Foundry AI Agent**.
The project is designed for trusted Foundry groups. The bridge and the MCP
server have different responsibilities; verify both on a real installation.

## Fresh-install reproducibility

- [ ] On a clean machine with Node.js 20+ and Git, clone the repository.
- [ ] Run `./install.sh --lang en` or `./install.sh --lang fr`; confirm that
      `npm ci` completes using `package-lock.json`.
- [ ] Verify `.env` is created with owner-only access and an existing `.env`
      is never overwritten.
- [ ] Fill in Foundry credentials, model settings and MCP endpoint details.
- [ ] Install OpenCode **V2.x** under the service account and run
      `npm run check:opencode:v2`. V1 must fail the preflight.
- [ ] Verify `install.sh` prompts before installing the npm V2 package
      `@opencode/cli`, uses `--install-opencode` only by explicit request,
      and rejects an incompatible binary in unattended mode.
- [ ] Run `npm test` (all unit tests pass).
- [ ] Run `npm run check:release` from a Git checkout (version metadata and
      tracked-file path checks pass).
- [ ] Stop the bridge service so it does not compete for the assistant login.
      Run `npm run smoke:foundry` with Foundry running. It must connect and
      read users and chat history without posting anything.
- [ ] Confirm that the OpenCode V2 executable and Linux `script` utility exist.
- [ ] If running under systemd, provision the unprivileged `foundry-agent`
      user and grant it read access to `.env`, write access to `.state/`, and
      a writable OpenCode home. Keep the `.state/` chat cursors even when
      switching accounts; **V1 conversation sessions are not migrated**.

## Live integration

- [ ] Start the bridge with `./run.sh` or the configured systemd service.
- [ ] From Foundry, whisper a harmless request to the dedicated assistant.
- [ ] Confirm one private HTML reply reaches the correct sender.
- [ ] Send another whisper from the same player; confirm their OpenCode
      session is reused.
- [ ] Send whispers from separate players; confirm their queues remain
      independent and requests from one sender remain ordered.
- [ ] Restart the service without deleting `.env` or `.state/`; confirm new
      messages are processed and existing conversations resume.
- [ ] For the V2-only breaking change, verify a preexisting V1 checkpoint
      drops only old session IDs, keeps chat progress and creates **new** V2
      conversations. A second restart should then reuse those V2 sessions.
- [ ] Confirm OpenCode provider errors do not send an error whisper or advance
      the chat checkpoint; a recovered request is retried.
- [ ] Confirm timestamp-filtered polling is either verified as supported or
      automatically falls back to full polling, with no lost whispers.
- [ ] Inspect logs for errors, accidental credential disclosure and duplicate
      effects. Delivery is at least once, so a crash at an unlucky moment
      can still repeat a request.

## Repository and publication

- [ ] GitHub Actions passes on both supported Node versions.
- [ ] Verify README (English), README.fr.md, CONTRIBUTING.md,
      CODE_OF_CONDUCT.md, LICENSE and `.env.example` match the release.
- [ ] Review the repository for credentials, private Foundry data and files
      that should not become public. Never commit `.env` or `.state/`.
- [ ] Scan **file contents and the full Git history** for credentials and
      private campaign data with an appropriate secret scanner; the automated
      tracked-path check alone is not sufficient.
- [ ] Record changes in CHANGELOG.md, choose a version and tag it explicitly.
- [ ] For v0.2.0, review the [prepared release notes](RELEASE_NOTES_v0.2.0.md),
      including the OpenCode V2-only breaking change, V1 session reset,
      limitations and upgrade advice.
- [ ] Before tagging, replace `Unreleased` in the **target changelog version**
      with its actual publication date, remove any draft/pre-publication
      wording from the target release notes and commit both changes.
- [ ] Confirm the `v0.2.0` tag does not already exist; create it only on the
      final verified release commit, not an older branch head.
- [ ] Only after the live checks, publish the GitHub release. The repository
      is already public; preparation alone does not create a tag or release.

## Production rollback

Before replacing a running deployment, preserve its `.env` and `.state/`
directory and record the previous commit. On failure, restore the previous
commit and its dependencies (`npm ci`) while keeping those two paths. Avoid
running two copies of the bridge against the same assistant at once.
