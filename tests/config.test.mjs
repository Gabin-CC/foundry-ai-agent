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
});

test("MCP credentials and model configuration reference documented environment variables", () => {
  for (const name of ["OPENCODE_MODEL", "FOUNDRY_MCP_URL", "FOUNDRY_MCP_AUTH_B64"]) {
    assert.match(envExample, new RegExp(`^${name}=`, "m"));
  }
  assert.ok(config.providers.openrouter);
  assert.equal(config.providers.openrouter.models["baidu/ernie-5.5-flash-preview:free"].limit.output, 500);
});
