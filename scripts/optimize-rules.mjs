#!/usr/bin/env node
// Upgrade an existing locally indexed corpus without re-reading 30 PDF books.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { validateIndex } from "../lib/rules.mjs";
import { writeRulesSearchSidecar } from "../lib/rules-search-build.mjs";

if (process.argv.length !== 2) throw new Error("Usage: npm run rules:optimize (no arguments)");
const directory = join(process.cwd(), ".rules");
const indexPath = join(directory, "srd-5.2.1.json");
const raw = await readFile(indexPath, "utf8");
const index = validateIndex(JSON.parse(raw));
const { output, passageCount } = await writeRulesSearchSidecar(index, raw, directory);
console.log(`Optimized ${index.pages.length} PDF pages into ${passageCount} passages: ${output}`);
console.log("No PDFs were re-extracted. Restart the bridge to use this precomputed search index.");
