import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { evaluateRuleCase, evaluateRuleSuite, normalizeAnswer,
  validateRuleSuite } from "../lib/rules-eval.mjs";
import { SOURCE, SOURCE_SHA256 } from "../lib/rules.mjs";

const project = join(dirname(fileURLToPath(import.meta.url)), "..");
const suite = JSON.parse(await readFile(join(project, "eval", "rules-2024-srd.json"), "utf8"));
// Small, fictional in-memory index. This test never reads or needs private PDFs.
const uniqueReferences = [...new Map(suite.cases.filter(item => item.reference)
  .map(item => [item.reference.page, item.reference])).values()];
const index = {
  version: "5.2.1", pdf_sha256: SOURCE_SHA256,
  pages: uniqueReferences.map(ref => ({ source: "srd", language: "en", page: ref.page,
    text: suite.cases.filter(item => item.reference?.page === ref.page)
      .map(item => item.reference.anchor).join(". ") + ". Synthetic test passage." }))
};
const caseById = Object.fromEntries(suite.cases.map(item => [item.id, item]));
const cite = page => `<a href="${SOURCE}#page=${page}">SRD 5.2.1 (EN), PDF p. ${page}</a>`;
const trace = page => [{ name: "rules_read_rule_page", status: "completed",
  input: { source: "srd", page } }];
const review = { verdict: "correct", reviewer: "Fixture reviewer", notes: "Synthetic example, not a model run." };
const sample = (id, reply, options = {}) => ({ id, reply: `<p>${reply}</p>`, ...options });

const knownCorrect = [
  sample("opportunity-attack-reaction", `Une réaction quand une créature visible quitte votre allonge. ${cite(15)}`, { toolCalls: trace(15), review }),
  sample("disengage-prevents-opportunity", `Non : l'action Se désengager ne provoque pas d'attaque d'opportunité. ${cite(15)}`, { toolCalls: trace(15), review }),
  sample("bonus-action-limit", `Une seule action bonus par tour, si une capacité permet de la prendre. ${cite(10)}`, { toolCalls: trace(10), review }),
  sample("critical-hit-dice", `On lance les dés de dégâts deux fois ; le modificateur est ajouté une seule fois. ${cite(16)}`, { toolCalls: trace(16), review }),
  sample("resistance-round-down", `15 dégâts deviennent 7 dégâts, arrondis vers le bas. Deux résistances ne se cumulent pas. ${cite(17)}`, { toolCalls: trace(17), review }),
  sample("one-spell-slot-per-turn-2024", `Non. Un seul emplacement de sort par tour : impossible de dépenser deux emplacements dans le même tour. ${cite(105)}`, { toolCalls: trace(105), review }),
  sample("unarmed-grapple-save-2024", `Non, pas un test opposé d'Athlétisme : la cible fait un jet de sauvegarde de Force ou Dextérité. ${cite(190)}`, { toolCalls: trace(190), review }),
  sample("grappled-condition-effects", `Speed 0; Disadvantage on attacks against targets other than the grappler. ${cite(182)}`, { toolCalls: trace(182), review }),
  sample("hide-fixed-dc-2024", `DD 15 en Dextérité (Discrétion) pour Hide. ${cite(183)}`, { toolCalls: trace(183), review }),
  sample("short-rest-2024", `Un repos court dure une heure ; subir des dégâts interrompt ce repos. ${cite(187)}`, { toolCalls: trace(187), review }),
  sample("advantage-disadvantage-cancel", `Advantage and Disadvantage cancel; roll one d20. ${cite(8)}`, { toolCalls: trace(8), review }),
  sample("close-range-ranged-attack", `Désavantage si un ennemi qui vous voit est proche et n'est pas incapacite. ${cite(15)}`, { toolCalls: trace(15), review }),
  sample("unsourced-vecna-ritual", "Je ne peux pas vérifier ce rituel dans le SRD 5.2.1. Aucune source vérifiable ne donne ses effets.", {
    toolCalls: [{ name: "rules_search_rules", status: "completed",
      input: { source: "srd", query: "scarlet crown Vecna ritual" } }], review
  })
];

test("pinned SRD-only gold cases have distinct IDs, headings, and validated patterns", () => {
  assert.equal(validateRuleSuite(suite, index), suite);
  assert.equal(suite.cases.length, 13);
  assert.equal(suite.cases.filter(item => item.expect === "abstain").length, 1);
  assert.equal(suite.cases.filter(item => item.expect === "answer").length, 12);
});

test("synthetic reviewed-correct answers cover all 13 rubrics and exact consulted pages", () => {
  const report = evaluateRuleSuite(suite, knownCorrect, index);
  assert.deepEqual(report.results.filter(item => item.status !== "reviewed-correct"), []);
  assert.equal(report.summary.reviewedCorrect, 13);
  assert.equal(report.summary.smokePassed, 13);
  assert.equal(report.summary.goldCitations, 12);
  assert.equal(report.summary.provenanceVerified, 13);
  assert.equal(report.summary.human.accuracy, 1);
});

test("an invented page and a real page never consulted fail independently", () => {
  const base = knownCorrect[0];
  const invented = evaluateRuleCase(caseById[base.id], {
    ...base, reply: base.reply.replaceAll("15", "999")
  }, index);
  assert.equal(invented.citation, "wrong-page");
  assert.equal(invented.status, "failed");
  const notConsulted = evaluateRuleCase(caseById[base.id], { ...base, toolCalls: [] }, index);
  assert.equal(notConsulted.evidence, "unretrieved-citation");
  assert.equal(notConsulted.status, "failed");
});

