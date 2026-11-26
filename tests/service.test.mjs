import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const service = readFileSync(new URL("../foundry-ai-agent.service", import.meta.url), "utf8");

test("example systemd service does not use root or a root home", () => {
  assert.match(service, /^User=foundry-agent$/m);
  assert.match(service, /^Group=foundry-agent$/m);
  assert.match(service, /^Environment=HOME=\/var\/lib\/foundry-agent$/m);
  assert.doesNotMatch(service, /^(?:User=root|Environment=HOME=\/root)$/m);
});

test("example systemd service preserves private files and allows graceful shutdown", () => {
  assert.match(service, /^UMask=0077$/m);
  assert.match(service, /^NoNewPrivileges=true$/m);
  assert.match(service, /^TimeoutStopSec=180$/m);
  assert.match(service, /^WorkingDirectory=\/opt\/foundry-ai-agent$/m);
});
