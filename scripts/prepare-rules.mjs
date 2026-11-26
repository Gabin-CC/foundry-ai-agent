#!/usr/bin/env node
// Build the local index from official SRD 5.2.1 and optional private rule PDFs.
// Requires Poppler's pdftotext. Does not change Foundry or OpenCode sessions.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { SOURCE, SOURCE_SHA256, validPdfName, validateIndex } from "../lib/rules.mjs";
import { writeRulesSearchSidecar } from "../lib/rules-search-build.mjs";
import { fingerprintPrivatePdf } from "../lib/private-pdf.mjs";

const run = promisify(execFile);
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--en")) {
  throw new Error("Supported optional argument: --en path/to/official-srd-5.2.1.pdf");
}
const localPdf = args.length ? resolve(args[1]) : null;

const directory = join(process.cwd(), ".rules");
const privateDirectory = join(process.cwd(), "rules-private");
await mkdir(directory, { recursive: true, mode: 0o700 });
const pages = [];

async function extractPages(input, source, timeout = 120000) {
  // -raw keeps the original reading order of the two-column SRD pages.
  // -layout can interleave the two columns and produce misleading passages.
  const { stdout } = await run("pdftotext", ["-raw", "-enc", "UTF-8", input, "-"], {
    encoding: "utf8", maxBuffer: 80 * 1024 * 1024, timeout
  });
  const rawPages = stdout.split("\f");
  let count = 0;
  for (let i = 0; i < rawPages.length; i++) {
    const text = rawPages[i].replace(/([A-Za-zÀ-ÿ])-\n([a-zà-ÿ])/g, "$1$2").trim();
    if (!text) continue;
    pages.push({ source, language: "en", page: i + 1, text });
    count++;
  }
  if (!count || count > 2500) {
    throw new Error(`${source}: no extractable text or too many pages. A scanned PDF may need OCR.`);
  }
  return count;
}

for (const language of ["en"]) {
  let pdf;
  const input = join(directory, `srd-5.2.1-${language}.pdf`);
  if (localPdf) {
    pdf = await readFile(localPdf);
    console.log(`Reading provided ${language.toUpperCase()} PDF`);
  } else {
    // Re-index private books without requiring another download of the SRD.
    const cached = await readFile(input).catch(() => null);
    if (cached && createHash("sha256").update(cached).digest("hex") === SOURCE_SHA256) {
      pdf = cached;
      console.log(`Using cached official ${language.toUpperCase()} SRD 5.2.1 PDF`);
    } else {
      console.log(`Downloading official ${language.toUpperCase()} SRD 5.2.1 PDF`);
      const response = await fetch(SOURCE, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error(`Official ${language} PDF download failed (HTTP ${response.status})`);
      if (Number(response.headers.get("content-length")) > 35_000_000) throw new Error("PDF exceeds size limit");
      pdf = Buffer.from(await response.arrayBuffer());
    }
  }
  if (pdf.length > 35_000_000 || pdf.subarray(0, 5).toString() !== "%PDF-") {
    throw new Error(`${language} source is not a valid-sized PDF`);
  }
  const checksum = createHash("sha256").update(pdf).digest("hex");
  if (checksum !== SOURCE_SHA256) {
    throw new Error("The PDF differs from the pinned official SRD 5.2.1. Refusing to attribute unverified content.");
  }
  // The official PDFs are kept as local reference copies. These exact files
  // determine the page numbers returned by the search MCP tool.
  await writeFile(input, pdf, { mode: 0o600 });
  const count = await extractPages(input, "srd");
  if (count < 30) throw new Error(`${language} PDF yielded too few pages: ${count}`);
  console.log(`Indexed ${count} ${language.toUpperCase()} PDF pages`);
}

await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
const private_sources = [];
const entries = (await readdir(privateDirectory, { withFileTypes: true }))
  .filter(entry => entry.name.toLowerCase().endsWith(".pdf"))
  .sort((a, b) => a.name.localeCompare(b.name));
if (entries.length > 30) throw new Error("Maximum 30 private PDFs per index");
for (const entry of entries) {
  if (!entry.isFile() || !validPdfName(entry.name)) {
    throw new Error(`Invalid private PDF file: ${entry.name} (regular files only)`);
  }
  const input = join(privateDirectory, entry.name);
  const checksum = await fingerprintPrivatePdf(input);
  // Large illustrated books may take longer than the official SRD to parse.
  const count = await extractPages(input, entry.name, 600000);
  private_sources.push({ name: entry.name, sha256: checksum });
  console.log(`Indexed ${count} pages from private PDF: ${entry.name}`);
}

const result = validateIndex({ version: "5.2.1", pdf_sha256: SOURCE_SHA256, private_sources, pages });
const output = join(directory, "srd-5.2.1.json");
const temporary = `${output}.${process.pid}.tmp`;
const sourceText = JSON.stringify(result);
await writeFile(temporary, sourceText, { mode: 0o600 });
await rename(temporary, output);
const search = await writeRulesSearchSidecar(result, sourceText, directory);
console.log(`Ready: ${output} (${pages.length} pages, ${private_sources.length} private PDFs; ${search.passageCount} search passages). Restart OpenCode to reload if needed.`);