test("plausible D&D 2014 contested grapple ruling fails despite a real retrieved citation", () => {
  const base = knownCorrect.find(x => x.id === "unarmed-grapple-save-2024");
  const bad = evaluateRuleCase(caseById[base.id], {
    ...base, reply: `<p>En 2024, fais un test opposé d'Athlétisme contre Acrobaties. ${cite(190)}</p>`
  }, index);
  assert.equal(bad.citation, "gold-page");
  assert.equal(bad.evidence, "verified");
  assert.equal(bad.smoke.pass, false);
  assert.equal(bad.status, "failed");
});

test("explicit negations of 2014 misconceptions do not trigger broad negative patterns", () => {
  for (const [id, reply] of [
    ["critical-hit-dice", `On lance les dés de dégâts deux fois, mais on ne double pas le modificateur ; il reste ajouté une seule fois. ${cite(16)}`],
    ["unarmed-grapple-save-2024", `Ce n'est pas Athlétisme contre Acrobaties, pas un test opposé : la cible fait un jet de sauvegarde de Force ou Dextérité. ${cite(190)}`],
    ["resistance-round-down", `Ce n'est pas 8 dégâts : 15 dégâts deviennent 7 dégâts. Les résistances ne se cumulent pas. ${cite(17)}`]
  ]) {
    const evaluated = evaluateRuleCase(caseById[id], {
      id, reply: `<p>${reply}</p>`, toolCalls: trace(caseById[id].reference.page), review
    }, index);
    assert.equal(evaluated.status, "reviewed-correct", id + ": " + JSON.stringify(evaluated.smoke));
  }
});

test("an honest refusal passes without citation; fabricated ritual page fails", () => {
  const base = knownCorrect.at(-1);
  assert.equal(evaluateRuleCase(caseById[base.id], base, index).status, "reviewed-correct");
  const bad = evaluateRuleCase(caseById[base.id], {
    ...base, reply: `${base.reply} ${cite(105)}`
  }, index);
  assert.equal(bad.citation, "unexpected");
  assert.equal(bad.status, "failed");
  assert.equal(evaluateRuleCase(caseById[base.id], { ...base, toolCalls: [] }, index).evidence,
    "no-completed-search");
  assert.equal(evaluateRuleCase(caseById[base.id], { ...base, toolCalls: undefined }, index).status,
    "needs-evidence");
});

test("pattern success without a tool trace or human review is not semantic proof", () => {
  const base = knownCorrect[0];
  const withoutTrace = evaluateRuleCase(caseById[base.id], {
    id: base.id, reply: base.reply
  }, index);
  assert.equal(withoutTrace.status, "needs-evidence");
  const withoutReview = evaluateRuleCase(caseById[base.id], {
    id: base.id, reply: base.reply, toolCalls: base.toolCalls
  }, index);
  assert.equal(withoutReview.status, "needs-review");
  const humanIncorrect = evaluateRuleCase(caseById[base.id], {
    ...base, review: { verdict: "incorrect", reviewer: "GM" }
  }, index);
  assert.equal(humanIncorrect.status, "failed");
});

test("partial, duplicate and unknown responses are handled without inflating pass rate", () => {
  const partial = evaluateRuleSuite(suite, knownCorrect.slice(0, 2), index);
  assert.equal(partial.summary.failed, 11);
  assert.equal(partial.summary.human.unreviewed, 11);
  assert.throws(() => evaluateRuleSuite(suite, [...knownCorrect, knownCorrect[0]], index), /duplicate response ID/);
  assert.throws(() => evaluateRuleSuite(suite, [sample("unlisted-case", "hello")], index), /unknown response ID/);
  assert.throws(() => evaluateRuleSuite(suite, [{ id: knownCorrect[0].id, reply: "yes", review: { verdict: "correct" } }], index), /human review/);
});

test("normalization handles accented French and safe HTML for bilingual checks", () => {
  assert.equal(normalizeAnswer("<p><strong>Dégâts</strong> &amp; Réaction</p>"), "degats & reaction");
  assert.equal(normalizeAnswer("<script>fake damage</script><p>Vrai</p>"), "vrai");
});

test("CLI emits exactly the reviewed questions without model calls or SRD setup", () => {
  const text = execFileSync(process.execPath, ["scripts/evaluate-rules.mjs", "--prompts"],
    { cwd: project, encoding: "utf8" });
  const lines = text.trim().split("\n").map(line => JSON.parse(line));
  assert.equal(lines.length, 13);
  assert.equal(lines[0].id, suite.cases[0].id);
  assert.ok(lines.every(line => /Do not access Foundry/.test(line.instruction)));
});

test("CLI JSON replay separates incomplete coverage from reviewed model accuracy", async t => {
  const folder = await mkdtemp(join(tmpdir(), "foundry-rules-eval-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const corpus = join(folder, "index.json");
  const recorded = join(folder, "recorded.jsonl");
  await Promise.all([
    writeFile(corpus, JSON.stringify(index)),
    writeFile(recorded, JSON.stringify(knownCorrect[0]) + "\n")
  ]);
  let reportText;
  try {
    execFileSync(process.execPath, ["scripts/evaluate-rules.mjs", "--responses", recorded,
      "--index", corpus, "--json"], { cwd: project, encoding: "utf8" });
    assert.fail("An incomplete evaluation must return a failing exit code");
  } catch (error) {
    assert.equal(error.status, 1);
    reportText = error.stdout;
  }
  const report = JSON.parse(reportText);
  assert.equal(report.summary.cases, 13);
  assert.equal(report.summary.answered, 1);
  assert.equal(report.summary.failed, 12);
  assert.equal(report.summary.reviewedCorrect, 1);
  assert.equal(report.summary.human.unreviewed, 12);
});
