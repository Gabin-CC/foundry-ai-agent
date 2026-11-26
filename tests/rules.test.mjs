import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { compileRulesSearch, listRuleSources, loadRules, readRulePage, searchRules,
  SEARCH_SIDECAR_NAME, SOURCE, SOURCE_SHA256, validPdfName, validateIndex } from "../lib/rules.mjs";

const index = {
  version: "5.2.1",
  pdf_sha256: SOURCE_SHA256,
  private_sources: [{ name: "Players_Handbook_2024.pdf", sha256: "a".repeat(64) }],
  pages: [
    { source: "srd", language: "en", page: 41, text: "Grappled Condition. Your Speed is 0 while you are Grappled. This condition ends if the grappler is Incapacitated." },
    { source: "srd", language: "en", page: 42, text: "Prone Condition. A prone creature can crawl. Attack rolls may have Advantage or Disadvantage." },
    { source: "srd", language: "en", page: 53, text: "Opportunity Attack. You can make an Opportunity Attack when a creature you can see leaves your reach." },
    { source: "srd", language: "en", page: 54, text: "Bonus Action. You can take a Bonus Action only when a rule allows it." },
    { source: "Players_Handbook_2024.pdf", language: "en", page: 53, text: "Imaginary example for test: Azure Step lets a wizard dance in blue light." },
    { source: "Players_Handbook_2024.pdf", language: "en", page: 87, text: "Imaginary example for test: Azure Step is used while traversing a bridge." }
  ]
};

test("retrieval returns an exact official English SRD PDF URL and page", () => {
  const result = searchRules(index, "opportunity attack creature", { source: "srd" });
  assert.equal(result[0].page, 53);
  assert.equal(result[0].source, "SRD 5.2.1 EN");
  assert.equal(result[0].url, `${SOURCE}#page=53`);
  assert.match(result[0].text, /Opportunity Attack/);
  assert.deepEqual(searchRules(index, "weird unrelated impossible"), []);
});

test("private PDFs are searchable with their own source ID and page, never a fake official link", () => {
  const found = searchRules(index, "Azure Step", { source: "Players_Handbook_2024.pdf" });
  assert.equal(found[0].source_id, "Players_Handbook_2024.pdf");
  assert.equal(found[0].url, null);
  assert.match(found[0].kind, /not independently verified/);
  assert.deepEqual(found.map(item => item.page).sort((a, b) => a - b), [53, 87]);
  assert.equal(readRulePage(index, 53, "Players_Handbook_2024.pdf").source, "Players_Handbook_2024.pdf");
  assert.equal(readRulePage(index, 53).source, "SRD 5.2.1 EN");
  assert.equal(listRuleSources(index)[1].id, "Players_Handbook_2024.pdf");
  assert.throws(() => searchRules(index, "Azure Step", { source: "unknown" }), /Unknown rule source/);
});

test("source pages are read as published, with no fabricated missing page", () => {
  assert.equal(readRulePage(index, 41).text, index.pages[0].text);
  assert.equal(readRulePage(index, 999), null);
  assert.throws(() => validateIndex({ ...index, version: "5.1" }), /Invalid SRD/);
  assert.throws(() => validateIndex({ ...index, pdf_sha256: "wrong" }), /Invalid SRD/);
  assert.throws(() => validateIndex({ ...index, pages: [{ language: "fr", page: 2, text: "rule" }] }), /Malformed/);
  assert.throws(() => validateIndex({ ...index, private_sources: [{ name: "../private.pdf", sha256: "a".repeat(64) }] }), /Malformed private/);
  assert.equal(validPdfName("../oops.pdf"), false);
  assert.equal(validPdfName("Rules2024.pdf"), true);
});

