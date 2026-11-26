// OpenCode V2 CLI contract. V1 is deliberately unsupported.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export function parseOpencodeVersion(output) {
  const value = String(output || "").trim();
  const match = /(?:^|\s)v?(\d+)\.(\d+)\.(\d+)(?:[-+][a-z0-9.-]+)?(?:\s|$)/i.exec(value);
  if (!match) throw new Error("Could not parse the installed OpenCode version");
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]),
    version: `${match[1]}.${match[2]}.${match[3]}` };
}

export async function checkOpencodeVersion(binary = "opencode", { invoke = exec, env } = {}) {
  if (typeof binary !== "string" || !binary.trim()) throw new Error("OpenCode executable is not configured");
  const { stdout } = await invoke(binary, ["--version"],
    { timeout: 10000, maxBuffer: 16384, ...(env ? { env } : {}) });
  const info = parseOpencodeVersion(stdout);
  if (info.major !== 2) {
    throw new Error(`OpenCode ${info.version} found; this release requires OpenCode V2.x. ` +
      "See docs/OPENCODE_V2.md (breaking change; no V1 session migration).");
  }
  return info;
}

export function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

export function opencodeRunCommand({ binary = "opencode", prompt, sessionId,
  standalone = false, agent } = {}) {
  if (typeof binary !== "string" || !binary.trim()) throw new Error("Missing OpenCode executable");
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("Missing OpenCode prompt");
  if (sessionId !== undefined && sessionId !== null &&
      (typeof sessionId !== "string" || !/^ses_[a-z0-9_-]{3,128}$/i.test(sessionId))) {
    throw new Error("Malformed persisted OpenCode session ID");
  }
  if (agent !== undefined && (typeof agent !== "string" || !/^[a-z][a-z0-9-]*$/.test(agent))) {
    throw new Error("Malformed OpenCode agent name");
  }
  const args = [binary];
  if (standalone) args.push("--standalone");
  args.push("run", "--format", "json");
  if (agent) args.push("--agent", agent);
  if (sessionId) args.push("--session", sessionId);
  args.push(prompt);
  return args.map(shellQuote).join(" ");
}
