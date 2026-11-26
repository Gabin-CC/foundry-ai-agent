#!/usr/bin/env node
// Opt-in OpenCode model evaluation. Runs with a temporary SRD-only MCP,
// no Foundry credentials/configuration, and no production session state.
import { open, readFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { validateRuleSuite } from "../lib/rules-eval.mjs";
import { checkOpencodeVersion } from "../lib/opencode-cli.mjs";
import { loadRules } from "../lib/rules.mjs";
import { createIsolatedRulesWorkspace, isolatedProcessEnv,
  runIsolatedQuestion, validateOpenRouterModel } from "../lib/rules-live-eval.mjs";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const usage = `Usage:
  npm run eval:rules:live -- --dry-run --model openrouter/provider/model
  npm run eval:rules:live -- --execute --model openrouter/provider/model --output .rules/live-results.jsonl [--limit 1]

--dry-run          Validate the SRD-only setup without invoking OpenCode/provider.
--execute          Explicitly authorize model calls (may incur provider charges).
--model ID         OpenRouter model used by OpenCode; required for both modes.
--output FILE      New JSONL output path; never overwrites an existing file.
--index FILE       Official SRD index; defaults to .rules/srd-5.2.1.json.
--case ID          Run one benchmark case by ID.
--limit NUMBER     Run only the first N cases (1-13); cannot combine with --case.
--timeout-ms N     Per-case timeout, default 180000 (max 600000).
--binary PATH      OpenCode executable (defaults to opencode; useful for testing).
`;

function argsOf(argv) {
  const options = { index: join(project, ".rules", "srd-5.2.1.json"), binary: "opencode",
    timeoutMs: 180000 };
  const values = new Set(["--model", "--output", "--index", "--case", "--limit", "--timeout-ms", "--binary"]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (values.has(arg)) {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`${arg} needs a value`);
      options[arg.slice(2)] = argv[++i];
    } else if (["--dry-run", "--execute", "--help"].includes(arg)) options[arg.slice(2)] = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.help) return options;
  if (Boolean(options["dry-run"]) === Boolean(options.execute)) {
    throw new Error("Choose exactly one of --dry-run or --execute");
  }
  validateOpenRouterModel(options.model);
  if (options.execute && !options.output) throw new Error("--execute requires --output FILE");
  if (options["dry-run"] && options.output) throw new Error("--dry-run does not write an output file");
  if (options.case && options.limit) throw new Error("Use --case or --limit, not both");
  if (options.limit !== undefined && (!/^[1-9]\d*$/.test(options.limit) || !Number.isSafeInteger(Number(options.limit)))) {
    throw new Error("--limit must be a positive integer");
  }
  if (options["timeout-ms"] !== undefined) options.timeoutMs = Number(options["timeout-ms"]);
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1000 || options.timeoutMs > 600000) {
    throw new Error("--timeout-ms must be between 1000 and 600000");
  }
  return options;
}

async function main(argv) {
  const options = argsOf(argv);
  if (options.help) { process.stdout.write(usage); return; }
  const suite = JSON.parse(await readFile(join(project, "eval", "rules-2024-srd.json"), "utf8"));
  if (options.limit && Number(options.limit) > suite.cases.length) {
    throw new Error(`--limit cannot exceed the ${suite.cases.length} available cases`);
  }
  const index = await loadRules(resolve(options.index));
  validateRuleSuite(suite, index);
  let cases = suite.cases;
  if (options.case) {
    cases = cases.filter(item => item.id === options.case);
    if (!cases.length) throw new Error(`Unknown benchmark case: ${options.case}`);
  } else if (options.limit) cases = cases.slice(0, Number(options.limit));

  const isolated = await createIsolatedRulesWorkspace({ index, model: options.model,
    rulesMcpPath: join(project, "rules-mcp.mjs") });
  try {
    if (options["dry-run"]) {
      process.stdout.write(JSON.stringify({ mode: "dry-run", model: options.model,
        cases: cases.map(item => item.id), source: "official English SRD 5.2.1 only",
        indexedPages: index.pages.filter(page => page.source === "srd").length,
        mcpServers: Object.keys(isolated.config.mcp.servers),
        toolsAllowed: ["rules_list_rule_sources", "rules_search_rules", "rules_read_rule_page"],
        providerCredentials: "not loaded", foundry: "unavailable", gameWrites: "denied"
      }, null, 2) + "\n");
      return;
    }
    const env = isolatedProcessEnv({ root: isolated.root,
      providerKey: process.env.OPENROUTER_API_KEY });
    // Abort with an actionable V2-only error before creating a result file.
    await checkOpencodeVersion(options.binary, { env });
    const output = resolve(options.output);
    if (output.startsWith(project + sep) && !output.startsWith(join(project, ".rules") + sep)) {
      throw new Error("Write benchmark responses under .rules/ (gitignored) or outside the repository");
    }
    const handle = await open(output, "wx", 0o600);
    try {
      for (const [i, item] of cases.entries()) {
        process.stderr.write(`[rules-eval] ${i + 1}/${cases.length}: ${item.id}\n`);
        const result = await runIsolatedQuestion({ binary: options.binary, model: options.model,
          workspace: isolated.workspace, env, question: item.question, timeoutMs: options.timeoutMs });
        await handle.writeFile(JSON.stringify({ id: item.id, reply: result.reply,
          toolCalls: result.toolCalls }) + "\n");
      }
    } finally { await handle.close(); }
    process.stdout.write(`Recorded ${cases.length} real model replies in ${output}.\n` +
      `Next: npm run eval:rules -- --responses "${output}"\n` +
      "Human validation is still required to confirm semantic correctness.\n");
  } finally {
    await isolated.cleanup();
  }
}

main(process.argv.slice(2)).catch(error => {
  process.stderr.write(`[rules-eval] ${error.message}\n\n${usage}`);
  process.exitCode = 1;
});
