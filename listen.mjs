// Foundry chat -> OpenCode bridge (shared AI Assistant GM).
// See README.md for configuration and checkpoint/restart behavior.
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { FoundryMessageBridge } from "./lib/bridge.mjs";
import { ChatHistoryReader } from "./lib/chat-reader.mjs";

// Module exporting FoundrySession. A local MCP server can be configured here.
const { FoundrySession } = await import(process.env.FOUNDRY_MCP_MODULE || "foundry-vtt-mcp-server");

const env = process.env;
const AI_USER = env.AI_USER || "AI";
const AI_PASS = env.AI_PASSWORD || "";
const ADMIN_PASS = env.ADMIN_PASSWORD || "";
const ALLOW = (env.ALLOWED_SENDERS || "").split(",").map(s => s.trim()).filter(Boolean);
const OPENCODE = env.OPENCODE_BIN || "opencode";
const AGENT_DIR = env.AGENT_DIR || process.cwd();
const STATE_FILE = env.STATE_FILE || join(AGENT_DIR, ".state", "bridge-state.json");
const POLL_MS = Number(env.POLL_MS || 3000);
const MAX_REPLY = Number(env.MAX_REPLY || 4000);
const RESET_MS = Number(env.RESET_MS || 86400000);
const RESET_MSGS = Number(env.RESET_MSGS || 1000);
const MAX_CONCURRENT = Number(env.MAX_CONCURRENT || 3);
const CHAT_FILTER_MODE = env.CHAT_FILTER_MODE || "auto";
const CHAT_RESYNC_MS = Number(env.CHAT_RESYNC_MS || 120000);
const CHAT_LOOKBACK_MS = Number(env.CHAT_LOOKBACK_MS || 120000);

const run = promisify(execFile);

// Keep the existing pseudo-terminal invocation for OpenCode compatibility.
async function askOpencode(prompt, sessionId) {
  const escapedPrompt = prompt.replace(/'/g, "'\\''");
  const sessionArg = sessionId ? `--session ${sessionId} ` : "";
  const command = `${OPENCODE} run --format json ${sessionArg}'${escapedPrompt}'`;
  const result = await run("script", ["-q", "-e", "-c", command, "/dev/null"],
    { cwd: AGENT_DIR, maxBuffer: 16 * 1024 * 1024, timeout: 120000 });
  const raw = String(result.stdout || "").replace(/\x1b\[[0-9;]*m/g, "");
  let id = sessionId, text = "";
  for (const line of raw.split("\n")) {
    const value = line.trim();
    if (!value.startsWith("{")) continue;
    try {
      const event = JSON.parse(value);
      if (event.sessionID && !id) id = event.sessionID;
      if (event.type === "text" && event.part?.text) text += event.part.text;
    } catch { /* Ignore non-JSON terminal output. */ }
  }
  return { sessionID: id, text: text.trim() };
}

const session = await FoundrySession.login(AI_USER, AI_PASS, { adminPassword: ADMIN_PASS });
if (!session) {
  console.error(`[agent] could not log in as ${AI_USER}`);
  process.exit(1);
}
const aiId = session.userId;
const users = await session.doc("get", "User", { query: {} }).catch(() => []);
const usersById = {};
for (const user of users) usersById[user._id] = { name: user.name, role: user.role };
console.error(`[agent] connected as ${session.user?.name} (${aiId}); allowlist=[${ALLOW.join(",")}]`);

const chatReader = new ChatHistoryReader({
  read: query => session.doc("get", "ChatMessage", { query }),
  filterMode: CHAT_FILTER_MODE,
  resyncMs: CHAT_RESYNC_MS,
  lookbackMs: CHAT_LOOKBACK_MS
});

const bridge = new FoundryMessageBridge({
  aiId,
  usersById,
  allowedSenders: ALLOW,
  stateFile: STATE_FILE,
  resetMs: RESET_MS,
  resetMsgs: RESET_MSGS,
  maxReply: MAX_REPLY,
  maxConcurrent: MAX_CONCURRENT,
  ask: askOpencode,
  fetchMessages: failedSince => chatReader.fetch(failedSince),
  sendReply: (toId, html) => session.doc("create", "ChatMessage", {
    data: [{ author: aiId, content: String(html).trim(), speaker: { alias: "AI" }, whisper: [toId] }],
    modifiedTime: Date.now()
  })
});

await bridge.initialize();

let stopping = false;
let timer = null;
let closing = null;
function closeSession() {
  if (!closing) {
    closing = Promise.resolve().then(() => session.close?.()).catch(error => {
      console.error("[agent] error closing Foundry session", error);
    });
  }
  return closing;
}

async function loop() {
  timer = null;
  try {
    await bridge.poll();
  } catch (error) {
    console.error("[agent] polling failed; retrying next cycle", error);
  }
  if (stopping) {
    await bridge.waitForIdle();
    await closeSession();
  }
  else timer = setTimeout(loop, POLL_MS);
}

function shutdown() {
  stopping = true;
  if (timer) {
    clearTimeout(timer);
    timer = null;
    void bridge.waitForIdle().then(closeSession);
  }
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
void loop();
