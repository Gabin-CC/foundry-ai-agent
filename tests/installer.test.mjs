import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const project = fileURLToPath(new URL("..", import.meta.url));

test("installer supports English and French and preserves owner-only .env", () => {
  const directory = mkdtempSync(join(tmpdir(), "foundry-installer-test-"));
  try {
    for (const name of ["install.sh", ".env.example"]) {
      copyFileSync(join(project, name), join(directory, basename(name)));
    }

    const first = spawnSync("bash", ["install.sh", "--lang", "fr", "--non-interactive", "--skip-deps"], {
      cwd: directory,
      encoding: "utf8"
    });
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /Installation de Foundry AI Agent/);
    assert.equal(statSync(join(directory, ".env")).mode & 0o777, 0o600);

    const original = readFileSync(join(directory, ".env"), "utf8");
    const second = spawnSync("bash", ["install.sh", "--lang=en", "--non-interactive", "--skip-deps"], {
      cwd: directory,
      encoding: "utf8"
    });
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /Existing \.env preserved/);
    assert.equal(readFileSync(join(directory, ".env"), "utf8"), original);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
