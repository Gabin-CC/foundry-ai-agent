import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOpencodeEvents } from "../lib/opencode-events.mjs";

test("OpenCode NDJSON parser keeps reply, session, and only completed rules calls", () => {
  const rows = [
    "terminal banner",
    JSON.stringify({ type: "text", sessionID: "ses_1", part: { text: "<p>Answer " } }),
    JSON.stringify({ type: "tool_use", part: { type: "tool", tool: "rules_search_rules",
      state: { status: "running", input: { query: "opportunity attack" } } } }),
    JSON.stringify({ type: "tool_use", part: { type: "tool", tool: "rules_search_rules",
      state: { status: "completed", input: { query: "opportunity attack" }, output: "Results..." } } }),
    JSON.stringify({ type: "tool_use", part: { type: "tool", tool: "foundry_roll",
      state: { status: "completed", input: { dice: "1d20" }, output: "14" } } }),
    JSON.stringify({ type: "text", part: { text: "with citation.</p>" } })
  ];
  const result = parseOpencodeEvents(rows.join("\n"));
  assert.equal(result.sessionID, "ses_1");
  assert.equal(result.text, "<p>Answer with citation.</p>");
  assert.deepEqual(result.ruleCalls, [{ name: "rules_search_rules", status: "completed",
    input: { query: "opportunity attack" }, isError: false }]);
});

test("a rules MCP tool returning isError is not counted as supporting evidence", () => {
  const raw = JSON.stringify({ type: "tool_use", part: { type: "tool", tool: "rules_read_rule_page",
    state: { status: "completed", input: { page: 99 },
      output: '{"isError":true,"content":[]}' } } });
  assert.equal(parseOpencodeEvents(raw).ruleCalls[0].isError, true);
});
