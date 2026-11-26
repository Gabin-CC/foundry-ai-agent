// Purpose-built OpenCode runner for SRD-only model evaluation. Do not import
// Foundry client code, the production OpenCode config, or any .env files here.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseOpencodeEvents } from "./opencode-events.mjs";
import { validateIndex } from "./rules.mjs";

const ALLOWED_TOOLS = new Set([
  "rules_list_rule_sources", "rules_search_rules", "rules_read_rule_page"
]);

export const EVALUATION_INSTRUCTIONS = `You are evaluating D&D 2024 rules with NO Foundry world and NO private books.
Only the official English SRD 5.2.1 is accessible. Do not use 2014 editions,
other rulebooks, house rules, remembered page numbers, or outside knowledge as
evidence. For EVERY question, search the SRD with rules_search_rules first,
using English terms even for French questions. Read a matching rule page when
more context is needed. Cite the actual source and PDF page consulted, using
the exact official PDF link returned by the rules tool. Answer in the language
of the question, in concise Foundry-compatible HTML, without Markdown.
If a rule cannot be supported by the indexed SRD, explicitly say so, without
inventing a ruling or a citation. Never pretend this is the complete PHB.
Do not contact Foundry, modify data, run code, or use any tool except the three
read-only rules tools. Each question is a fresh, independent benchmark case.`;

export function validateOpenRouterModel(model) {
  if (typeof model !== "string" || model.length > 180 ||
      !/^openrouter\/[a-z0-9][a-z0-9./:_-]*$/i.test(model)) {
    throw new Error("--model must be an OpenRouter model ID, e.g. openrouter/anthropic/claude-3.7-sonnet");
  }
  return model;
}

export function officialOnlyIndex(index) {
  validateIndex(index);
  const pages = index.pages.filter(page => page.source === "srd");
  if (!pages.length) throw new Error("The rules index does not contain official SRD pages");
  return { version: index.version, pdf_sha256: index.pdf_sha256,
    private_sources: [], pages };
}

function policy(action, resource, effect) { return { action, resource, effect }; }

export function isolatedOpenCodeConfig({ model, rulesMcpPath, indexPath, workspace }) {
  validateOpenRouterModel(model);
  if (![rulesMcpPath, indexPath, workspace].every(item => typeof item === "string" && item.startsWith("/"))) {
    throw new Error("Isolated OpenCode paths must be absolute");
  }
  const permissions = [policy("*", "*", "deny"),
    ...[...ALLOWED_TOOLS].map(tool => policy(tool, "*", "allow"))];
  return {
    $schema: "https://opencode.ai/config.json",
    model, default_agent: "rules-eval", update: "disable", snapshots: false,
    instructions: ["AGENTS.md"],
    // Support OpenRouter IDs not yet listed in OpenCode's model catalog,
    // including the repository's existing pinned free-model example.
    providers: { openrouter: { models: {
      [model.slice("openrouter/".length)]: { limit: { output: 500 } }
    } } },
    agents: { "rules-eval": {
      description: "Read-only official D&D 2024 SRD evaluation",
      mode: "primary", system: EVALUATION_INSTRUCTIONS, permissions
    } },
    permissions,
    policies: [
      policy("provider.use", "*", "deny"), policy("provider.use", "openrouter", "allow"),
      policy("mcp.use", "*", "deny"), policy("mcp.use", "rules", "allow"),
      policy("skill.use", "*", "deny"), policy("plugin.use", "*", "deny"),
      policy("websearch.use", "*", "deny"),
      policy("tool.use", "*", "deny"),
      ...[...ALLOWED_TOOLS].map(tool => policy("tool.use", `${tool}:*`, "allow"))
    ],
    mcp: { servers: { rules: {
      type: "local", command: [process.execPath, rulesMcpPath],
      cwd: workspace, codemode: false,
      environment: { RULES_INDEX_PATH: indexPath }
    } } }
  };
}

