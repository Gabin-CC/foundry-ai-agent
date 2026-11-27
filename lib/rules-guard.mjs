// Check the provenance of cited D&D rules pages before a Foundry whisper is sent.
// This verifies retrieval and page identity, NOT the semantic interpretation of
// a rule. It intentionally does not classify every possible rules question.
import { join } from "node:path";
import { RULES_INDEX_FILENAME, SOURCE, loadRules, readRulePage, searchRules } from "./rules.mjs";
import { accessRole, loadAccessPolicy, visibleRulesIndex } from "./rules-access.mjs";

const normalize = value => String(value || "").normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "").toLowerCase();
const RULE_TERMS = /\b(?:regles?|rules?|srd|d\s*&\s*d|dnd|phb|rulebook|manuels?)\b/i;
const QUESTION = /\b(?:est.ce que|peut.on|puis.je|ai.je le droit|comment|quand|combien|quel(?:le)?s?|can i|may i|how (?:does|do|many)|what (?:is|are|happens)|when (?:do|does))\b/i;
const GAME_COMMAND = /^(?:lance|lancer|jette|fais (?:un )?jet|roll|throw|utilise|applique|affiche|ouvre|montre)\b/i;
const MECHANICS = /\b(?:sorts?|spells?|attaques?|attacks?|actions?|reactions?|concentration|agrippe|grappled|conditions?|etats?|sauvegarde|saving throws?|degats?|damage|repos|rests?|initiative|deplacement|movement|maitrise|proficiency|combat|armures?|armou?r)\b/i;
const UNVERIFIED = /(?:ne (?:peux|peut|parviens) pas (?:la |le |les )?verifier|impossible (?:de |a )verifier|pas de source (?:fiable|verifiable)|cannot verify|can't verify|not verifiable|no (?:reliable|verifiable) source)/i;
const OFFICIAL_PDF = SOURCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SRD_HREF = new RegExp(`^${OFFICIAL_PDF}#page=([1-9]\\d*)$`);

export function isRulesQuestion(question) {
  const text = normalize(question).trim();
  if (GAME_COMMAND.test(text) && !QUESTION.test(text)) return false;
  return RULE_TERMS.test(text) || (QUESTION.test(text) && MECHANICS.test(text));
}

// Only completed OpenCode tool calls from the current turn count as evidence.
// Recomputing the deterministic search avoids depending on OpenCode's changing
// text serialization for MCP result bodies.
export function collectedEvidence(index, toolCalls = [], preferredSources = []) {
  const found = new Set();
  for (const call of toolCalls) {
    if (call.status !== "completed" || call.isError) continue;
    try {
      if (["foundry_rules_search", "rules_search_rules"].includes(call.name)) {
        if (typeof call.input?.query !== "string") continue;
        const hits = searchRules(index, call.input.query, {
          source: call.input.source || "all", limit: call.input.limit || 4,
          preferredSources
        });
        for (const hit of hits) found.add(`${hit.source_id}\u0000${hit.page}`);
      } else if (["foundry_rules_read_page", "rules_read_rule_page"].includes(call.name)) {
        const page = readRulePage(index, call.input?.page, call.input?.source || "srd");
        const offset = call.input?.offset ?? 0;
        if (page && Number.isSafeInteger(offset) && offset >= 0 && offset < page.text.length) {
          found.add(`${page.source_id}\u0000${page.page}`);
        }
      }
    } catch { /* Failed/invalid tools never authorize a citation. */ }
  }
  return found;
}

export function citedPages(html) {
  const citations = [];
  let invalid = false;
  const content = String(html || "");
  const plain = content.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");

  // An official PDF hyperlink must point to the exact fixed-version source.
  for (const match of content.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[1].replace(/&amp;/g, "&");
    const label = match[2].replace(/<[^>]*>/g, " ");
    // Local commercial PDFs are not public links; an unrelated PDF URL must
    // never be presented as the source actually consulted by the agent.
    if (/\.pdf(?:#|\?|$)/i.test(href) && !SRD_HREF.test(href)) invalid = true;
    if (!/SRD\s*5\.2\.1|SRD_CC_v5\.2\.1\.pdf/i.test(`${href} ${label}`)) continue;
    const parsed = SRD_HREF.exec(href);
    if (parsed) {
      const page = Number(parsed[1]);
      citations.push({ source: "srd", page });
      const labelPage = /(?:PDF\s*)?(?:p\.|page)\s*(\d+)/i.exec(label);
      if (labelPage && Number(labelPage[1]) !== page) invalid = true;
    } else invalid = true;
  }

  // Also accept an unlinked SRD citation, but never manufacture an official
  // URL from unrelated text or accept invented SRD versions.
  for (const match of plain.matchAll(/SRD\s*5\.2\.1[^\n]{0,90}?(?:PDF\s*)?(?:p\.|page)\s*(\d+)/gi)) {
    citations.push({ source: "srd", page: Number(match[1]) });
  }
  for (const match of plain.matchAll(/([^\r\n/\\]{1,180}\.pdf)\s*[,—:\- ]*\s*(?:PDF\s*)?(?:p\.|page)\s*(\d+)/gi)) {
    const source = match[1].trim();
    if (!/SRD_CC_v5\.2\.1\.pdf/i.test(source)) {
      citations.push({ source, page: Number(match[2]) });
    }
  }
  for (const match of plain.matchAll(/\bSRD\s*(\d+\.\d+(?:\.\d+)?)\b/gi)) {
    if (match[1] !== "5.2.1") invalid = true;
  }
  return { citations, invalid };
}

export function validateRulesReply({ question, reply, toolCalls = [], index,
  preferredSources = [] }) {
  const isRule = isRulesQuestion(question);
  const { citations, invalid } = citedPages(reply);
  if (!isRule && !citations.length && !invalid) return { ok: true, reason: "not-rule" };
  if (invalid) return { ok: false, reason: "invalid-citation" };
  if (!citations.length) {
    return isRule && !UNVERIFIED.test(normalize(reply))
      ? { ok: false, reason: "missing-citation" }
      : { ok: true, reason: "no-rule-claim" };
  }
  const evidence = collectedEvidence(index, toolCalls, preferredSources);
  for (const citation of citations) {
    const source = citation.source === "srd" ? "srd"
      : (index.private_sources || []).find(item => citation.source.endsWith(item.name))?.name;
    if (!source || !readRulePage(index, citation.page, source) ||
        !evidence.has(`${source}\u0000${citation.page}`)) {
      return { ok: false, reason: "unretrieved-citation" };
    }
  }
  return { ok: true, reason: "verified-reference" };
}

export function createRulesReplyGuard({ indexPath = join(process.cwd(), ".rules", RULES_INDEX_FILENAME),
  accessPath = join(process.cwd(), "rules-private", "access.json"),
  mode = "enforce", logger = console } = {}) {
  if (!["enforce", "off"].includes(mode)) throw new RangeError("RULES_CITATION_MODE must be enforce or off");
  if (mode === "off") return async ({ reply }) => reply;
  let cache;
  const roleViews = new Map();
  const getIndex = () => {
    if (!cache) cache = loadRules(indexPath).catch(error => { cache = null; throw error; });
    return cache;
  };
  return async ({ question, reply, toolCalls = [], role }) => {
    const attempted = citedPages(reply);
    if (!isRulesQuestion(question) && !attempted.citations.length && !attempted.invalid) return reply;
    try {
      const policy = await loadAccessPolicy(accessPath);
      const resolvedRole = accessRole(role);
      const revision = JSON.stringify([...policy.rules_for_all].sort());
      let visibleCache = roleViews.get(resolvedRole);
      if (!visibleCache || visibleCache.revision !== revision) {
        visibleCache = { revision,
          index: visibleRulesIndex(await getIndex(), policy, resolvedRole) };
        roleViews.set(resolvedRole, visibleCache);
      }
      const result = validateRulesReply({ question, reply, toolCalls,
        index: visibleCache.index, preferredSources: ["srd", ...policy.rules_for_all] });
      if (result.ok) return reply;
      logger.error(`[agent] rules citation gate rejected reply: ${result.reason}`);
    } catch (error) {
      logger.error(`[agent] rules citation index unavailable: ${error.message}`);
    }
    const english = /\b(?:how|what|when|can i|may i|rule)\b/i.test(question) &&
      !/\b(?:r[eè]gle|comment|quelle|est.ce que|peut.on)\b/i.test(question);
    return english
      ? "<p>I cannot verify that ruling from a source consulted for this reply. Please check the indexed SRD 5.2.1 or your private rulebooks.</p>"
      : "<p>Je ne peux pas vérifier cette règle à partir d’une source consultée pour cette réponse. Vérifie le SRD 5.2.1 ou les livres PDF indexés.</p>";
  };
}
