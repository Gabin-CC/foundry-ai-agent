// Local stdio MCP server. Never writes to Foundry; reads the pinned official
// English SRD 5.2.1 and optional user-supplied local rule PDFs.
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { listRuleSources, loadRules, readRulePage, searchRules } from "./lib/rules.mjs";

const indexPath = process.env.RULES_INDEX_PATH || join(process.cwd(), ".rules", "srd-5.2.1.json");
let cache;

async function index() {
  // Only cache successful reads: a missing index can be created while the
  // process is running and a subsequent tool call can recover immediately.
  if (!cache) cache = await loadRules(indexPath);
  return cache;
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
  try { return { content: [{ type: "text", text: JSON.stringify(listRuleSources(await index())) }] }; }
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
    const matches = searchRules(await index(), query, { source, limit });
    return { content: [{ type: "text", text: matches.length
      ? JSON.stringify(matches)
      : "No matching passage in the indexed sources. This does NOT mean the rule does not exist; do not invent an answer or citation." }] };
  } catch (error) { return errorResult(error); }
});

server.registerTool("read_rule_page", {
  description: "Read the exact page from a source returned by search_rules; specify the source_id from the result. User PDFs have no public web URL; cite filename and PDF page.",
  inputSchema: { page: z.number().int().min(1), source: z.string().default("srd") },
  annotations: { readOnlyHint: true, openWorldHint: false }
}, async ({ page, source }) => {
  try {
    const result = readRulePage(await index(), page, source);
    return { content: [{ type: "text", text: result ? JSON.stringify(result)
      : "Page unavailable for that source in the rules index; do not cite it." }] };
  } catch (error) { return errorResult(error); }
});

await server.connect(new StdioServerTransport());
