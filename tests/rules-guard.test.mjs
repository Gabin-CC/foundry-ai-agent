import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SOURCE, SOURCE_SHA256 } from "../lib/rules.mjs";
import { citedPages, collectedEvidence, createRulesReplyGuard, isRulesQuestion,
  validateRulesReply } from "../lib/rules-guard.mjs";

const book = "Players_Handbook_2024.pdf";
const index = {
  version: "5.2.1", pdf_sha256: SOURCE_SHA256,
  private_sources: [{ name: book, sha256: "a".repeat(64) }],
  pages: [
    { source: "srd", language: "en", page: 15, text: "Opportunity Attack. You use a Reaction when a creature leaves your reach." },
    { source: "srd", language: "en", page: 16, text: "Ranged Attack. A weapon may use its normal or long range." },
    { source: book, language: "en", page: 87, text: "Test-only placeholder: an arcane example about spellcasting." }
  ]
};
const searchCall = { name: "rules_search_rules", status: "completed", input: { query: "opportunity attack", source: "srd" } };
const privateCall = { name: "rules_read_rule_page", status: "completed", input: { page: 87, source: book } };
const official = `<p>An Opportunity Attack uses a Reaction. <a href="${SOURCE}#page=15">SRD 5.2.1 (EN), PDF p. 15</a></p>`;

test("explicit French and English rules questions are detected without blocking ordinary actions", () => {
  for (const q of ["Quelle est la règle de concentration ?", "Est-ce que je peux lancer deux sorts ?",
    "Comment fonctionne l'état Agrippé ?", "Can I cast two spells?", "What are the rules for movement?"]) {
    assert.equal(isRulesQuestion(q), true, q);
  }
  for (const q of ["Lance 1d20", "Fais un jet de perception", "Lance 1d20 selon les règles",
    "Affiche ma fiche",
    "Je lance une boule de feu", "Raconte-moi une histoire", "What's my character's name?"]) {
    assert.equal(isRulesQuestion(q), false, q);
  }
});

test("an exact official citation is accepted only after a completed matching tool call", () => {
  const question = "Quelle est la règle pour les attaques d'opportunité ?";
  assert.deepEqual(validateRulesReply({ question, reply: official, toolCalls: [searchCall], index }),
    { ok: true, reason: "verified-reference" });
  assert.deepEqual(validateRulesReply({ question, reply: official, toolCalls: [], index }),
    { ok: false, reason: "unretrieved-citation" });
  assert.equal(validateRulesReply({ question, reply: official,
    toolCalls: [{ ...searchCall, status: "running" }], index }).ok, false);
  assert.equal(validateRulesReply({ question, reply: official,
    toolCalls: [{ ...searchCall, isError: true }], index }).ok, false);
  assert.deepEqual(validateRulesReply({ question, reply: official,
    toolCalls: [{ ...searchCall, name: "foundry_rules_search" }], index }),
    { ok: true, reason: "verified-reference" });
});

test("made-up pages, mismatched anchor labels, 2014 and wrong official URLs are rejected", () => {
  const question = "Selon les règles, comment fonctionne l'attaque d'opportunité ?";
  for (const reply of [
    official.replace(/page=15/g, "page=999").replace(/p\. 15/g, "p. 999"),
    official.replace("PDF p. 15", "PDF p. 16"),
    official.replace(SOURCE, "https://unofficial.example/srd.pdf"),
    `<p>Check <a href="https://example.org/private.pdf">${book}, PDF p. 87</a>.</p>`,
    "<p>Selon le SRD 5.1, p. 15, tu peux agir.</p>"
  ]) {
    assert.equal(validateRulesReply({ question, reply, toolCalls: [searchCall], index }).ok, false, reply);
  }
});

