import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const config = JSON.parse(readFileSync(new URL("../opencode.json", import.meta.url), "utf8"));
const envExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");

test("OpenCode references its configured model", () => {
  assert.equal(config.model, "{env:OPENCODE_MODEL}");
  assert.ok(config.instructions.includes("AGENTS.md"));
});

test("Foundry MCP uses the documented remote-server layout", () => {
  const foundry = config.mcp.servers.foundry;
  assert.equal(foundry.type, "remote");
  assert.equal(foundry.url, "{env:FOUNDRY_MCP_URL}");
  assert.equal(foundry.oauth, false);
  assert.equal(foundry.headers.Authorization, "Basic {env:FOUNDRY_MCP_AUTH_B64}");
  assert.equal(foundry.headers["X-Rules-Audience"], "{env:RULES_ACCESS_ROLE}");
});

test("all model-facing rules searches use the role-scoped Foundry MCP endpoint", () => {
  assert.deepEqual(Object.keys(config.mcp.servers), ["foundry"]);
});

test("player agent cannot read campaign files through built-in OpenCode tools", () => {
  const agent = config.agents["foundry-player"];
  assert.equal(agent.mode, "primary");
  for (const action of ["read", "shell", "glob", "grep", "edit", "execute", "webfetch", "websearch", "subagent"]) {
    assert.ok(agent.permissions.some(p => p.action === action && p.effect === "deny" && p.resource === "*"), action);
  }
  assert.ok(agent.permissions.some(p => p.action === "foundry_gm_*" && p.resource === "*" && p.effect === "deny"));
  assert.ok(agent.permissions.some(p => p.action === "opencode_read_mcp_resource" && p.resource === "foundry:*" && p.effect === "deny"));
  assert.ok(!agent.permissions.some(p => p.action === "foundry_rules_search" && p.effect === "deny"));
});

test("MCP credentials and model configuration reference documented environment variables", () => {
  for (const name of ["OPENCODE_MODEL", "FOUNDRY_MCP_URL", "FOUNDRY_MCP_AUTH_B64"]) {
    assert.match(envExample, new RegExp(`^${name}=`, "m"));
  }
  assert.ok(config.providers.openrouter);
  assert.equal(config.providers.openrouter.models["baidu/ernie-5.5-flash-preview:free"].limit.output, 500);
});

test("rules citation verification is configurable without storing private rulebooks", () => {
  assert.match(envExample, /^RULES_CITATION_MODE=enforce$/m);
  assert.match(envExample, /^RULES_INDEX_PATH=$/m);
  assert.match(envExample, /^RULES_SEARCH_METRICS=0$/m);
  assert.match(envExample, /^RULES_ACCESS_ROLE=player$/m);
});

test("Foundry MCP disables codemode so rules tool calls are visible to the citation guard", () => {
  // When codemode is on, the model calls rules_search inside an `execute` code
  // block, which the citation guard cannot see as a direct tool call. Explicit
  // `codemode: false` forces direct foundry_rules_search / foundry_rules_read_page
  // calls that the guard validates.
  assert.strictEqual(config.mcp.servers.foundry.codemode, false);
});
