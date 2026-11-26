import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { rm } from "node:fs/promises";
import {
  advanceSenderState, advanceState, bootstrapState, cursorForSender,
  emptyState, isUnprocessed, isUnprocessedForSender, loadState,
  messageTimestamp, orderedMessages, saveState
} from "../lib/checkpoint.mjs";

const message = (id, timestamp) => ({ _id: id, timestamp });

test("messages are ordered by timestamp and deterministically within a timestamp", () => {
  const ordered = orderedMessages([message("b", 20), message("z", 10), message("a", 20)]);
  assert.deepEqual(ordered.map(item => item._id), ["z", "a", "b"]);
  assert.equal(messageTimestamp({ _stats: { createdTime: 42 } }), 42);
  assert.equal(messageTimestamp({ timestamp: null }), null);
});

test("bootstrap skips existing history without losing same-timestamp arrivals", () => {
  const state = bootstrapState([message("b", 20), message("z", 10), message("a", 20)]);
  assert.equal(state.lastTimestamp, 20);
  assert.deepEqual(state.seenAtTimestamp, ["a", "b"]);
  assert.equal(isUnprocessed(state, message("b", 20)), false);
  assert.equal(isUnprocessed(state, message("new", 20)), true);

  const advanced = advanceState(state, message("new", 20));
  assert.equal(isUnprocessed(advanced, message("new", 20)), false);
  assert.equal(isUnprocessed(advanced, message("older", 10)), false);
  assert.equal(isUnprocessed(advanced, message("future", 21)), true);
  assert.deepEqual(advanceState(advanced, message("future", 21)).seenAtTimestamp, ["future"]);
});

test("independent sender cursors do not advance one another", () => {
  const baseline = bootstrapState([message("old", 10)]);
  const alice = advanceSenderState(baseline, "alice", message("a", 20), { id: "ses_a", last: 1, count: 1 });
  assert.equal(cursorForSender(alice, "alice").lastTimestamp, 20);
  assert.equal(cursorForSender(alice, "bob").lastTimestamp, 10);
  assert.equal(isUnprocessedForSender(alice, "bob", message("b", 15)), true);

  const both = advanceSenderState(alice, "bob", message("b", 15), { id: "ses_b", last: 2, count: 1 });
  assert.equal(cursorForSender(both, "alice").lastTimestamp, 20);
  assert.equal(cursorForSender(both, "bob").lastTimestamp, 15);
  assert.equal(isUnprocessedForSender(both, "alice", message("a", 20)), false);
});

test("state is stored atomically and can be loaded after restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "foundry-checkpoint-"));
  const path = join(directory, "state", "bridge.json");
  try {
    assert.equal(await loadState(path), null);
    const original = { ...advanceState(emptyState(), message("one", 100)), threads: {
      user1: { id: "ses_example", last: 1000, count: 1 }
    } };
    await saveState(path, original);
    assert.deepEqual(await loadState(path), original);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(path, "utf8")).threads.user1.id, "ses_example");
    await writeFile(path, '{"invalid":true}');
    await assert.rejects(loadState(path), /Invalid bridge state/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