test("private citations require a retrieved matching filename and exact PDF page", () => {
  const question = "Comment fonctionne un sort ?";
  const reply = `<p>Exemple. <em>${book}</em>, PDF p. 87</p>`;
  assert.equal(validateRulesReply({ question, reply, toolCalls: [privateCall], index }).ok, true);
  assert.equal(validateRulesReply({ question, reply, toolCalls: [searchCall], index }).ok, false);
  assert.equal(validateRulesReply({ question, reply: reply.replace("87", "88"),
    toolCalls: [privateCall], index }).ok, false);
  assert.deepEqual([...collectedEvidence(index, [privateCall])], [`${book}\u000087`]);
  assert.deepEqual([...collectedEvidence(index, [{ ...privateCall,
    name: "foundry_rules_read_page" }])], [`${book}\u000087`]);
  const beyondPage = { ...privateCall, input: { ...privateCall.input, offset: 99999 } };
  assert.deepEqual([...collectedEvidence(index, [beyondPage])], []);
});

test("an honest lack-of-source response is allowed; an uncited rule claim is not", () => {
  const question = "Peut-on lancer deux sorts dans le tour selon les règles ?";
  assert.deepEqual(validateRulesReply({ question, reply: "<p>Je ne peux pas vérifier cette règle.</p>", index }),
    { ok: true, reason: "no-rule-claim" });
  assert.equal(validateRulesReply({ question, reply: "<p>Oui, absolument.</p>", index }).ok, false);
  assert.equal(validateRulesReply({ question: "Lance 1d20", reply: "<p>Jet : 14</p>", index }).ok, true);
  assert.equal(citedPages(official).invalid, false);
});

test("the deployed guard substitutes a cautious response for unsupported citations", async t => {
  const directory = await mkdtemp(join(tmpdir(), "foundry-guard-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "index.json");
  await writeFile(path, JSON.stringify(index));
  const logs = [];
  const guard = createRulesReplyGuard({ indexPath: path, logger: { error: x => logs.push(x) } });
  const question = "Quelle est la règle d'attaque d'opportunité ?";
  assert.equal(await guard({ question, reply: official, toolCalls: [searchCall] }), official);
  const rejected = await guard({ question, reply: "<p>La réponse est 42.</p>", toolCalls: [] });
  assert.match(rejected, /Je ne peux pas vérifier/);
  assert.ok(logs.some(line => line.includes("missing-citation")));
  assert.equal(await guard({ question: "Lance 1d20", reply: "<p>Jet : 12</p>" }), "<p>Jet : 12</p>");
  const off = createRulesReplyGuard({ mode: "off" });
  assert.equal(await off({ question, reply: "<p>Sans source</p>" }), "<p>Sans source</p>");
});

test("citation guard cannot approve GM-only campaign evidence for a player", async t => {
  const directory = await mkdtemp(join(tmpdir(), "foundry-secret-citation-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const campaign = "Vecna_Eve_of_Ruin.pdf";
  const indexPath = join(directory, "index.json");
  const accessPath = join(directory, "access.json");
  await writeFile(indexPath, JSON.stringify({ ...index,
    private_sources: [...index.private_sources, { name: campaign, sha256: "b".repeat(64) }],
    pages: [...index.pages, { source: campaign, language: "en", page: 44,
      text: "Secret campaign resolution, available to the GM." }] }));
  await writeFile(accessPath, JSON.stringify({ version: 1, rules_for_all: [book] }));
  const guard = createRulesReplyGuard({ indexPath, accessPath, logger: { error() {} } });
  const question = "Quelle est la règle de Vecna ?";
  const call = { name: "rules_read_rule_page", status: "completed",
    input: { source: campaign, page: 44 } };
  const reply = `<p>${campaign}, PDF p. 44</p>`;
  assert.match(await guard({ question, reply, toolCalls: [call], role: 2 }), /Je ne peux pas vérifier/);
  assert.equal(await guard({ question, reply, toolCalls: [call], role: 4 }), reply);
  const publicRule = `<p>${book}, PDF p. 87</p>`;
  assert.equal(await guard({ question, reply: publicRule, toolCalls: [privateCall], role: 2 }), publicRule);
});

test("an absent rules index fails closed for explicit rules questions only", async t => {
  const directory = await mkdtemp(join(tmpdir(), "foundry-no-index-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const guard = createRulesReplyGuard({ indexPath: join(directory, "none.json"), logger: { error() {} } });
  assert.match(await guard({ question: "Can I cast two spells?", reply: "<p>Yes.</p>" }), /cannot verify/);
  assert.equal(await guard({ question: "Hello", reply: "<p>Bonjour !</p>" }), "<p>Bonjour !</p>");
});
