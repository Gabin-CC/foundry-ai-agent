import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync,
  statSync, writeFileSync } from "node:fs";
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

    const first = spawnSync("bash", ["install.sh", "--lang", "fr", "--non-interactive", "--skip-deps", "--skip-opencode"], {
      cwd: directory,
      encoding: "utf8"
    });
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /Installation de Foundry AI Agent/);
    assert.equal(statSync(join(directory, ".env")).mode & 0o777, 0o600);

    const original = readFileSync(join(directory, ".env"), "utf8");
    const second = spawnSync("bash", ["install.sh", "--lang=en", "--non-interactive", "--skip-deps", "--skip-opencode"], {
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

test("installer refuses V1 in unattended mode without touching global npm", () => {
  const directory = mkdtempSync(join(tmpdir(), "foundry-v2-check-"));
  try {
    mkdirSync(join(directory, "scripts"));
    mkdirSync(join(directory, "lib"));
    mkdirSync(join(directory, "bin"));
    for (const path of ["install.sh", ".env.example", "scripts/check-opencode-v2.mjs",
      "lib/opencode-cli.mjs"]) copyFileSync(join(project, path), join(directory, path));
    const binary = join(directory, "bin", "opencode");
    writeFileSync(binary, "#!/bin/sh\nprintf 'opencode 1.19.6\\n'\n");
    chmodSync(binary, 0o755);
    const result = spawnSync("bash", ["install.sh", "--lang=en", "--non-interactive", "--skip-deps"], {
      cwd: directory, encoding: "utf8", env: { ...process.env,
        PATH: `${join(directory, "bin")}:${process.env.PATH}`, OPENCODE_BIN: "opencode" }
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /OpenCode V2 is missing or incompatible/);
    assert.match(result.stderr, /@opencode\/cli/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("opt-in installer uses the official npm V2 package and verifies its major version", () => {
  const directory = mkdtempSync(join(tmpdir(), "foundry-v2-install-"));
  try {
    mkdirSync(join(directory, "scripts"));
    mkdirSync(join(directory, "lib"));
    mkdirSync(join(directory, "bin"));
    for (const path of ["install.sh", ".env.example", "scripts/check-opencode-v2.mjs",
      "lib/opencode-cli.mjs"]) copyFileSync(join(project, path), join(directory, path));
    const binary = join(directory, "bin", "opencode");
    writeFileSync(binary, "#!/bin/sh\nprintf 'opencode 1.19.6\\n'\n");
    chmodSync(binary, 0o755);
    const npm = join(directory, "bin", "npm");
    writeFileSync(npm, `#!/bin/sh
printf '%s\n' "$@" > "$MOCK_NPM_ARGS"
printf '#!/bin/sh\nprintf "2.4.2\\n"\n' > "$MOCK_BIN_DIR/opencode"
chmod 755 "$MOCK_BIN_DIR/opencode"
`);
    chmodSync(npm, 0o755);
    const args = join(directory, "npm-args.txt");
    const result = spawnSync("bash", ["install.sh", "--lang=fr", "--non-interactive",
      "--skip-deps", "--install-opencode"], {
      cwd: directory, encoding: "utf8", env: { ...process.env,
        PATH: `${join(directory, "bin")}:${process.env.PATH}`, OPENCODE_BIN: "opencode",
        MOCK_NPM_ARGS: args, MOCK_BIN_DIR: join(directory, "bin") }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Prérequis OpenCode V2 validé/);
    assert.deepEqual(readFileSync(args, "utf8").trim().split("\n"),
      ["install", "--global", "@opencode/cli@^2"]);
    assert.equal(statSync(join(directory, ".env")).mode & 0o777, 0o600);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("installer rejects contradictory OpenCode options", () => {
  const result = spawnSync("bash", ["install.sh", "--install-opencode", "--skip-opencode"],
    { cwd: project, encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /not both/);
});
