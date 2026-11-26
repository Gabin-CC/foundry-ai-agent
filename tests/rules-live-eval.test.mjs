import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { checkRuleToolTrace, createIsolatedRulesWorkspace,
  EVALUATION_INSTRUCTIONS, isolatedOpenCodeConfig, isolatedProcessEnv,
  officialOnlyIndex, runIsolatedQuestion, validateOpenRouterModel } from "../lib/rules-live-eval.mjs";
import { SOURCE_SHA256 } from "../lib/rules.mjs";

const project = join(dirname(fileURLToPath(import.meta.url)), "..");
const model = "openrouter/baidu/ernie-5.5-flash-preview:free";
const suite = JSON.parse(await readFile(join(project, "eval", "rules-2024-srd.json"), "utf8"));
const officialPages = [...new Set(suite.cases.filter(item => item.reference).map(item => item.reference.page))]
  .map(page => ({ source: "srd", page, language: "en", text: suite.cases
    .filter(item => item.reference?.page === page).map(item => item.reference.anchor).join(". ") }));
const privatePage = { source: "Secret_2024.pdf", page: 9, language: "en", text: "A private rulebook fragment." };
const index = {
  version: "5.2.1", pdf_sha256: SOURCE_SHA256,
  private_sources: [{ name: "Secret_2024.pdf", sha256: "a".repeat(64) }],
  pages: [...officialPages, privatePage]
};

test("OpenCode configuration permits only a local SRD rules MCP and OpenRouter provider", () => {
  const config = isolatedOpenCodeConfig({ model, rulesMcpPath: "/project/rules-mcp.mjs",
    indexPath: "/tmp/srd-only.json", workspace: "/tmp/eval-workspace" });
  assert.equal(config.model, model);
  assert.deepEqual(Object.keys(config.providers), ["openrouter"]);
  assert.deepEqual(Object.keys(config.providers.openrouter.models), ["baidu/ernie-5.5-flash-preview:free"]);
  assert.deepEqual(Object.keys(config.mcp.servers), ["rules"]);
  assert.equal(config.mcp.servers.rules.type, "local");
  assert.equal(config.mcp.servers.rules.codemode, false);
  assert.equal(config.permissions[0].effect, "deny");
  assert.deepEqual(config.permissions.slice(1).map(x => x.action).sort(),
    ["rules_list_rule_sources", "rules_read_rule_page", "rules_search_rules"].sort());
  assert.ok(config.policies.some(p => p.action === "mcp.use" && p.resource === "*" && p.effect === "deny"));
  assert.ok(config.policies.some(p => p.action === "mcp.use" && p.resource === "rules" && p.effect === "allow"));
  assert.ok(config.policies.some(p => p.action === "tool.use" && p.resource === "*" && p.effect === "deny"));
  assert.ok(config.policies.some(p => p.action === "provider.use" && p.resource === "*" && p.effect === "deny"));
  assert.ok(config.policies.some(p => p.action === "provider.use" && p.resource === "openrouter" && p.effect === "allow"));
  assert.ok(!JSON.stringify(config).toLowerCase().includes("foundry_mcp"));
  assert.match(EVALUATION_INSTRUCTIONS, /search_rules first/);
  assert.throws(() => validateOpenRouterModel("anthropic/claude"), /OpenRouter/);
  assert.throws(() => validateOpenRouterModel("openrouter/foo;touch /tmp/x"), /OpenRouter/);
});

test("the SRD index drops every private page and all private-source metadata", () => {
  const copy = officialOnlyIndex(index);
  assert.deepEqual(copy.pages, officialPages);
  assert.deepEqual(copy.private_sources, []);
  assert.equal(JSON.stringify(copy).includes("Secret_2024.pdf"), false);
});

