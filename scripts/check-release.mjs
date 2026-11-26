import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateRelease } from "../lib/release-check.mjs";

const project = fileURLToPath(new URL("..", import.meta.url));
const read = name => readFileSync(join(project, name), "utf8");
const manifest = JSON.parse(read("package.json"));
const lockfile = JSON.parse(read("package-lock.json"));

let trackedPaths = [];
if (process.argv.includes("--no-git")) {
  console.warn("[release] Git tracked-path check skipped (--no-git). Do not use for publication.");
} else {
  try {
    trackedPaths = execFileSync("git", ["ls-files", "-z"], { cwd: project, encoding: "utf8" })
      .split("\0").filter(Boolean);
  } catch {
    console.error("[release] Git index unavailable; run from a checkout or pass --no-git for metadata-only checks.");
    process.exit(1);
  }
}

const problems = validateRelease({
  version: manifest.version,
  lockVersion: lockfile.version,
  changelog: read("CHANGELOG.md"),
  notes: read(`docs/RELEASE_NOTES_v${manifest.version}.md`),
  trackedPaths
});

if (problems.length) {
  for (const problem of problems) console.error(`[release] FAIL: ${problem}`);
  process.exitCode = 1;
} else {
  console.log(`[release] PASS: v${manifest.version} metadata and tracked path policy`);
  console.log("[release] This does not scan file contents or Git history for secrets.");
}
