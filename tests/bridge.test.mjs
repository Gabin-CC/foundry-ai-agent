import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
  clock = () => 5000, resetMsgs = 1000, maxConcurrent = 3, fetchMessages }) {
  return new FoundryMessageBridge({
    stateFile,
    aiId: "AI",
    usersById: { u1: { name: "Alice", role: 2 }, u2: { name: "Bob", role: 4 } },
    allowedSenders,
    logger: quietLogger,
    clock,
    resetMsgs,
    maxConcurrent,
    fetchMessages: fetchMessages || (async () => messages),
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
  await bridge.waitForIdle();
  assert.deepEqual(calls.filter(call => call.sender).map(call => call.sender), ["u1", "u1", "u1"]);
  assert.deepEqual(calls.filter(call => call.prompt).map(call => call.prompt.split("\n")[1]), ["first", "second", "later"]);
  assert.equal((await loadState(stateFile)).senderCursors.u1.lastTimestamp, 40);
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
  await bridge.waitForIdle();
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
  await bridge.poll();
  await bridge.waitForIdle();
  assert.equal((await loadState(stateFile)).senderCursors.u1, undefined);
  await bridge.poll();
  await bridge.waitForIdle();
  assert.equal(attempts, 2);
  assert.equal((await loadState(stateFile)).senderCursors.u1.lastTimestamp, 20);
});

test("restart resumes later messages using the previous OpenCode session", async t => {
  const stateFile = await fixture(t);
  const messages = [message("history", 10)];
  const calls = [];
  const first = buildBridge({ stateFile, messages, calls });
  await first.initialize();
  messages.push(message("one", 20));
  await first.poll();
  await first.waitForIdle();

  const restartCalls = [];
  const restarted = buildBridge({ stateFile, messages, calls: restartCalls });
  await restarted.initialize();
  messages.push(message("two", 30));
  await restarted.poll();
  await restarted.waitForIdle();
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
  await bridge.waitForIdle();
  assert.deepEqual(calls, []);
  assert.equal((await loadState(stateFile)).lastTimestamp, 10);
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
  await bridge.waitForIdle();

  const requests = calls.filter(call => call.prompt);
  assert.deepEqual(requests.map(call => call.sessionId), [undefined, undefined, "ses_one", undefined]);
  assert.match(requests[1].prompt, /role: GM \(owner\)/);
  const saved = await loadState(stateFile);
  assert.equal(saved.threads.u1.count, 1);
  assert.equal(saved.threads.u2.count, 1);
});

test("a slow player does not block another player's reply or checkpoint", async t => {
  const stateFile = await fixture(t);
  const messages = [message("history", 10)];
  const calls = [];
  let releaseSlow;
  let notifyFast;
  const slowGate = new Promise(resolve => { releaseSlow = resolve; });
  const fastReply = new Promise(resolve => { notifyFast = resolve; });
  const bridge = buildBridge({
    stateFile, messages, calls,
    asks: async prompt => {
      if (prompt.endsWith("\nslow")) await slowGate;
      return { text: "<p>ok</p>", sessionID: "ses_example" };
    },
    sendReply: async sender => {
      calls.push(sender);
      if (sender === "u2") notifyFast();
    }
  });
  await bridge.initialize();
  messages.push(message("slow-id", 20, "u1", "slow"));
  await bridge.poll();
  // A later poll must enqueue Bob while Alice's earlier request is in flight.
  messages.push(message("fast-id", 30, "u2", "fast"));
  await bridge.poll();
  let timeoutId;
  try {
    await Promise.race([
      fastReply,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Fast player was blocked")), 2000);
      })
    ]);
    // B may have replied before its disk write finished, so wait for it.
    await bridge.persistChain;
    const state = await loadState(stateFile);
    assert.equal(state.senderCursors.u2.lastTimestamp, 30);
    assert.equal(state.senderCursors.u1, undefined);
    assert.deepEqual(calls, ["u2"]);
  } finally {
    clearTimeout(timeoutId);
    releaseSlow();
    await bridge.waitForIdle();
  }
  assert.deepEqual(calls, ["u2", "u1"]);
});

test("MAX_CONCURRENT limits the number of simultaneous OpenCode calls", async t => {
  const stateFile = await fixture(t);
  const messages = [message("history", 10)];
  const calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let active = 0, peak = 0;
  const bridge = buildBridge({
    stateFile, messages, calls, maxConcurrent: 1,
    asks: async () => {
      active++;
      peak = Math.max(peak, active);
      await gate;
      active--;
      return { text: "ok", sessionID: "ses_example" };
    }
  });
  await bridge.initialize();
  messages.push(message("a", 20, "u1"), message("b", 30, "u2"));
  await bridge.poll();
  assert.equal(peak, 1);
  release();
  await bridge.waitForIdle();
  assert.equal(peak, 1);
  assert.equal(calls.filter(call => call.sender).length, 2);
});

test("legacy global checkpoints remain valid after the per-sender upgrade", async t => {
  const stateFile = await fixture(t);
  await writeFile(stateFile, JSON.stringify({
    version: 1,
    lastTimestamp: 100,
    seenAtTimestamp: ["already-done"],
    threads: { u1: { id: "ses_previous", last: 1000, count: 1 } }
  }));
  const messages = [message("already-done", 100, "u1")];
  const calls = [];
  const bridge = buildBridge({ stateFile, messages, calls });
  await bridge.initialize();
  messages.push(message("new-for-u2", 101, "u2"));
  await bridge.poll();
  await bridge.waitForIdle();
  assert.equal(calls.filter(call => call.prompt).length, 1);
  const state = await loadState(stateFile);
  assert.equal(state.threads.u1.id, "ses_previous");
  assert.equal(state.senderCursors.u2.lastTimestamp, 101);
});

test("invalid concurrency limits are rejected before connecting", async t => {
  const stateFile = await fixture(t);
  assert.throws(() => buildBridge({ stateFile, messages: [], calls: [], maxConcurrent: 0 }),
    /MAX_CONCURRENT/);
  assert.throws(() => buildBridge({ stateFile, messages: [], calls: [], maxConcurrent: 17 }),
    /MAX_CONCURRENT/);
});

test("failed replies extend the next chat query back to the failed timestamp", async t => {
  const stateFile = await fixture(t);
  const messages = [message("history", 10)];
  const calls = [];
  const fetchArguments = [];
  let failures = 1;
  const bridge = buildBridge({
    stateFile, messages, calls,
    fetchMessages: async since => { fetchArguments.push(since); return messages; },
    sendReply: async () => {
      if (failures--) throw new Error("Temporary failure");
    }
  });
  await bridge.initialize();
  messages.push(message("retry", 20));
  await bridge.poll();
  await bridge.waitForIdle();
  await bridge.poll();
  await bridge.waitForIdle();
  assert.equal(fetchArguments[2], 20);
  assert.equal((await loadState(stateFile)).senderCursors.u1.lastTimestamp, 20);
});
