// Extract the final reply and completed rule-tool calls from OpenCode NDJSON.
// Tool outputs are intentionally discarded: only tool name/input/status are
// required for local, deterministic evidence verification.
export function parseOpencodeEvents(raw, sessionId) {
  let id = sessionId, reply = "";
  const ruleCalls = [];
  for (const line of String(raw || "").split("\n")) {
    const value = line.trim();
    if (!value.startsWith("{")) continue;
    try {
      const event = JSON.parse(value);
      if (event.sessionID && !id) id = event.sessionID;
      if (event.type === "text" && typeof event.part?.text === "string") reply += event.part.text;
      const part = event.part;
      if (event.type !== "tool_use" || part?.type !== "tool" ||
          !["rules_search_rules", "rules_read_rule_page"].includes(part.tool) ||
          part.state?.status !== "completed") continue;
      const output = String(part.state.output || "");
      const isError = part.state.metadata?.isError === true ||
        /"isError"\s*:\s*true|Rules index unavailable:/i.test(output);
      ruleCalls.push({ name: part.tool, status: "completed", input: part.state.input, isError });
    } catch { /* Ignore unparseable terminal lines. */ }
  }
  return { sessionID: id, text: reply.trim(), ruleCalls };
}
