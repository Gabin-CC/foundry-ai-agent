// Installer-side preparation: create the private, precomputed search lookup
// from an already extracted rules index, without touching any source PDFs.
import { createHash } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compileRulesSearch, SEARCH_SIDECAR_NAME } from "./rules.mjs";

export async function writeRulesSearchSidecar(index, indexText, directory) {
  const search = compileRulesSearch(index);
  const index_sha256 = createHash("sha256").update(indexText).digest("hex");
  const output = join(directory, SEARCH_SIDECAR_NAME);
  const temporary = `${output}.${process.pid}.tmp`;
  // JSON is intentionally uncompressed: every standalone OpenCode request
  // starts a fresh local rules MCP, and decompression would add latency.
  await writeFile(temporary, JSON.stringify({ ...search, index_sha256 }), { mode: 0o600 });
  await rename(temporary, output);
  return { output, passageCount: search.documents.length };
}
