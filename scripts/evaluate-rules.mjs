#!/usr/bin/env node
// Explicit, offline-only evaluation: no OpenCode invocation and no Foundry MCP.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateRuleSuite } from "../lib/rules-eval.mjs";
import { RULES_INDEX_FILENAME, loadRules } from "../lib/rules.mjs";

const usage = `Usage:
  npm run eval:rules -- --prompts
  npm run eval:rules -- --responses path/to/replies.jsonl [--index path/to/index.json] [--json] [--require-reviewed]

--prompts          Print JSON Lines of isolated SRD-only questions (no model calls).
--responses FILE   Grade existing HTML replies; accepts JSON array or JSON Lines.
--index FILE       Indexed corpus; defaults to .rules/rules-index.json.
--json             Machine-readable results (does not include reply text).
--require-reviewed Exit non-zero unless every case is human-reviewed and evidence is complete.
`;

function parseArguments(argv) {
  const options = { index: join(process.cwd(), ".rules", RULES_INDEX_FILENAME) };
  const argumentsWithValues = new Set(["--index", "--responses"]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (argumentsWithValues.has(arg)) {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2)] = argv[++i];
    } else if (["--prompts", "--json", "--require-reviewed", "--help"].includes(arg)) {
      options[arg.slice(2)] = true;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.prompts === Boolean(options.responses) && !options.help) {
    throw new Error("Choose exactly one of --prompts or --responses FILE");
  }
  return options;
}

function readJsonLines(content) {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("Response file is empty");
  if (trimmed.startsWith("[")) return JSON.parse(trimmed);
  return trimmed.split(/\r?\n/).map((line, i) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`Invalid JSON on response line ${i + 1}: ${error.message}`); }
  });
}

async function main(argv) {
  const options = parseArguments(argv);
  if (options.help) { process.stdout.write(usage); return; }
  const suite = JSON.parse(await readFile(join(dirname(fileURLToPath(import.meta.url)), "..", "eval", "rules-2024-srd.json"), "utf8"));
  if (options.prompts) {
    for (const item of suite.cases) process.stdout.write(JSON.stringify({
      id: item.id, question: item.question,
      instruction: "Use only the official English SRD 5.2.1 indexed rules. Search a source for this question. Answer in the question's language as Foundry-compatible HTML, cite exact PDF pages actually consulted; if unsupported, say so without inventing any ruling or citation. Do not access Foundry or change game state."
    }) + "\n");
    return;
  }
  const [responsesText, index] = await Promise.all([
    readFile(options.responses, "utf8"), loadRules(options.index)
  ]);
  const report = evaluateRuleSuite(suite, readJsonLines(responsesText), index);
  if (options.json) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  else {
    for (const result of report.results) {
      const failed = result.smoke && !result.smoke.pass
        ? ` (missed: ${result.smoke.missed.join(", ") || "none"}; red flags: ${result.smoke.redFlags.join(", ") || "none"})` : "";
      process.stdout.write(`${result.status.padEnd(16)} ${result.id}${failed}\n`);
      if (result.citation && result.citation !== "gold-page" && result.citation !== "none-expected") {
        process.stdout.write(`  citation: ${result.citation}\n`);
      }
      if (result.evidence === "not-provided") process.stdout.write("  source lookup trace not provided\n");
    }
    const s = report.summary;
    process.stdout.write(`\n${s.answered}/${s.cases} replies; ${s.smokePassed} pattern smoke passes; ` +
      `${s.goldCitations} exact gold-page citations; ${s.provenanceVerified} verified tool traces.\n`);
    process.stdout.write(`Human review: ${s.human.correct} correct, ${s.human.incorrect} incorrect, ` +
      `${s.human.uncertain} uncertain, ${s.human.unreviewed} unreviewed.\n`);
    process.stdout.write("Pattern matches and citations are NOT proof of semantic correctness. Review each answer against its gold reference.\n");
  }
  if (report.summary.failed || (options["require-reviewed"] &&
    report.summary.reviewedCorrect !== report.summary.cases)) process.exitCode = 1;
}

main(process.argv.slice(2)).catch(error => {
  process.stderr.write(`Rules evaluation error: ${error.message}\n\n${usage}`);
  process.exitCode = 2;
});
