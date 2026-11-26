import assert from "node:assert/strict";
import { test } from "node:test";
import { checkOpencodeVersion, opencodeRunCommand, parseOpencodeVersion,
  shellQuote } from "../lib/opencode-cli.mjs";

test("OpenCode V2 is required, without a V1 compatibility switch", async () => {
  assert.equal(parseOpencodeVersion("opencode 2.4.2\n").version, "2.4.2");
  assert.equal(parseOpencodeVersion("v2.4.2-beta.1").major, 2);
  assert.throws(() => parseOpencodeVersion("unknown version"), /parse/);
  const mock = version => async (binary, args, options) => {
    assert.equal(binary, "/custom/opencode");
    assert.deepEqual(args, ["--version"]);
    assert.equal(options.timeout, 10000);
    return { stdout: version };
  };
  const version = await checkOpencodeVersion("/custom/opencode", { invoke: mock("opencode 2.4.2") });
  assert.equal(version.major, 2);
  await assert.rejects(checkOpencodeVersion("/custom/opencode", { invoke: mock("1.19.6") }),
    /requires OpenCode V2\.x/);
  await assert.rejects(checkOpencodeVersion("/custom/opencode", { invoke: mock("3.0.0") }),
    /requires OpenCode V2\.x/);
});

test("V2 OpenCode command quotes prompts safely and forwards a V2 session only when provided", () => {
  assert.equal(shellQuote("I can't"), "'I can'\\''t'");
  const start = opencodeRunCommand({ prompt: "Is it 'allowed'?" });
  assert.match(start, /^'opencode' 'run' '--format' 'json'/);
  assert.ok(!start.includes("'--session'"));
  assert.match(start, /'Is it '\\''allowed'\\''\?'/);
  const resume = opencodeRunCommand({ prompt: "Next", sessionId: "ses_123abc" });
  assert.match(resume, /'--session' 'ses_123abc' 'Next'$/);
  assert.throws(() => opencodeRunCommand({ prompt: "Next", sessionId: "not-a-session" }), /Malformed/);
  const isolated = opencodeRunCommand({ prompt: "Hello", standalone: true, agent: "foundry-player" });
  assert.match(isolated, /^'opencode' '--standalone' 'run' '--format' 'json' '--agent' 'foundry-player'/);
  assert.throws(() => opencodeRunCommand({ prompt: "Hello", agent: "player; echo unsafe" }), /Malformed/);
});
