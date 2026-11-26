// Foundry chat -> OpenCode bridge (shared AI Assistant GM).
// See README.md for configuration and checkpoint/restart behavior.
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { FoundryMessageBridge } from "./lib/bridge.mjs";
import { ChatHistoryReader } from "./lib/chat-reader.mjs";
import { loadFoundrySession } from "./lib/foundry-module.mjs";
import { parseOpencodeEvents } from "./lib/opencode-events.mjs";
import { checkOpencodeVersion, opencodeRunCommand } from "./lib/opencode-cli.mjs";
import { createRulesReplyGuard } from "./lib/rules-guard.mjs";

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
const RULES_CITATION_MODE = env.RULES_CITATION_MODE || "enforce";
const RULES_INDEX_PATH = env.RULES_INDEX_PATH || join(AGENT_DIR, ".rules", "srd-5.2.1.json");

const run = promisify(execFile);

// Refuse unsupported OpenCode versions before logging in to Foundry. The
// bridge intentionally cannot run on V1 or adopt a V1 session ID.
const info = await checkOpencodeVersion(OPENCODE);
console.error(`[agent] verified OpenCode ${info.version} (V2 only)`);

// Foundry client from the pinned MCP source, or a configured local module.
const FoundrySession = await loadFoundrySession(env.FOUNDRY_MCP_MODULE);

// The OpenCode V2 CLI emits newline-delimited JSON inside this PTY.
async function askOpencode(prompt, sessionId) {
  const command = opencodeRunCommand({ binary: OPENCODE, prompt, sessionId });
  const result = await run("script", ["-q", "-e", "-c", command, "/dev/null"],
    { cwd: AGENT_DIR, maxBuffer: 16 * 1024 * 1024, timeout: 120000 });
  const raw = String(result.stdout || "").replace(/\x1b\[[0-9;]*m/g, "");
  const parsed = parseOpencodeEvents(raw, sessionId);
  if (!parsed.text || !parsed.sessionID) {
    throw new Error("OpenCode V2 returned an incomplete result; retry after checking model and session state");
  }
  return parsed;
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
  replyGuard: createRulesReplyGuard({ indexPath: RULES_INDEX_PATH, mode: RULES_CITATION_MODE }),
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
