// Pont chat Foundry -> opencode (agent IA MJ public).
// Écoute les chuchotements adressés au compte AI, invoque opencode (via MCP),
// et répond en whisper privé. Un fil de conversation par interlocuteur, reset
// après inactivité ou nombre de messages.
//
// Voir README.md pour la configuration (tout se pilote par variables d'env).
import { FoundrySession } from "@foundry-vtt-mcp/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const env = process.env;

const AI_USER = env.AI_USER || "AI";
const AI_PASS = env.AI_PASSWORD || "";
const ADMIN_PASS = env.ADMIN_PASSWORD || "";
// Expéditeurs autorisés (ids Foundry, séparés par des virgules). Vide = tout le monde.
const ALLOW = (env.ALLOWED_SENDERS || "").split(",").map(s => s.trim()).filter(Boolean);
const OPENCODE = env.OPENCODE_BIN || "opencode";
const AGENT_DIR = env.AGENT_DIR || process.cwd();
const POLL_MS = Number(env.POLL_MS || 3000);
const MAX_REPLY = Number(env.MAX_REPLY || 4000);
const RESET_MS = Number(env.RESET_MS || 86400000);   // 24 h d'inactivité
const RESET_MSGS = Number(env.RESET_MSGS || 1000);   // 1000 messages max par fil

const run = promisify(execFile);
const strip = s => String(s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

const session = await FoundrySession.login(AI_USER, AI_PASS, { adminPassword: ADMIN_PASS });
if (!session) { console.error(`[agent] login ${AI_USER} impossible`); process.exit(1); }
const aiId = session.userId;

// Table des utilisateurs -> id -> {name, role}
const users = await session.doc("get", "User", { query: {} }).catch(() => []);
const byId = {};
for (const u of users) byId[u._id] = { name: u.name, role: u.role };
const roleLabel = r => r === 4 ? "MJ (propriétaire)" : r === 3 ? "assistant MJ" : "joueur";

const seen = new Set();
try { const ex = await session.doc("get", "ChatMessage", { query: {} }); (ex || []).forEach(m => seen.add(m._id)); } catch {}
console.error(`[agent] connecté ${session.user?.name} (${aiId}); allowlist=[${ALLOW.join(",")}]; seen=${seen.size}`);

// Fils de conversation par auteur : Map<author, {id, last, count}>
const threads = new Map();

const reply = async (toId, html) => {
  try {
    await session.doc("create", "ChatMessage", {
      data: [{ author: aiId, content: String(html).trim(), speaker: { alias: "AI" }, whisper: [toId] }],
      modifiedTime: Date.now()
    });
  } catch (e) { console.error("reply err", e); }
};

// Lance opencode (via un pty : opencode l'exige) et renvoie {sessionID, text}.
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
    console.error(`[agent] prompt de ${info.name} (${roleLabel(info.role)}): ${text.slice(0, 120)}`);

    // Gestion du fil + reset
    let th = threads.get(sender);
    const now = Date.now();
    if (th && (now - th.last > RESET_MS || th.count >= RESET_MSGS)) {
      console.error(`[agent] reset fil de ${info.name} (inactivité=${Math.round((now - th.last) / 1000)}s, msgs=${th.count})`);
      th = null;
    }
    const prompt = `[Interlocuteur: ${info.name} — rôle: ${roleLabel(info.role)}]\n${text}`;

    let out = "", sid = th?.id;
    try {
      const res = await askOpencode(prompt, sid);
      out = res.text; sid = res.sessionID;
    } catch (e) {
      console.error("[agent] opencode ÉCHEC code=" + e.code + " stderr=" + String(e.stderr || "").slice(0, 300));
      out = "<p>Erreur opencode: " + String(e.stderr || e.message || "").replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])).slice(0, 300) + "</p>";
    }

    threads.set(sender, { id: sid, last: now, count: th ? th.count + 1 : 1 });
    if (sender) {
      await reply(sender, out.slice(0, MAX_REPLY) || "<p>(aucune sortie)</p>");
      console.error(`[agent] réponse en whisper -> ${info.name} (session=${sid})`);
    }
  }
}

setInterval(tick, POLL_MS);
process.on("SIGTERM", () => { session.close?.(); process.exit(0); });