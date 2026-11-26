// Offline regression evaluation for D&D 2024 answers. String-pattern checks
// catch common mistakes; they cannot establish semantic correctness. Human
// review of the cited SRD passages is a separate, explicit verdict.
import { citedPages, validateRulesReply } from "./rules-guard.mjs";
import { readRulePage, validateIndex } from "./rules.mjs";

export function normalizeAnswer(html) {
  return String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:nbsp|amp|quot|apos|lt|gt);/gi, match => ({
      "&nbsp;": " ", "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">"
    })[match.toLowerCase()] || " ")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\s+/g, " ").trim();
}

function assert(value, description) {
  if (!value) throw new Error(`Invalid rules evaluation: ${description}`);
}

export function validateRuleSuite(suite, index) {
  assert(suite?.version === 1 && suite?.source === "srd" &&
    Array.isArray(suite.cases) && suite.cases.length > 0, "expected a version 1 SRD suite");
  validateIndex(index);
  const ids = new Set();
  for (const item of suite.cases) {
    assert(typeof item.id === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id) &&
      !ids.has(item.id), `invalid/duplicate case ID: ${item.id}`);
    ids.add(item.id);
    assert(typeof item.question === "string" && item.question.length > 15 &&
      typeof item.gold === "string" && item.gold.length > 15, `${item.id}: missing question/gold`);
    assert(["answer", "abstain"].includes(item.expect), `${item.id}: invalid expectation`);
    if (item.expect === "answer") {
      assert(Number.isSafeInteger(item.reference?.page) && item.reference.page > 0 &&
        typeof item.reference.anchor === "string" && item.reference.anchor.length >= 5,
      `${item.id}: invalid official reference`);
      const page = readRulePage(index, item.reference.page, "srd");
      assert(page && normalizeAnswer(page.text).includes(normalizeAnswer(item.reference.anchor)),
        `${item.id}: SRD PDF p. ${item.reference.page} does not contain the checked heading`);
    } else {
      assert(!item.reference, `${item.id}: abstention must not prescribe a made-up source`);
    }
    assert(Array.isArray(item.checks) && item.checks.length > 0 &&
      Array.isArray(item.redFlags), `${item.id}: invalid checks`);
    const checkIds = new Set();
    for (const check of [...item.checks, ...item.redFlags]) {
      assert(typeof check.id === "string" && check.id.length > 1 && !checkIds.has(check.id) &&
        Array.isArray(check.any) && check.any.length > 0, `${item.id}: invalid/duplicate rubric`);
      checkIds.add(check.id);
      for (const pattern of check.any) {
        assert(typeof pattern === "string" && pattern.length > 1 && pattern.length < 300,
          `${item.id}: invalid rubric pattern`);
        new RegExp(pattern, "iu"); // Fail on invalid rubric syntax before scoring.
      }
    }
  }
  return suite;
}

function matchedChecks(checks, content) {
  return checks.filter(check => check.any.some(pattern => new RegExp(pattern, "iu").test(content)))
    .map(check => check.id);
}

function validateReview(review, id) {
  if (review === undefined) return null;
  assert(review && ["correct", "incorrect", "uncertain"].includes(review.verdict) &&
    typeof review.reviewer === "string" && review.reviewer.trim().length > 0 &&
    (review.notes === undefined || typeof review.notes === "string"),
  `${id}: human review must include verdict (correct/incorrect/uncertain) and reviewer`);
  return { verdict: review.verdict, reviewer: review.reviewer, notes: review.notes || "" };
}

