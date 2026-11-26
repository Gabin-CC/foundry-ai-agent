#!/usr/bin/env node
// Read-only CLI prerequisite check. Does not start a model, MCP or Foundry.
import { checkOpencodeVersion } from "../lib/opencode-cli.mjs";

const usage = "Usage: npm run check:opencode:v2 -- [--binary /path/to/opencode] [--json]\n";
async function main(argv) {
  let binary = process.env.OPENCODE_BIN || "opencode", json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--binary" && argv[i + 1]) binary = argv[++i];
    else if (argv[i] === "--json") json = true;
    else if (argv[i] === "--help") { process.stdout.write(usage); return; }
    else throw new Error(`Unknown or incomplete option: ${argv[i]}`);
  }
  const version = await checkOpencodeVersion(binary);
  if (json) process.stdout.write(JSON.stringify({ binary, ...version, compatible: true }) + "\n");
  else process.stdout.write(`OpenCode ${version.version}: V2 CLI prerequisite satisfied (${binary})\n`);
  process.stdout.write(json ? "" : "This does not verify model calls or MCP connectivity. Old V1 sessions are not reused.\n");
}

main(process.argv.slice(2)).catch(error => {
  process.stderr.write(`${error.message}\n${usage}`);
  process.exitCode = 1;
});
