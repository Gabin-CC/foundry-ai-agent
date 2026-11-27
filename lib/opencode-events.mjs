// Extract the final reply and completed rule-tool calls from OpenCode NDJSON.
// Tool outputs are intentionally discarded: only tool name/input/status are
// required for local, deterministic evidence verification.
export function parseOpencodeEvents(raw, sessionId) {
  let id = sessionId;
  // OpenCode may emit an unfinished assistant message before a tool call,
  // followed by a complete new assistant message. Only the last message is
  // the user-facing answer. Updates to an existing part ID are snapshots,
  // not additional text to concatenate.
  const textMessages = new Map();
  let lastTextMessage = null;
  const ruleCalls = [];
  for (const line of String(raw || "").split("\n")) {
    const value = line.trim();
    if (!value.startsWith("{")) continue;
    let event;
    try { event = JSON.parse(value); }
    catch { continue; /* Ignore non-JSON terminal lines, not valid event errors. */ }
    if (event.type === "error") throw new Error("OpenCode reported an error event; no reply was accepted");
    if (event.sessionID) {
      if (sessionId && event.sessionID !== sessionId) {
        throw new Error("OpenCode returned a different V2 session than requested");
      }
      if (!id) id = event.sessionID;
    }
    if (event.type === "text" && typeof event.part?.text === "string") {
      const part = event.part;
      // Older OpenCode outputs may omit both IDs: keep appending those
      // fragments in their original order for backward compatibility.
      const messageKey = (typeof part.messageID === "string" && part.messageID) ||
        (typeof event.messageID === "string" && event.messageID) ||
        lastTextMessage || Symbol("anonymous-message");
      if (!textMessages.has(messageKey)) {
        textMessages.set(messageKey, new Map());
        lastTextMessage = messageKey;
      }
      const partKey = (typeof part.id === "string" && part.id) || Symbol("text-fragment");
      textMessages.get(messageKey).set(partKey, part.text);
    }
    const part = event.part;
    if (event.type !== "tool_use" || part?.type !== "tool" ||
        !["foundry_rules_search", "foundry_rules_read_page",
          "rules_search_rules", "rules_read_rule_page"].includes(part.tool) ||
        part.state?.status !== "completed") continue;
    const output = String(part.state.output || "");
    const isError = part.state.metadata?.isError === true ||
      /"isError"\s*:\s*true|Rules index unavailable:|Rules source unavailable or query rejected/i.test(output);
    ruleCalls.push({ name: part.tool, status: "completed", input: part.state.input, isError });
  }
  const lastParts = textMessages.get(lastTextMessage);
  return { sessionID: id, text: lastParts ? [...lastParts.values()].join("").trim() : "", ruleCalls };
}
