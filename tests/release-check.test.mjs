import assert from "node:assert/strict";
import { test } from "node:test";
import { isSensitiveTrackedPath, validateRelease } from "../lib/release-check.mjs";

const valid = {
  version: "0.1.0",
  lockVersion: "0.1.0",
  changelog: "# Changelog\n\n## [0.1.0] - Release candidate\n",
  notes: "# Foundry AI Agent v0.1.0 — release candidate\n",
  trackedPaths: [".env.example", "README.md", "lib/bridge.mjs"]
};

test("release metadata and safe tracked files pass", () => {
  assert.deepEqual(validateRelease(valid), []);
});

test("version mismatch or missing release notes is caught", () => {
  assert.match(validateRelease({ ...valid, lockVersion: "0.2.0" })[0], /versions disagree/);
  assert.match(validateRelease({ ...valid, notes: "# Wrong release\n" })[0], /notes title/);
  assert.match(validateRelease({ ...valid, changelog: "# Changelog\n" })[0], /missing version/);
});

test("sensitive local state and credential paths are rejected", () => {
  for (const path of [".env", ".env.prod", ".state/bridge-state.json", "credentials/private.key", "cert.pem", ".or_key"]) {
    assert.equal(isSensitiveTrackedPath(path), true, `${path} should be rejected`);
  }
  assert.equal(isSensitiveTrackedPath(".env.example"), false);
  assert.deepEqual(validateRelease({ ...valid, trackedPaths: ["README.md", ".state/state.json"] }).length, 1);
});
