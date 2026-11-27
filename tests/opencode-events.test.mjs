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

test("Foundry rules search and page calls are recorded, but server-side failures are rejected", () => {
  const raw = [
    { type: "tool_use", part: { type: "tool", tool: "foundry_rules_search",
      state: { status: "completed", input: { query: "grapple" }, output: "Found indexed page" } } },
    { type: "tool_use", part: { type: "tool", tool: "foundry_rules_read_page",
      state: { status: "completed", input: { page: 8 },
        output: "Rules source unavailable or query rejected. Check the index." } } }
  ].map(JSON.stringify).join("\n");
  const calls = parseOpencodeEvents(raw).ruleCalls;
  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, "foundry_rules_search");
  assert.equal(calls[0].isError, false);
  assert.equal(calls[1].isError, true);
});

test("OpenCode V2 errors and incorrect resumed sessions never produce a successful result", () => {
  assert.throws(() => parseOpencodeEvents(JSON.stringify({ type: "error", sessionID: "ses_new",
    error: { name: "ProviderError" } })), /error event/);
  assert.throws(() => parseOpencodeEvents(JSON.stringify({ type: "text", sessionID: "ses_other",
    part: { text: "Wrong session" } }), "ses_expected"), /different V2 session/);
});

test("OpenCode V2 step/tool/text JSON stream keeps the resumed session ID", () => {
  const raw = [
    { type: "step_start", sessionID: "ses_v2", part: { type: "step-start" } },
    { type: "tool_use", sessionID: "ses_v2", part: { type: "tool", tool: "rules_search_rules",
      state: { status: "completed", input: { query: "grapple" }, output: "Found" } } },
    { type: "text", sessionID: "ses_v2", part: { type: "text", text: "<p>Cited answer</p>" } },
    { type: "step_finish", sessionID: "ses_v2", part: { type: "step-finish", reason: "stop" } }
  ].map(event => JSON.stringify(event)).join("\n");
  const result = parseOpencodeEvents(raw, "ses_v2");
  assert.equal(result.sessionID, "ses_v2");
  assert.equal(result.text, "<p>Cited answer</p>");
  assert.equal(result.ruleCalls[0].input.query, "grapple");
});

test("an interrupted assistant message does not get prefixed to the final HTML answer", () => {
  const partial = "<p><strong>Zariel</strong></p><ul><li>Page 244, ARCHDU";
  const final = "<p><strong>Zariel</strong></p><p>Details from the indexed PDF.</p>";
  const raw = [
    { type: "text", sessionID: "ses_gm", part: { type: "text", id: "prt_earlier",
      messageID: "msg_before_tool", text: partial } },
    { type: "tool_use", sessionID: "ses_gm", part: { type: "tool", messageID: "msg_before_tool",
      tool: "foundry_rules_search", state: { status: "completed",
        input: { query: "Zariel", source: "18_Descent_Avernus.pdf" }, output: "Page 244" } } },
    { type: "text", sessionID: "ses_gm", part: { type: "text", id: "prt_final",
      messageID: "msg_after_tool", text: final } }
  ].map(JSON.stringify).join("\n");
  const result = parseOpencodeEvents(raw);
  assert.equal(result.text, final);
  assert.equal(result.ruleCalls.length, 1, "source evidence must survive removing partial prose");
  assert.equal(result.ruleCalls[0].name, "foundry_rules_search");
});

test("repeated updates to one text part replace its snapshot instead of duplicating it", () => {
  const raw = [
    { type: "text", sessionID: "ses_1", part: { type: "text", id: "prt_1", messageID: "msg_1",
      text: "<p>First draft" } },
    { type: "text", sessionID: "ses_1", part: { type: "text", id: "prt_1", messageID: "msg_1",
      text: "<p>First draft is complete.</p>" } },
    { type: "text", sessionID: "ses_1", part: { type: "text", id: "prt_1", messageID: "msg_1",
      text: "<p>First draft is complete.</p>" } }
  ].map(JSON.stringify).join("\n");
  assert.equal(parseOpencodeEvents(raw).text, "<p>First draft is complete.</p>");
});

test("multiple distinct text parts from the final message remain in order", () => {
  const raw = [
    { type: "text", part: { type: "text", id: "prt_1", messageID: "msg_1", text: "<p>Intro.</p>" } },
    { type: "text", part: { type: "text", id: "prt_2", messageID: "msg_1", text: "<p>Conclusion.</p>" } }
  ].map(JSON.stringify).join("\n");
  assert.equal(parseOpencodeEvents(raw).text, "<p>Intro.</p><p>Conclusion.</p>");
});
