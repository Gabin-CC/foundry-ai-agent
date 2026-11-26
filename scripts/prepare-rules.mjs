#!/usr/bin/env node
// Build the local SRD index from the official, fixed-version PDF publications.
// Requires Poppler's pdftotext. Does not change Foundry or OpenCode sessions.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { SOURCE, SOURCE_SHA256, validateIndex } from "../lib/rules.mjs";

const run = promisify(execFile);
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--en")) {
  throw new Error("Supported optional argument: --en path/to/official-srd-5.2.1.pdf");
}
const localPdf = args.length ? resolve(args[1]) : null;

const directory = join(process.cwd(), ".rules");
await mkdir(directory, { recursive: true, mode: 0o700 });
const pages = [];
for (const language of ["en"]) {
  let pdf;
  if (localPdf) {
    pdf = await readFile(localPdf);
    console.log(`Reading provided ${language.toUpperCase()} PDF`);
  } else {
    console.log(`Downloading official ${language.toUpperCase()} SRD 5.2.1 PDF`);
    const response = await fetch(SOURCE, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Official ${language} PDF download failed (HTTP ${response.status})`);
    if (Number(response.headers.get("content-length")) > 35_000_000) throw new Error("PDF exceeds size limit");
    pdf = Buffer.from(await response.arrayBuffer());
  }
  if (pdf.length > 35_000_000 || pdf.subarray(0, 5).toString() !== "%PDF-") {
    throw new Error(`${language} source is not a valid-sized PDF`);
  }
  const checksum = createHash("sha256").update(pdf).digest("hex");
  if (checksum !== SOURCE_SHA256) {
    throw new Error("The PDF differs from the pinned official SRD 5.2.1. Refusing to attribute unverified content.");
  }
  const input = join(directory, `srd-5.2.1-${language}.pdf`);
  // The official PDFs are kept as local reference copies. These exact files
  // determine the page numbers returned by the search MCP tool.
  await writeFile(input, pdf, { mode: 0o600 });
  // -raw keeps the original reading order of the two-column SRD pages.
  // -layout can interleave the two columns and produce misleading passages.
  const { stdout } = await run("pdftotext", ["-raw", "-enc", "UTF-8", input, "-"], {
    encoding: "utf8", maxBuffer: 80 * 1024 * 1024, timeout: 120000
  });
  const rawPages = stdout.split("\f");
  let count = 0;
  for (let i = 0; i < rawPages.length; i++) {
    const text = rawPages[i].replace(/([A-Za-zÀ-ÿ])-\n([a-zà-ÿ])/g, "$1$2").trim();
    if (!text) continue;
    pages.push({ language, page: i + 1, text });
    count++;
  }
  if (count < 30) throw new Error(`${language} PDF yielded too few pages: ${count}`);
  console.log(`Indexed ${count} ${language.toUpperCase()} PDF pages`);
}

const result = validateIndex({ version: "5.2.1", pdf_sha256: SOURCE_SHA256, pages });
const output = join(directory, "srd-5.2.1.json");
const temporary = `${output}.${process.pid}.tmp`;
await writeFile(temporary, JSON.stringify(result), { mode: 0o600 });
await rename(temporary, output);
console.log(`Ready: ${output} (${pages.length} pages). Restart OpenCode to reload local MCP tools if needed.`);
