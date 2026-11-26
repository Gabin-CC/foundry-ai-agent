// Offline, read-only retrieval for the official SRD 5.2.1 (D&D 2024).
// Source metadata is part of the index so citations always point to the
// version and PDF that actually supplied a passage.
import { readFile } from "node:fs/promises";

export const SOURCE = "https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf";
// SHA-256 of the official May 2025 PDF. A different source must be reviewed
// before its content or page numbers are attributed to this version.
export const SOURCE_SHA256 = "8974902d109d6e63672d7c490bde9ccf052410503d9cfa768237154fbc5e3d87";

// Function words do not help distinguish one rule from another.
const STOP = new Set(`a an and are as at be by can do does for from has have how i if in is it its of on or the their then this to what when where which who why with you your
au aux avec ce ces cet cette comme dans de des du elle en est et ils il je la le les leur ma mais me mes mon ne nous ou par pas pour que quel quelle quels quelles qui quoi sa se ses si son sont sur ta te tes ton tu un une vos vous y`.split(/\s+/));

export function tokens(text) {
  return String(text).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().match(/[a-z0-9]+/g)?.filter(word => word.length >= 3 && !STOP.has(word)) || [];
}

export function validateIndex(index) {
  if (index?.version !== "5.2.1" || index?.pdf_sha256 !== SOURCE_SHA256 ||
      !Array.isArray(index.pages) || !index.pages.length) {
    throw new Error("Invalid SRD 5.2.1 rules index; run npm run rules:setup");
  }
  const privateSources = index.private_sources || [];
  if (!Array.isArray(privateSources) || privateSources.length > 30) {
    throw new Error("Malformed private PDF source list");
  }
  const names = new Set();
  for (const item of privateSources) {
    if (!validPdfName(item?.name) || !/^[a-f0-9]{64}$/.test(item.sha256) || names.has(item.name)) {
      throw new Error("Malformed private PDF source metadata");
    }
    names.add(item.name);
  }
  for (const page of index.pages) {
    if (page.language !== "en" || !Number.isSafeInteger(page.page) || page.page < 1 ||
        typeof page.text !== "string" || !page.text.trim() ||
        (page.source !== "srd" && !names.has(page.source))) {
      throw new Error("Malformed SRD page in rules index");
    }
  }
  return index;
}

export function validPdfName(name) {
  return typeof name === "string" && name.length <= 180 &&
    /^[^/\\\x00-\x1f]+\.pdf$/i.test(name) && name[0] !== ".";
}

export function listRuleSources(index) {
  validateIndex(index);
  return [
    { id: "srd", name: "SRD 5.2.1 EN", kind: "official", url: SOURCE },
    ...(index.private_sources || []).map(item => ({
      id: item.name, name: item.name, kind: "user-provided PDF (not independently verified)", url: null
    }))
  ];
}

function reference(source, page, text) {
  return source === "srd"
    ? { source_id: "srd", source: "SRD 5.2.1 EN", kind: "official", page,
        url: `${SOURCE}#page=${page}`, text }
    : { source_id: source, source: source, kind: "user-provided PDF (not independently verified)",
        page, url: null, text };
}

export async function loadRules(path) {
  return validateIndex(JSON.parse(await readFile(path, "utf8")));
}

// Split pages into short, overlapping passages to keep both retrieval and the
// resulting OpenCode context manageable. Page numbers remain PDF page numbers.
export function passages(index, size = 1300, overlap = 200) {
  const results = [];
  for (const { source, page, text } of validateIndex(index).pages) {
    const clean = text.replace(/\s+/g, " ").trim();
    for (let start = 0; start < clean.length;) {
      let end = Math.min(start + size, clean.length);
      if (end < clean.length) {
        const boundary = clean.lastIndexOf(" ", end);
        if (boundary > start + size / 2) end = boundary;
      }
      results.push({ source, page, text: clean.slice(start, end) });
      if (end >= clean.length) break;
      start = Math.max(start + 1, end - overlap);
    }
  }
  return results;
}

export function searchRules(index, query, { limit = 4, source = "all" } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
    throw new RangeError("Invalid rules search options");
  }
  if (source !== "all" && !listRuleSources(index).some(item => item.id === source)) {
    throw new RangeError("Unknown rule source; call list_rule_sources");
  }
  const terms = [...new Set(tokens(query))];
  if (!terms.length) return [];
  const candidates = passages(index).filter(item => source === "all" || item.source === source);
  const documentFrequency = new Map();
  const tokenized = candidates.map(item => {
    const frequency = new Map();
    for (const term of tokens(item.text)) frequency.set(term, (frequency.get(term) || 0) + 1);
    for (const term of terms) if (frequency.has(term)) {
      documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
    }
    return { ...item, frequency };
  });
  return tokenized.map(item => {
    let score = 0, matched = 0;
    for (const term of terms) {
      const count = item.frequency.get(term) || 0;
      if (!count) continue;
      matched++;
      const idf = Math.log(1 + (candidates.length + 1) / (1 + documentFrequency.get(term)));
      score += idf * (1 + Math.log(count));
    }
    if (matched === terms.length && tokens(item.text).join(" ").includes(terms.join(" "))) {
      score += terms.length * 3; // Prefer the actual rule heading/phrase.
    }
    return { source: item.source, page: item.page, text: item.text, score, matched };
  }).filter(item => item.matched >= Math.min(2, terms.length))
    .sort((a, b) => b.score - a.score || b.matched - a.matched || a.page - b.page)
    .filter((item, position, sorted) => sorted.findIndex(other =>
      other.source === item.source && other.page === item.page) === position)
    .slice(0, limit).map(item => reference(item.source, item.page, item.text));
}

export function readRulePage(index, page, source = "srd") {
  validateIndex(index);
  if (!Number.isSafeInteger(page) || page < 1) return null;
  const found = index.pages.find(item => item.source === source && item.page === page);
  return found ? reference(source, page, found.text) : null;
}
