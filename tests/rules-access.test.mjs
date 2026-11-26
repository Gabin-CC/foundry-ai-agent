import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SOURCE_SHA256 } from "../lib/rules.mjs";
import { accessPolicyRevision, accessRole, loadAccessPolicy, parseRulesAccessRole,
  validateAccessPolicy, visibleRulesIndex } from "../lib/rules-access.mjs";

const phb = "Players_Handbook_2024.pdf";
const adventure = "Vecna_Eve_of_Ruin.pdf";
const index = { version: "5.2.1", pdf_sha256: SOURCE_SHA256,
  private_sources: [phb, adventure].map(name => ({ name, sha256: "a".repeat(64) })),
  pages: [
    { source: "srd", language: "en", page: 3, text: "A public rule passage." },
    { source: phb, language: "en", page: 25, text: "Player spellcasting rules." },
    { source: adventure, language: "en", page: 47, text: "Secret final boss and campaign reveal." }
  ] };

test("two book categories: listed rules are public, all other books are GM content", () => {
  const policy = { version: 1, rules_for_all: [phb] };
  const player = visibleRulesIndex(index, policy, "player");
  assert.deepEqual(player.private_sources.map(item => item.name), [phb]);
  assert.deepEqual(player.pages.map(item => item.source), ["srd", phb]);
  assert.equal(visibleRulesIndex(index, policy, "gm"), index);
  const withoutConfig = visibleRulesIndex(index);
  assert.deepEqual(withoutConfig.pages.map(item => item.source), ["srd"]);
  assert.deepEqual(withoutConfig.private_sources, []);
});

test("access policy validation rejects malformed or ambiguous classification", () => {
  for (const policy of [null, { version: 1, rules_for_all: ["../gm.pdf"] },
    { version: 1, rules_for_all: [phb, phb] },
    { version: 1, rules_for_all: [], anything: "allow" },
    { version: 2, rules_for_all: [] }]) {
    assert.throws(() => validateAccessPolicy(policy), /Invalid rules access policy/);
  }
  assert.equal(accessRole(4), "gm");
  assert.equal(accessRole(3), "gm");
  assert.equal(accessRole(2), "player");
  assert.equal(accessRole(undefined), "player");
  assert.equal(parseRulesAccessRole(undefined), "player");
  assert.throws(() => parseRulesAccessRole("admin"), /must be player or gm/);
});

test("missing access file defaults to GM-only private books; explicit rules list is read", async t => {
  const dir = await mkdtemp(join(tmpdir(), "foundry-rule-access-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "access.json");
  assert.deepEqual(await loadAccessPolicy(path), { version: 1, rules_for_all: [] });
  await writeFile(path, JSON.stringify({ version: 1, rules_for_all: [phb] }));
  assert.deepEqual((await loadAccessPolicy(path)).rules_for_all, [phb]);
  const revision = await accessPolicyRevision(path);
  await writeFile(path, JSON.stringify({ version: 1, rules_for_all: [phb, adventure] }));
  assert.notEqual(await accessPolicyRevision(path), revision);
  await writeFile(path, "{invalid");
  await assert.rejects(loadAccessPolicy(path));
});
