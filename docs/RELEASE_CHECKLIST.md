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
- [ ] Run `npm test` (all unit tests pass).
- [ ] Stop the bridge service so it does not compete for the assistant login.
      Run `npm run smoke:foundry` with Foundry running. It must connect and
      read users and chat history without posting anything.
- [ ] Confirm that the OpenCode executable and Linux `script` utility exist.

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
- [ ] Record changes in CHANGELOG.md, choose a version and tag it explicitly.
- [ ] Only after the live checks, decide when to make the repository public
      and publish a GitHub release. Neither step is automatic.

## Production rollback

Before replacing a running deployment, preserve its `.env` and `.state/`
directory and record the previous commit. On failure, restore the previous
commit and its dependencies (`npm ci`) while keeping those two paths. Avoid
running two copies of the bridge against the same assistant at once.
