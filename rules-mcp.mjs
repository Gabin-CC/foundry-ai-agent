// Local stdio MCP server. Never writes to Foundry; reads the pinned official
// English SRD 5.2.1 and optional user-supplied local rule PDFs.
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { listRuleSources, loadRules, readRulePage, searchRules } from "./lib/rules.mjs";
import { loadAccessPolicy, parseRulesAccessRole, visibleRulesIndex } from "./lib/rules-access.mjs";

const indexPath = process.env.RULES_INDEX_PATH || join(process.cwd(), ".rules", "srd-5.2.1.json");
const accessPath = process.env.RULES_ACCESS_FILE || join(process.cwd(), "rules-private", "access.json");
const role = parseRulesAccessRole(process.env.RULES_ACCESS_ROLE);
const PAGE_WINDOW_CHARS = 6000;
const metricsEnabled = process.env.RULES_SEARCH_METRICS === "1";
const reportMetrics = (operation, started, resultCount, characters) => {
  if (metricsEnabled) console.error(`[rules-mcp] ${operation} ${Math.round(performance.now() - started)}ms, ${resultCount} results, ${characters} chars`);
};
let cache;
let visibleCache;

async function index() {
  // Only cache successful reads: a missing index can be created while the
  // process is running and a subsequent tool call can recover immediately.
  if (!cache) cache = await loadRules(indexPath);
  return cache;
}

async function permittedCorpus() {
  // Check only the small local policy on every call. Reuse the same filtered
  // view and its compiled search dictionary until the classification changes.
  const policy = await loadAccessPolicy(accessPath);
  const revision = JSON.stringify([...policy.rules_for_all].sort());
  if (!visibleCache || visibleCache.revision !== revision) {
    visibleCache = { revision,
      index: visibleRulesIndex(await index(), policy, role),
      preferredSources: ["srd", ...policy.rules_for_all] };
  }
  return visibleCache;
}

const server = new McpServer({ name: "dnd-2024-rules", version: "0.1.0" });
const errorResult = error => ({
  isError: true,
  content: [{ type: "text", text: `Rules index unavailable: ${error.message}. Run npm run rules:setup. Do not guess a rule.` }]
});

server.registerTool("list_rule_sources", {
  description: "List locally indexed rule sources: the verifiable official English SRD 5.2.1 plus optional user-provided PDFs. User-provided PDF titles do not prove they are official or D&D 2024.",
  inputSchema: {},
  annotations: { readOnlyHint: true, openWorldHint: false }
}, async () => {
  try { const corpus = await permittedCorpus();
    return { content: [{ type: "text", text: JSON.stringify(listRuleSources(corpus.index)) }] }; }
  catch (error) { return errorResult(error); }
});

server.registerTool("search_rules", {
  description: "Search English rules in official D&D 2024 SRD 5.2.1 plus user-provided local PDF rulebooks; returns actual PDF page numbers, source names, excerpts, and links for official SRD pages. Search BEFORE answering a rules question in any language. Verify user-provided edition. No relevant passage means no verified answer.",
  inputSchema: {
    query: z.string().min(2).max(500).describe("English rule terms, e.g. 'grappled condition' or 'opportunity attack'"),
    source: z.string().default("all").describe("'all', 'srd', or one PDF filename returned by list_rule_sources"),
    limit: z.number().int().min(1).max(8).default(4)
  },
  annotations: { readOnlyHint: true, openWorldHint: false }
}, async ({ query, source, limit }) => {
  try {
    const started = performance.now();
    const corpus = await permittedCorpus();
    const matches = searchRules(corpus.index, query, { source, limit,
      preferredSources: corpus.preferredSources });
    const output = matches.length
      ? JSON.stringify(matches)
      : "No matching passage in the indexed sources. This does NOT mean the rule does not exist; do not invent an answer or citation.";
    reportMetrics("search", started, matches.length, output.length);
    return { content: [{ type: "text", text: output }] };
  } catch (error) { return errorResult(error); }
});

server.registerTool("read_rule_page", {
  description: "Read an exact PDF page in bounded 6000-character windows. Specify source_id from search_rules; if next_offset is present, call again with offset to continue. User PDFs have no public web URL; cite filename and PDF page.",
  inputSchema: { page: z.number().int().min(1), source: z.string().default("srd"),
    offset: z.number().int().min(0).default(0) },
  annotations: { readOnlyHint: true, openWorldHint: false }
}, async ({ page, source, offset }) => {
  try {
    const started = performance.now();
    const result = readRulePage((await permittedCorpus()).index, page, source);
    const end = result ? Math.min(result.text.length, offset + PAGE_WINDOW_CHARS) : 0;
    const visible = result && offset < result.text.length
      ? { ...result, text: result.text.slice(offset, end),
        total_characters: result.text.length,
        next_offset: end < result.text.length ? end : null } : null;
    const output = visible ? JSON.stringify(visible)
      : "Page unavailable for that source in the rules index; do not cite it.";
    reportMetrics("read-page", started, visible ? 1 : 0, output.length);
    return { content: [{ type: "text", text: output }] };
  } catch (error) { return errorResult(error); }
});

await server.connect(new StdioServerTransport());
