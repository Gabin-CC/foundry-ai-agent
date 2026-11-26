#!/usr/bin/env node
// Upgrade an existing locally indexed corpus without re-reading 30 PDF books.
import { link, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { LEGACY_RULES_INDEX_FILENAME, RULES_INDEX_FILENAME, validateIndex } from "../lib/rules.mjs";
import { writeRulesSearchSidecar } from "../lib/rules-search-build.mjs";

if (process.argv.length !== 2) throw new Error("Usage: npm run rules:optimize (no arguments)");
const directory = join(process.cwd(), ".rules");
const indexPath = join(directory, RULES_INDEX_FILENAME);
let raw;
try { raw = await readFile(indexPath, "utf8"); }
catch (error) {
  if (error.code !== "ENOENT") throw error;
  const legacyPath = join(directory, LEGACY_RULES_INDEX_FILENAME);
  raw = await readFile(legacyPath, "utf8");
  validateIndex(JSON.parse(raw));
  // Hard-link first with EEXIST protection, then drop only the old pathname.
  // This is a no-overwrite, same-filesystem move of already indexed data,
  // with no re-extraction and no window where the sole copy is lost.
  await link(legacyPath, indexPath);
  await unlink(legacyPath);
  console.log(`Renamed ${LEGACY_RULES_INDEX_FILENAME} to ${RULES_INDEX_FILENAME} without re-indexing.`);
}
const index = validateIndex(JSON.parse(raw));
const { output, passageCount } = await writeRulesSearchSidecar(index, raw, directory);
console.log(`Optimized ${index.pages.length} PDF pages into ${passageCount} passages: ${output}`);
console.log("No PDFs were re-extracted. Restart the bridge to use this precomputed search index.");
