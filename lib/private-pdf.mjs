// Validate and fingerprint a local PDF without loading the book into memory.
// In particular, illustrated rulebooks can be much larger than 250 MB.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";

export async function fingerprintPrivatePdf(path) {
  const file = await open(path, "r");
  const header = Buffer.alloc(5);
  try { await file.read(header, 0, header.length, 0); }
  finally { await file.close(); }
  if (header.toString() !== "%PDF-") {
    throw new Error("Private rulebook does not look like a PDF");
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
