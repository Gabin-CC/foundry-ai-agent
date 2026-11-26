// Foundry chat -> OpenCode bridge (shared AI Assistant GM).
// Listens for whispers to the dedicated account, asks OpenCode through MCP,
// and replies privately. One conversation per sender, reset after inactivity
// or a configurable number of messages.
//
// See README.md for environment-based configuration.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Module exporting FoundrySession. Defaults to the npm package; deployments
// with a local MCP server may set FOUNDRY_MCP_MODULE to its module file path.
const { FoundrySession } = await import(process.env.FOUNDRY_MCP_MODULE || "foundry-vtt-mcp-server");

const env = process.env;

const AI_USER = env.AI_USER || "AI";
const AI_PASS = env.AI_PASSWORD || "";
const ADMIN_PASS = env.ADMIN_PASSWORD || "";
// Comma-separated Foundry user IDs. An empty list allows all players.
const ALLOW = (env.ALLOWED_SENDERS || "").split(",").map(s => s.trim()).filter(Boolean);
const OPENCODE = env.OPENCODE_BIN || "opencode";
const AGENT_DIR = env.AGENT_DIR || process.cwd();
const POLL_MS = Number(env.POLL_MS || 3000);
const MAX_REPLY = Number(env.MAX_REPLY || 4000);
const RESET_MS = Number(env.RESET_MS || 86400000);   // 24 hours of inactivity
const RESET_MSGS = Number(env.RESET_MSGS || 1000);   // 1,000 messages per thread

const run = promisify(execFile);
const strip = s => String(s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

const session = await FoundrySession.login(AI_USER, AI_PASS, { adminPassword: ADMIN_PASS });
if (!session) { console.error(`[agent] could not log in as ${AI_USER}`); process.exit(1); }
const aiId = session.userId;

// Foundry users, indexed by ID: { name, role }.
const users = await session.doc("get", "User", { query: {} }).catch(() => []);
const byId = {};
for (const u of users) byId[u._id] = { name: u.name, role: u.role };
const roleLabel = r => r === 4 ? "GM (owner)" : r === 3 ? "Assistant GM" : "player";

const seen = new Set();
try { const ex = await session.doc("get", "ChatMessage", { query: {} }); (ex || []).forEach(m => seen.add(m._id)); } catch {}
console.error(`[agent] connected as ${session.user?.name} (${aiId}); allowlist=[${ALLOW.join(",")}]; seen=${seen.size}`);

// Conversations by sender: Map<sender, { id, last, count }>.
const threads = new Map();

const reply = async (toId, html) => {
  try {
    await session.doc("create", "ChatMessage", {
      data: [{ author: aiId, content: String(html).trim(), speaker: { alias: "AI" }, whisper: [toId] }],
      modifiedTime: Date.now()
    });
  } catch (e) { console.error("reply error", e); }
};

// Run OpenCode in a PTY for compatibility; return { sessionID, text }.
async function askOpencode(prompt, sessionId) {
  const q = prompt.replace(/'/g, "'\\''");
  const sessArg = sessionId ? `--session ${sessionId} ` : "";
  const cmd = `${OPENCODE} run --format json ${sessArg}'${q}'`;
  const r = await run("script", ["-q", "-e", "-c", cmd, "/dev/null"],
    { cwd: AGENT_DIR, maxBuffer: 16 * 1024 * 1024, timeout: 120000 });
  const raw = String(r.stdout || "").replace(/\x1b\[[0-9;]*m/g, "");
  let sid = sessionId, text = "";
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const ev = JSON.parse(t);
      if (ev.sessionID && !sid) sid = ev.sessionID;
      if (ev.type === "text" && ev.part?.text) text += ev.part.text;
    } catch {}
  }
  return { sessionID: sid, text: text.trim() };
}

async function tick() {
  let msgs;
  try { msgs = await session.doc("get", "ChatMessage", { query: {} }); } catch { return; }
  for (const m of (msgs || [])) {
    if (seen.has(m._id)) continue;
    seen.add(m._id);
    if (!(m.whisper || []).includes(aiId)) continue;
    const sender = m.author || m.user?._id || m.user;
    if (ALLOW.length && !ALLOW.includes(sender)) continue;
    const text = strip(m.content);
    if (!text) continue;

    const info = byId[sender] || { name: "?", role: 2 };
    console.error(`[agent] message from ${info.name} (${roleLabel(info.role)}): ${text.slice(0, 120)}`);

    // Retrieve the sender's conversation and reset it if needed.
    let th = threads.get(sender);
    const now = Date.now();
    if (th && (now - th.last > RESET_MS || th.count >= RESET_MSGS)) {
      console.error(`[agent] reset conversation for ${info.name} (idle=${Math.round((now - th.last) / 1000)}s, messages=${th.count})`);
      th = null;
    }
    const prompt = `[Sender: ${info.name} — role: ${roleLabel(info.role)}]\n${text}`;

    let out = "", sid = th?.id;
    try {
      const res = await askOpencode(prompt, sid);
      out = res.text; sid = res.sessionID;
    } catch (e) {
      console.error("[agent] OpenCode failed code=" + e.code + " stderr=" + String(e.stderr || "").slice(0, 300));
      out = "<p>OpenCode error: " + String(e.stderr || e.message || "").replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])).slice(0, 300) + "</p>";
    }

    threads.set(sender, { id: sid, last: now, count: th ? th.count + 1 : 1 });
    if (sender) {
      await reply(sender, out.slice(0, MAX_REPLY) || "<p>(no output)</p>");
      console.error(`[agent] private reply -> ${info.name} (session=${sid})`);
    }
  }
}

setInterval(tick, POLL_MS);
process.on("SIGTERM", () => { session.close?.(); process.exit(0); });
