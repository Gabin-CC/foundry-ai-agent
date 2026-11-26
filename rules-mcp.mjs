// Local stdio MCP server. Never writes to Foundry; reads only an indexed,
// version-pinned English copy of the official CC-BY-4.0 SRD 5.2.1.
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { loadRules, readRulePage, searchRules } from "./lib/rules.mjs";

const indexPath = process.env.RULES_INDEX_PATH || join(process.cwd(), ".rules", "srd-5.2.1.json");
let cache;

async function index() {
  // Only cache successful reads: a missing index can be created while the
  // process is running and a subsequent tool call can recover immediately.
  if (!cache) cache = await loadRules(indexPath);
  return cache;
}

const server = new McpServer({ name: "dnd-2024-srd", version: "0.1.0" });
const errorResult = error => ({
  isError: true,
  content: [{ type: "text", text: `SRD 5.2.1 unavailable: ${error.message}. Run npm run rules:setup. Do not guess a rule.` }]
});

server.registerTool("search_rules", {
  description: "Search the English official D&D 2024 SRD 5.2.1; returns verifiable PDF pages and excerpts. Search BEFORE answering a D&D rules question, including one asked in French; translate search terms to English. SRD is not the complete Player's Handbook. If no relevant passage is found, say it cannot be verified.",
  inputSchema: {
    query: z.string().min(2).max(500).describe("English rule terms, e.g. 'grappled condition' or 'opportunity attack'"),
    limit: z.number().int().min(1).max(8).default(4)
  },
  annotations: { readOnlyHint: true, openWorldHint: false }
}, async ({ query, limit }) => {
  try {
    const matches = searchRules(await index(), query, { limit });
    return { content: [{ type: "text", text: matches.length
      ? JSON.stringify(matches)
      : "No matching SRD 5.2.1 passage. This does NOT mean the rule does not exist; do not invent an answer or citation." }] };
  } catch (error) { return errorResult(error); }
});

server.registerTool("read_rule_page", {
  description: "Read an exact English official SRD 5.2.1 PDF page returned by search_rules to verify context before citing it.",
  inputSchema: { page: z.number().int().min(1) },
  annotations: { readOnlyHint: true, openWorldHint: false }
}, async ({ page }) => {
  try {
    const result = readRulePage(await index(), page);
    return { content: [{ type: "text", text: result ? JSON.stringify(result)
      : "Page unavailable in SRD 5.2.1 index; do not cite it." }] };
  } catch (error) { return errorResult(error); }
});

await server.connect(new StdioServerTransport());