export function isolatedProcessEnv({ root, providerKey, path = process.env.PATH }) {
  if (!root || !root.startsWith("/")) throw new Error("An absolute temporary root is required");
  if (typeof providerKey !== "string" || !providerKey.trim()) {
    throw new Error("OPENROUTER_API_KEY must be exported explicitly; .env is never loaded");
  }
  return {
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_STATE_HOME: join(root, "state"),
    PATH: path || "/usr/bin:/bin", LANG: "C.UTF-8", TERM: "dumb", CI: "1",
    OPENROUTER_API_KEY: providerKey
  };
}

export async function createIsolatedRulesWorkspace({ index, model, rulesMcpPath }) {
  const root = await mkdtemp(join(tmpdir(), "foundry-srd-eval-"));
  try {
    const workspace = join(root, "workspace");
    const indexPath = join(root, "srd-only.json");
    for (const name of ["workspace", "home", "config", "data", "cache", "state"]) {
      await mkdir(join(root, name), { mode: 0o700 });
    }
    const config = isolatedOpenCodeConfig({ model, rulesMcpPath, indexPath, workspace });
    await Promise.all([
      writeFile(indexPath, JSON.stringify(officialOnlyIndex(index)), { mode: 0o600 }),
      writeFile(join(workspace, "opencode.json"), JSON.stringify(config, null, 2), { mode: 0o600 }),
      writeFile(join(workspace, "AGENTS.md"), EVALUATION_INSTRUCTIONS, { mode: 0o600 })
    ]);
    return { root, workspace, indexPath, config,
      cleanup: () => rm(root, { recursive: true, force: true }) };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

function forbiddenToolEvent(event) {
  return event?.type === "tool_use" && event.part?.type === "tool" &&
    !ALLOWED_TOOLS.has(event.part?.tool);
}

export function checkRuleToolTrace(raw) {
  for (const line of String(raw).split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (forbiddenToolEvent(event)) {
      throw new Error(`Forbidden OpenCode tool in evaluation: ${String(event.part.tool).slice(0, 120)}`);
    }
  }
  return parseOpencodeEvents(raw);
}

export async function runIsolatedQuestion({ binary = "opencode", model, workspace, env,
  question, timeoutMs = 180000 }) {
  validateOpenRouterModel(model);
  if (typeof question !== "string" || !question.trim()) throw new Error("Missing evaluation question");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000) {
    throw new Error("Invalid per-question timeout");
  }
  const args = ["run", "--format", "json",
    "--agent", "rules-eval", "--model", model, question];
  const raw = await new Promise((resolve, reject) => {
    let stdout = "", stderr = "", invalidTool = null, timedOut = false, overflow = false;
    let pending = "";
    const child = spawn(binary, args, { cwd: workspace, env, stdio: ["ignore", "pipe", "pipe"], shell: false });
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.stdout.on("data", chunk => {
      stdout += chunk.toString("utf8");
      pending += chunk.toString("utf8");
      if (stdout.length > 16 * 1024 * 1024) { overflow = true; child.kill("SIGKILL"); }
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) {
        if (!line.trim().startsWith("{")) continue;
        try { if (forbiddenToolEvent(JSON.parse(line))) { invalidTool = true; child.kill("SIGKILL"); } }
        catch { /* Non-JSON progress lines are ignored. */ }
      }
    });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString("utf8")).slice(-4096); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => {
      clearTimeout(timer);
      if (invalidTool) reject(new Error("OpenCode attempted a forbidden tool; evaluation aborted"));
      else if (overflow) reject(new Error("OpenCode output exceeded 16 MiB"));
      else if (timedOut) reject(new Error("OpenCode evaluation timed out"));
      else if (code !== 0) reject(new Error(`OpenCode exited with status ${code}; check local OpenCode/provider configuration`));
      else resolve(stdout);
    });
  });
  const parsed = checkRuleToolTrace(raw);
  if (!parsed.text) throw new Error("OpenCode returned no final HTML reply");
  return { reply: parsed.text, toolCalls: parsed.ruleCalls };
}
