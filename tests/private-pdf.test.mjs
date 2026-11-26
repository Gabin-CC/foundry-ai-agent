import assert from "node:assert/strict";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fingerprintPrivatePdf } from "../lib/private-pdf.mjs";

test("private PDF fingerprinting accepts sparse files larger than the former 250 MB cap", async t => {
  const directory = await mkdtemp(join(tmpdir(), "foundry-large-pdf-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = join(directory, "Large_Illustrated_Book.pdf");
  await writeFile(filename, "%PDF-1.7\n");
  // Sparse file: creates a >250 MB test case without copying a licensed book.
  await truncate(filename, 251_000_000);
  assert.match(await fingerprintPrivatePdf(filename), /^[a-f0-9]{64}$/);
});

test("private PDF fingerprinting rejects non-PDF inputs", async t => {
  const directory = await mkdtemp(join(tmpdir(), "foundry-invalid-pdf-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = join(directory, "not-a-pdf.pdf");
  await writeFile(filename, "plain text");
  await assert.rejects(fingerprintPrivatePdf(filename), /does not look like a PDF/);
});
