import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { loadRules, readRulePage, searchRules, SOURCE, SOURCE_SHA256, validateIndex } from "../lib/rules.mjs";

const index = {
  version: "5.2.1",
  pdf_sha256: SOURCE_SHA256,
  pages: [
    { language: "en", page: 41, text: "Grappled Condition. Your Speed is 0 while you are Grappled. This condition ends if the grappler is Incapacitated." },
    { language: "en", page: 42, text: "Prone Condition. A prone creature can crawl. Attack rolls may have Advantage or Disadvantage." },
    { language: "en", page: 53, text: "Opportunity Attack. You can make an Opportunity Attack when a creature you can see leaves your reach." },
    { language: "en", page: 54, text: "Bonus Action. You can take a Bonus Action only when a rule allows it." }
  ]
};

test("retrieval returns an exact official English SRD PDF URL and page", () => {
  const result = searchRules(index, "opportunity attack creature");
  assert.equal(result[0].page, 53);
  assert.equal(result[0].source, "SRD 5.2.1 EN");
  assert.equal(result[0].url, `${SOURCE}#page=53`);
  assert.match(result[0].text, /Opportunity Attack/);
  assert.deepEqual(searchRules(index, "weird unrelated impossible"), []);
});

test("source pages are read as published, with no fabricated missing page", () => {
  assert.equal(readRulePage(index, 41).text, index.pages[0].text);
  assert.equal(readRulePage(index, 999), null);
  assert.throws(() => validateIndex({ ...index, version: "5.1" }), /Invalid SRD/);
  assert.throws(() => validateIndex({ ...index, pdf_sha256: "wrong" }), /Invalid SRD/);
  assert.throws(() => validateIndex({ ...index, pages: [{ language: "fr", page: 2, text: "rule" }] }), /Malformed/);
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
    env: { ...process.env, RULES_INDEX_PATH: path }
  });
  const client = new Client({ name: "rules-test", version: "1.0.0" });
  t.after(async () => client.close());
  await client.connect(transport);

  const tools = (await client.listTools()).tools.map(tool => tool.name);
  assert.deepEqual(tools.sort(), ["read_rule_page", "search_rules"]);
  const found = await client.callTool({
    name: "search_rules", arguments: { query: "opportunity attack creature" }
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