export function evaluateRuleCase(item, response, index) {
  assert(response && response.id === item.id && typeof response.reply === "string" &&
    (response.toolCalls === undefined || Array.isArray(response.toolCalls)),
  `${item.id}: response must contain id, reply and optional toolCalls array`);
  const review = validateReview(response.review, item.id);
  const content = normalizeAnswer(response.reply);
  const hits = matchedChecks(item.checks, content);
  const missed = item.checks.map(check => check.id).filter(id => !hits.includes(id));
  const redFlags = matchedChecks(item.redFlags, content);
  const smokePass = missed.length === 0 && redFlags.length === 0;

  const cited = citedPages(response.reply);
  let citationStatus;
  let evidenceStatus = "not-applicable";
  if (cited.invalid) citationStatus = "invalid";
  else if (item.expect === "abstain") citationStatus = cited.citations.length ? "unexpected" : "none-expected";
  else if (!cited.citations.length) citationStatus = "missing";
  else citationStatus = cited.citations.some(citation =>
    citation.source === "srd" && citation.page === item.reference.page) ? "gold-page" : "wrong-page";

  if (item.expect === "answer" && cited.citations.length && !cited.invalid) {
    if (response.toolCalls === undefined) evidenceStatus = "not-provided";
    else {
      const verdict = validateRulesReply({ question: item.question, reply: response.reply,
        toolCalls: response.toolCalls, index });
      evidenceStatus = verdict.ok ? "verified" : verdict.reason;
    }
  } else if (item.expect === "abstain") {
    // An apology without any actual SRD lookup is not evidence that the
    // named rule cannot be verified. A successful search is necessary, never
    // sufficient: the full reply still needs human review.
    if (response.toolCalls === undefined) evidenceStatus = "not-provided";
    else evidenceStatus = response.toolCalls.some(call =>
      call.name === "rules_search_rules" && call.status === "completed" &&
      call.isError !== true && typeof call.input?.query === "string" &&
      call.input.query.trim() && (call.input?.source === "srd" || call.input?.source === "all" ||
        call.input?.source === undefined)) ? "verified" : "no-completed-search";
  }
  const citationPass = ["gold-page", "none-expected"].includes(citationStatus);
  let status;
  if (!smokePass || !citationPass || (evidenceStatus !== "verified" &&
    !["not-provided", "not-applicable"].includes(evidenceStatus)) ||
    review?.verdict === "incorrect") status = "failed";
  else if (evidenceStatus === "not-provided") status = "needs-evidence";
  else if (review?.verdict !== "correct") status = "needs-review";
  else status = "reviewed-correct";

  return {
    id: item.id, status, expected: item.expect,
    reference: item.reference ? { source: "srd", page: item.reference.page } : null,
    smoke: { pass: smokePass, matched: hits, missed, redFlags },
    citation: citationStatus, evidence: evidenceStatus, review
  };
}

export function evaluateRuleSuite(suite, responses, index) {
  validateRuleSuite(suite, index);
  assert(Array.isArray(responses), "responses must be a JSON array or JSON Lines");
  const samples = new Map();
  const known = new Set(suite.cases.map(item => item.id));
  for (const response of responses) {
    assert(response && typeof response.id === "string" && known.has(response.id),
      `unknown response ID: ${response?.id}`);
    assert(!samples.has(response.id), `duplicate response ID: ${response.id}`);
    samples.set(response.id, response);
  }
  const results = suite.cases.map(item => samples.has(item.id)
    ? evaluateRuleCase(item, samples.get(item.id), index)
    : { id: item.id, status: "missing" });
  const count = value => results.filter(result => result.status === value).length;
  const reviewed = results.filter(result => result.review?.verdict);
  const correct = reviewed.filter(result => result.review.verdict === "correct").length;
  const incorrect = reviewed.filter(result => result.review.verdict === "incorrect").length;
  const uncertain = reviewed.filter(result => result.review.verdict === "uncertain").length;
  return {
    suite: suite.title,
    summary: {
      cases: results.length, answered: samples.size, failed: count("failed") + count("missing"),
      needsEvidence: count("needs-evidence"), needsReview: count("needs-review"),
      reviewedCorrect: count("reviewed-correct"),
      smokePassed: results.filter(result => result.smoke?.pass).length,
      goldCitations: results.filter(result => result.citation === "gold-page").length,
      provenanceVerified: results.filter(result => result.evidence === "verified").length,
      human: { correct, incorrect, uncertain, unreviewed: results.length - reviewed.length,
        accuracy: correct + incorrect ? correct / (correct + incorrect) : null }
    },
    results
  };
}