test("the environment allowlist drops all inherited Foundry credentials and OpenCode state", () => {
  const env = isolatedProcessEnv({ root: "/tmp/isolated-eval", providerKey: "fake-provider-key", path: "/bin" });
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME",
    "XDG_STATE_HOME", "PATH", "LANG", "TERM", "CI", "OPENROUTER_API_KEY"].sort());
  assert.equal(env.OPENROUTER_API_KEY, "fake-provider-key");
  assert.ok(env.HOME.startsWith("/tmp/isolated-eval/"));
  assert.ok(!("FOUNDRY_MCP_URL" in env));
  assert.ok(!("AI_PASSWORD" in env));
  assert.throws(() => isolatedProcessEnv({ root: "/tmp/srd", providerKey: "" }), /OPENROUTER_API_KEY/);
});

test("a generated temporary workspace contains no commercial rule pages or remote MCP", async t => {
  const isolated = await createIsolatedRulesWorkspace({ index, model,
    rulesMcpPath: join(project, "rules-mcp.mjs") });
  t.after(() => isolated.cleanup());
  const loaded = JSON.parse(await readFile(isolated.indexPath, "utf8"));
  const cfg = JSON.parse(await readFile(join(isolated.workspace, "opencode.json"), "utf8"));
  assert.deepEqual(loaded.pages, officialPages);
  assert.deepEqual(Object.keys(cfg.mcp.servers), ["rules"]);
  assert.equal((await readFile(join(isolated.workspace, "AGENTS.md"), "utf8")), EVALUATION_INSTRUCTIONS);
});

test("OpenCode transcript parser rejects any non-rules tool, not just game writes", () => {
  const valid = JSON.stringify({ type: "tool_use", part: { type: "tool", tool: "rules_search_rules",
    state: { status: "completed", input: { query: "opportunity attack" }, output: "[]" } } });
  assert.equal(checkRuleToolTrace(valid).ruleCalls.length, 1);
  for (const tool of ["foundry_gm_delete", "shell", "edit", "unknown_plugin_tool"]) {
    assert.throws(() => checkRuleToolTrace(JSON.stringify({ type: "tool_use",
      part: { type: "tool", tool, state: { status: "running" } } })), /Forbidden/);
  }
});