test("precompiled search sidecar is compact, deterministic and ignored when stale", async t => {
  const directory = await mkdtemp(join(tmpdir(), "rules-search-sidecar-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "srd-5.2.1.json");
  const raw = JSON.stringify(index);
  await writeFile(path, raw);
  const data = compileRulesSearch(index);
  assert.ok(data.documents.length >= index.pages.length);
  assert.equal(data.page_count, index.pages.length);
  assert.ok(Array.isArray(data.documents[0]));
  const cached = { ...data, index_sha256: createHash("sha256").update(raw).digest("hex") };
  const sidecar = join(directory, SEARCH_SIDECAR_NAME);
  await writeFile(sidecar, JSON.stringify(cached));
  const withSidecar = await loadRules(path);
  assert.deepEqual(searchRules(withSidecar, "opportunity attack", { source: "srd" }),
    searchRules(index, "opportunity attack", { source: "srd" }));
  await writeFile(sidecar, JSON.stringify({ ...cached, index_sha256: "stale" }));
  const rebuilt = await loadRules(path);
  assert.deepEqual(searchRules(rebuilt, "Azure Step", { source: "Players_Handbook_2024.pdf" }),
    searchRules(index, "Azure Step", { source: "Players_Handbook_2024.pdf" }));
});

test("ranking can prefer public rulebooks for equally relevant rules", () => {
  const duplicate = { ...index,
    private_sources: [...index.private_sources, { name: "Campaign.pdf", sha256: "b".repeat(64) }],
    pages: [...index.pages, { source: "Campaign.pdf", language: "en", page: 3,
      text: "Imaginary example for test: Azure Step lets a wizard dance in blue light." }] };
  const results = searchRules(duplicate, "Azure Step", { preferredSources: ["Players_Handbook_2024.pdf"] });
  assert.equal(results[0].source_id, "Players_Handbook_2024.pdf");
});

test("a rules glossary heading outranks passing monster mentions", () => {
  const sample = { ...index, private_sources: [], pages: [
    { source: "srd", language: "en", page: 12,
      text: "Grappled\nWhile you have the Grappled condition, your Speed is 0." },
    { source: "srd", language: "en", page: 301,
      text: "Monster description. It causes the Grappled condition. A creature in the Grappled condition suffers an effect." }
  ] };
  assert.equal(searchRules(sample, "grappled condition")[0].page, 12);
});

test("local MCP server exposes read-only rules search and exact-page verification", async t => {
  const directory = await mkdtemp(join(tmpdir(), "foundry-srd-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "srd.json");
  await writeFile(path, JSON.stringify(index));
  assert.deepEqual(await loadRules(path), index);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("rules-mcp.mjs")],
    cwd: resolve("."),
    env: { ...process.env, RULES_INDEX_PATH: path, RULES_ACCESS_ROLE: "gm" }
  });
  const client = new Client({ name: "rules-test", version: "1.0.0" });
  t.after(async () => client.close());
  await client.connect(transport);

  const tools = (await client.listTools()).tools.map(tool => tool.name);
  assert.deepEqual(tools.sort(), ["list_rule_sources", "read_rule_page", "search_rules"]);
  const listed = await client.callTool({ name: "list_rule_sources", arguments: {} });
  assert.equal(JSON.parse(listed.content[0].text)[1].id, "Players_Handbook_2024.pdf");
  const found = await client.callTool({
    name: "search_rules", arguments: { query: "opportunity attack creature", source: "srd" }
  });
  const matches = JSON.parse(found.content[0].text);
  assert.equal(matches[0].url, `${SOURCE}#page=53`);

  const full = await client.callTool({
    name: "read_rule_page", arguments: { page: 53 }
  });
  assert.equal(JSON.parse(full.content[0].text).text, index.pages[2].text);
  const missing = await client.callTool({
    name: "read_rule_page", arguments: { page: 1000 }
  });
  assert.match(missing.content[0].text, /do not cite/i);

  const local = await client.callTool({
    name: "search_rules", arguments: { query: "Azure Step", source: "Players_Handbook_2024.pdf" }
  });
  assert.equal(JSON.parse(local.content[0].text)[0].url, null);
  const privatePage = await client.callTool({
    name: "read_rule_page", arguments: { source: "Players_Handbook_2024.pdf", page: 87 }
  });
  assert.match(JSON.parse(privatePage.content[0].text).text, /Azure Step/);
});

test("player MCP cannot list, search or read a campaign, including by exact filename", async t => {
  const directory = await mkdtemp(join(tmpdir(), "foundry-player-rules-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const campaign = "Vecna_Eve_of_Ruin.pdf";
  const path = join(directory, "index.json");
  const policyPath = join(directory, "access.json");
  await writeFile(path, JSON.stringify({ ...index,
    private_sources: [...index.private_sources, { name: campaign, sha256: "a".repeat(64) }],
    pages: [...index.pages, { source: campaign, language: "en", page: 13,
      text: "Secret villain identity and campaign ending." }] }));
  await writeFile(policyPath, JSON.stringify({ version: 1,
    rules_for_all: ["Players_Handbook_2024.pdf"] }));
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [resolve("rules-mcp.mjs")], cwd: resolve("."),
    env: { ...process.env, RULES_INDEX_PATH: path, RULES_ACCESS_FILE: policyPath,
      RULES_ACCESS_ROLE: "player" } });
  const client = new Client({ name: "player-rules-test", version: "1.0.0" });
  t.after(async () => client.close());
  await client.connect(transport);
  const listed = await client.callTool({ name: "list_rule_sources", arguments: {} });
  const names = JSON.parse(listed.content[0].text).map(item => item.id);
  assert.deepEqual(names, ["srd", "Players_Handbook_2024.pdf"]);
  const search = await client.callTool({ name: "search_rules",
    arguments: { query: "secret villain identity", source: "all" } });
  assert.doesNotMatch(search.content[0].text, /villain identity|Vecna_Eve/);
  const direct = await client.callTool({ name: "read_rule_page",
    arguments: { source: campaign, page: 13 } });
  assert.match(direct.content[0].text, /unavailable/i);
  assert.doesNotMatch(direct.content[0].text, /villain|ending/);
  const allowed = await client.callTool({ name: "read_rule_page",
    arguments: { source: "Players_Handbook_2024.pdf", page: 53 } });
  assert.match(allowed.content[0].text, /Azure Step/);

  // Policy changes take effect without rebuilding the PDF search corpus.
  await writeFile(policyPath, JSON.stringify({ version: 1, rules_for_all: [] }));
  const updated = await client.callTool({ name: "list_rule_sources", arguments: {} });
  assert.deepEqual(JSON.parse(updated.content[0].text).map(item => item.id), ["srd"]);
  const afterChange = await client.callTool({ name: "search_rules",
    arguments: { query: "Azure Step", source: "all" } });
  assert.doesNotMatch(afterChange.content[0].text, /Azure Step/);
});

test("MCP paginates long pages instead of flooding the model context", async t => {
  const directory = await mkdtemp(join(tmpdir(), "rules-page-window-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "index.json");
  const longText = "Spellcasting rules and concentration. ".repeat(300);
  await writeFile(path, JSON.stringify({ ...index,
    pages: [{ source: "srd", language: "en", page: 9, text: longText }] }));
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [resolve("rules-mcp.mjs")], cwd: resolve("."),
    env: { ...process.env, RULES_INDEX_PATH: path, RULES_ACCESS_ROLE: "player" } });
  const client = new Client({ name: "window-test", version: "1.0.0" });
  t.after(async () => client.close());
  await client.connect(transport);
  const first = await client.callTool({ name: "read_rule_page", arguments: { page: 9 } });
  const firstPage = JSON.parse(first.content[0].text);
  assert.equal(firstPage.text.length, 6000);
  assert.equal(firstPage.next_offset, 6000);
  assert.equal(firstPage.total_characters, longText.length);
  const next = await client.callTool({ name: "read_rule_page",
    arguments: { page: 9, offset: firstPage.next_offset } });
  const nextPage = JSON.parse(next.content[0].text);
  assert.equal(firstPage.text + nextPage.text, longText);
  assert.equal(nextPage.next_offset, null);
  const beyond = await client.callTool({ name: "read_rule_page",
    arguments: { page: 9, offset: longText.length } });
  assert.match(beyond.content[0].text, /unavailable/i);
});

test("missing SRD corpus fails explicitly, never returning made-up citations", async t => {
  const directory = await mkdtemp(join(tmpdir(), "foundry-srd-missing-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("rules-mcp.mjs")], cwd: resolve("."),
    env: { ...process.env, RULES_INDEX_PATH: join(directory, "missing.json") }
  });
  const client = new Client({ name: "missing-test", version: "1.0.0" });
  t.after(async () => client.close());
  await client.connect(transport);
  const response = await client.callTool({ name: "search_rules", arguments: { query: "grappled" } });
  assert.equal(response.isError, true);
  assert.match(response.content[0].text, /npm run rules:setup/);
});
