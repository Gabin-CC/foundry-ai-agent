import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FoundryMessageBridge } from "../lib/bridge.mjs";
import { loadState } from "../lib/checkpoint.mjs";

const message = (id, timestamp, user = "u1", content = id, whisper = ["AI"]) =>
  ({ _id: id, timestamp, user, content, whisper });
const quietLogger = { error() {} };

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "foundry-bridge-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, "state.json");
}

function buildBridge({ stateFile, messages, calls, asks, sendReply, allowedSenders,
  clock = () => 5000, resetMsgs = 1000 }) {
  return new FoundryMessageBridge({
    stateFile,
    aiId: "AI",
    usersById: { u1: { name: "Alice", role: 2 }, u2: { name: "Bob", role: 4 } },
    allowedSenders,
    logger: quietLogger,
    clock,
    resetMsgs,
    fetchMessages: async () => messages,
    ask: asks || (async (prompt, sessionId) => {
      calls.push({ prompt, sessionId });
      return { text: "<p>ok</p>", sessionID: sessionId || "ses_one" };
    }),
    sendReply: sendReply || (async (sender, html) => calls.push({ sender, html }))
  });
}

test("existing history is ignored and new whispers run in chronological order", async t => {
  const stateFile = await fixture(t);
  const messages = [message("history", 10)];
  const calls = [];
  const bridge = buildBridge({ stateFile, messages, calls });
  await bridge.initialize();
  messages.push(message("later", 40), message("first", 20), message("second", 30));
  await bridge.poll();
  assert.deepEqual(calls.filter(call => call.sender).map(call => call.sender), ["u1", "u1", "u1"]);
  assert.deepEqual(calls.filter(call => call.prompt).map(call => call.prompt.split("\n")[1]), ["first", "second", "later"]);
  assert.equal((await loadState(stateFile)).lastTimestamp, 40);
});

test("concurrent polls never process one player's message twice", async t => {
  const stateFile = await fixture(t);
  const messages = [message("history", 10)];
  const calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const bridge = buildBridge({
    stateFile, messages, calls,
    asks: async () => {
      calls.push("asked");
      await gate;
      return { text: "<p>ok</p>", sessionID: "ses_one" };
    }
  });
  await bridge.initialize();
  messages.push(message("new", 20));
  const first = bridge.poll();
  await bridge.poll();
  release();
  await first;
  assert.equal(calls.filter(call => call === "asked").length, 1);
  assert.equal(calls.filter(call => call.sender).length, 1);
});

test("a failed reply does not advance the checkpoint and is retried", async t => {
  const stateFile = await fixture(t);
  const messages = [message("history", 10)];
  const calls = [];
  let attempts = 0;
  const bridge = buildBridge({
    stateFile, messages, calls,
    sendReply: async () => {
      attempts++;
      if (attempts === 1) throw new Error("Foundry temporarily unavailable");
    }
  });
  await bridge.initialize();
  messages.push(message("retry-me", 20));
  await assert.rejects(bridge.poll(), /Foundry temporarily unavailable/);
  assert.equal((await loadState(stateFile)).lastTimestamp, 10);
  await bridge.poll();
  assert.equal(attempts, 2);
  assert.equal((await loadState(stateFile)).lastTimestamp, 20);
});

test("restart resumes later messages using the previous OpenCode session", async t => {
  const stateFile = await fixture(t);
  const messages = [message("history", 10)];
  const calls = [];
  const first = buildBridge({ stateFile, messages, calls });
  await first.initialize();
  messages.push(message("one", 20));
  await first.poll();

  const restartCalls = [];
  const restarted = buildBridge({ stateFile, messages, calls: restartCalls });
  await restarted.initialize();
  messages.push(message("two", 30));
  await restarted.poll();
  assert.equal(restartCalls.filter(call => call.prompt).length, 1);
  assert.equal(restartCalls.find(call => call.prompt).sessionId, "ses_one");
  assert.equal((await loadState(stateFile)).threads.u1.count, 2);
});

test("public and disallowed messages are skipped and acknowledged", async t => {
  const stateFile = await fixture(t);
  const messages = [message("history", 10)];
  const calls = [];
  const bridge = buildBridge({ stateFile, messages, calls, allowedSenders: ["u1"] });
  await bridge.initialize();
  messages.push(message("public", 20, "u1", "hello", []));
  messages.push(message("disallowed", 30, "u2"));
  await bridge.poll();
  assert.deepEqual(calls, []);
  assert.equal((await loadState(stateFile)).lastTimestamp, 30);
});

test("players have separate sessions and each session resets at its message limit", async t => {
  const stateFile = await fixture(t);
  const messages = [message("history", 10)];
  const calls = [];
  const bridge = buildBridge({ stateFile, messages, calls, resetMsgs: 2 });
  await bridge.initialize();
  messages.push(message("alice1", 20, "u1"));
  messages.push(message("bob1", 30, "u2"));
  messages.push(message("alice2", 40, "u1"));
  messages.push(message("alice3", 50, "u1"));
  await bridge.poll();

  const requests = calls.filter(call => call.prompt);
  assert.deepEqual(requests.map(call => call.sessionId), [undefined, undefined, "ses_one", undefined]);
  assert.match(requests[1].prompt, /role: GM \(owner\)/);
  const saved = await loadState(stateFile);
  assert.equal(saved.threads.u1.count, 1);
  assert.equal(saved.threads.u2.count, 1);
});