test("the runner aborts when an OpenCode process attempts a forbidden tool", async t => {
  const directory = await mkdtemp(join(tmpdir(), "fake-unsafe-opencode-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const executable = join(directory, "fake-unsafe-opencode.mjs");
  await writeFile(executable, `#!${process.execPath}\nconsole.log(JSON.stringify({type:"tool_use",part:{type:"tool",tool:"shell",state:{status:"running"}}}));`,
    { mode: 0o700 });
  await chmod(executable, 0o700);
  const isolated = await createIsolatedRulesWorkspace({ index, model,
    rulesMcpPath: join(project, "rules-mcp.mjs") });
  t.after(() => isolated.cleanup());
  await assert.rejects(runIsolatedQuestion({ binary: executable, model,
    workspace: isolated.workspace,
    env: isolatedProcessEnv({ root: isolated.root, providerKey: "fake-only" }),
    question: "Can I cast two spells?", timeoutMs: 10000 }), /forbidden tool/i);
});

test("mock OpenCode subprocess records real-format evidence without receiving Foundry secrets", async t => {
  const directory = await mkdtemp(join(tmpdir(), "fake-open-code-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const mock = join(directory, "fake-opencode.mjs");
  // This is a fake executable: no API call and no actual OpenCode installation.
  await writeFile(mock, `#!${process.execPath}\nimport fs from "node:fs";
if (process.argv[2] === "--version") { console.log("opencode 2.4.2"); process.exit(0); }
const config = JSON.parse(fs.readFileSync("opencode.json", "utf8"));
const index = JSON.parse(fs.readFileSync(config.mcp.servers.rules.environment.RULES_INDEX_PATH, "utf8"));
if (process.env.FOUNDRY_MCP_URL || process.env.AI_PASSWORD || process.env.ADMIN_PASSWORD ||
    process.env.OPENCODE_CONFIG || index.private_sources.length ||
    process.env.OPENROUTER_API_KEY !== "test-only-key" ||
    Object.keys(config.mcp.servers).length !== 1 || !process.env.HOME.includes("foundry-srd-eval-")) process.exit(9);
console.log(JSON.stringify({type:"tool_use",part:{type:"tool",tool:"rules_read_rule_page",state:{status:"completed",input:{source:"srd",page:15},output:"page text"}}}));
console.log(JSON.stringify({type:"text",part:{text:"<p>An Opportunity Attack uses a Reaction.</p>"}}));
`, { mode: 0o700 });
  await chmod(mock, 0o700);
  const isolated = await createIsolatedRulesWorkspace({ index, model,
    rulesMcpPath: join(project, "rules-mcp.mjs") });
  t.after(() => isolated.cleanup());
  const env = isolatedProcessEnv({ root: isolated.root, providerKey: "test-only-key" });
  const answer = await runIsolatedQuestion({ binary: mock, model, workspace: isolated.workspace,
    env, question: "What is an opportunity attack?", timeoutMs: 10000 });
  assert.match(answer.reply, /Opportunity Attack/);
  assert.equal(answer.toolCalls[0].input.page, 15);

  const output = join(directory, "replies.jsonl");
  const command = ["scripts/evaluate-rules-live.mjs", "--execute", "--model", model,
    "--output", output, "--case", "opportunity-attack-reaction", "--binary", mock,
    "--index", join(directory, "source-index.json")];
  await writeFile(join(directory, "source-index.json"), JSON.stringify(index));
  execFileSync(process.execPath, command, {
    cwd: project, env: { ...process.env, OPENROUTER_API_KEY: "test-only-key",
      FOUNDRY_MCP_URL: "https://example.invalid/mcp", AI_PASSWORD: "never-forward" },
    encoding: "utf8"
  });
  const recorded = JSON.parse((await readFile(output, "utf8")).trim());
  assert.equal(recorded.id, "opportunity-attack-reaction");
  assert.equal(recorded.toolCalls.length, 1);
  assert.equal(recorded.reply, answer.reply);
  assert.throws(() => execFileSync(process.execPath, command, { cwd: project,
    env: { ...process.env, OPENROUTER_API_KEY: "test-only-key" }, encoding: "utf8", stdio: "pipe" }),
  /Command failed/); // Output is never overwritten.
});

test("CLI dry-run does not need provider credentials, corpus download, or an OpenCode binary", async t => {
  const directory = await mkdtemp(join(tmpdir(), "rules-eval-dry-run-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const corpus = join(directory, "index.json");
  await writeFile(corpus, JSON.stringify(index));
  const output = execFileSync(process.execPath,
    ["scripts/evaluate-rules-live.mjs", "--dry-run", "--model", model,
      "--case", "unsourced-vecna-ritual", "--binary", "/nonexistent/opencode", "--index", corpus],
    { cwd: project, encoding: "utf8", env: { PATH: process.env.PATH } });
  const result = JSON.parse(output);
  assert.equal(result.mode, "dry-run");
  assert.deepEqual(result.mcpServers, ["rules"]);
  assert.deepEqual(result.cases, ["unsourced-vecna-ritual"]);
  assert.equal(result.foundry, "unavailable");
});

test("live evaluation rejects OpenCode V1 before creating an output file", async t => {
  const directory = await mkdtemp(join(tmpdir(), "v1-opencode-eval-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const binary = join(directory, "old-opencode.mjs");
  await writeFile(binary, `#!${process.execPath}\nconsole.log("opencode 1.19.6");`, { mode: 0o700 });
  await chmod(binary, 0o700);
  const corpus = join(directory, "index.json");
  const output = join(directory, "never-created.jsonl");
  await writeFile(corpus, JSON.stringify(index));
  let stderr;
  try {
    execFileSync(process.execPath, ["scripts/evaluate-rules-live.mjs", "--execute",
      "--model", model, "--case", "opportunity-attack-reaction", "--binary", binary,
      "--index", corpus, "--output", output], {
      cwd: project, encoding: "utf8", env: { ...process.env, OPENROUTER_API_KEY: "test-only-key" },
      stdio: "pipe"
    });
    assert.fail("V1 must be rejected");
  } catch (error) {
    stderr = error.stderr;
  }
  assert.match(stderr, /requires OpenCode V2\.x/);
  await assert.rejects(readFile(output, "utf8"), error => error.code === "ENOENT");
});
