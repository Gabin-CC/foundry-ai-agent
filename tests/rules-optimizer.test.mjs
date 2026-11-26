import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { loadRules, searchRules, SEARCH_SIDECAR_NAME, SOURCE_SHA256 } from "../lib/rules.mjs";

const run = promisify(execFile);

test("rules:optimize precomputes search without reading or altering the PDFs", async t => {
  const root = await mkdtemp(join(tmpdir(), "foundry-optimized-rules-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, ".rules");
  await mkdir(directory);
  const indexPath = join(directory, "srd-5.2.1.json");
  const index = { version: "5.2.1", pdf_sha256: SOURCE_SHA256,
    private_sources: [], pages: [
      { source: "srd", language: "en", page: 15,
        text: "Opportunity Attack. A creature can use a Reaction to attack." },
      { source: "srd", language: "en", page: 16,
        text: "A bonus action can only be taken when a feature grants one." }
    ] };
  const original = JSON.stringify(index);
  await writeFile(indexPath, original);
  const { stdout } = await run(process.execPath, [resolve("scripts/optimize-rules.mjs")], { cwd: root });
  assert.match(stdout, /2 PDF pages into 2 passages/);
  assert.match(stdout, /No PDFs were re-extracted/);
  assert.equal(await readFile(indexPath, "utf8"), original);
  const path = join(directory, SEARCH_SIDECAR_NAME);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  const data = JSON.parse(await readFile(path, "utf8"));
  assert.equal(data.page_count, 2);
  assert.ok(data.postings.opportunity);
  const loaded = await loadRules(indexPath);
  assert.equal(searchRules(loaded, "opportunity attack")[0].page, 15);
});
