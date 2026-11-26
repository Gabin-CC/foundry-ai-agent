import assert from "node:assert/strict";
import { test } from "node:test";
import { ChatHistoryReader } from "../lib/chat-reader.mjs";

const message = (id, timestamp) => ({ _id: id, timestamp, whisper: ["AI"] });
const quietLogger = { error() {} };

function makeSource(initial, { ignoreFilter = false, rejectFilter = false } = {}) {
  const messages = [...initial];
  const queries = [];
  const read = async query => {
    queries.push(query);
    if (query.timestamp && rejectFilter) throw new Error("Unsupported query");
    if (!query.timestamp || ignoreFilter) return [...messages];
    return messages.filter(m => m.timestamp >= query.timestamp.$gte);
  };
  return { messages, queries, read };
}

test("a matching timestamp probe enables smaller incremental chat reads", async () => {
  const source = makeSource([
    message("old", 1000000), message("middle", 1010000), message("recent", 1020000)
  ]);
  const reader = new ChatHistoryReader({
    read: source.read, logger: quietLogger, clock: () => 1000,
    lookbackMs: 1000, resyncMs: 10000
  });
  assert.equal((await reader.fetch()).length, 3);
  assert.equal(reader.filterStatus, "enabled");
  source.messages.push(message("new", 1020500));
  assert.deepEqual((await reader.fetch()).map(m => m._id), ["recent", "new"]);
  assert.deepEqual(source.queries[2], { timestamp: { $gte: 1019000 } });
});

test("an ignored query operator is detected and full polling is preserved", async () => {
  const source = makeSource([message("old", 10), message("new", 20)], { ignoreFilter: true });
  const reader = new ChatHistoryReader({ read: source.read, logger: quietLogger });
  await reader.fetch();
  assert.equal(reader.filterStatus, "disabled");
  assert.deepEqual((await reader.fetch()).map(m => m._id), ["old", "new"]);
  assert.deepEqual(source.queries[2], {});
});

test("failed filter probes disable optimization without failing normal reads", async () => {
  const source = makeSource([message("old", 10), message("new", 20)], { rejectFilter: true });
  const reader = new ChatHistoryReader({ read: source.read, logger: quietLogger });
  assert.equal((await reader.fetch()).length, 2);
  assert.equal(reader.filterStatus, "disabled");
  assert.equal((await reader.fetch()).length, 2);
});

test("a periodic full rescan catches messages independently of the filter", async () => {
  const source = makeSource([message("old", 1000000), message("latest", 1020000)]);
  let now = 0;
  const reader = new ChatHistoryReader({
    read: source.read, logger: quietLogger, clock: () => now,
    lookbackMs: 1000, resyncMs: 5000
  });
  await reader.fetch();
  source.messages.push(message("new", 1021000));
  now = 6000;
  assert.deepEqual((await reader.fetch()).map(m => m._id), ["old", "latest", "new"]);
  assert.deepEqual(source.queries[2], {});
});

test("failed messages can force a wider lookback until they are retried", async () => {
  const source = makeSource([message("old", 20000), message("latest", 50000)]);
  const reader = new ChatHistoryReader({
    read: source.read, logger: quietLogger, clock: () => 0,
    lookbackMs: 1000, resyncMs: 60000
  });
  await reader.fetch();
  assert.deepEqual((await reader.fetch(20000)).map(m => m._id), ["old", "latest"]);
  assert.deepEqual(source.queries[2], { timestamp: { $gte: 20000 } });
});

test("a filter that stops respecting its boundary falls back to a full read", async () => {
  const source = makeSource([message("old", 1000000), message("latest", 1020000)]);
  const reader = new ChatHistoryReader({
    read: source.read, logger: quietLogger, clock: () => 0,
    lookbackMs: 1000, resyncMs: 60000
  });
  await reader.fetch();
  const originalRead = reader.read;
  reader.read = query => query.timestamp ? Promise.resolve([...source.messages]) : originalRead(query);
  assert.equal((await reader.fetch()).length, 2);
  assert.equal(reader.filterStatus, "disabled");
});

test("without enough chat history, the safe full-read mode remains active", async () => {
  const source = makeSource([message("only", 10)]);
  const reader = new ChatHistoryReader({ read: source.read, logger: quietLogger });
  await reader.fetch();
  assert.equal(reader.filterStatus, "unknown");
  await reader.fetch();
  assert.deepEqual(source.queries, [{}, {}]);
});

test("explicit off mode never probes or attempts filtered queries", async () => {
  const source = makeSource([message("old", 10), message("new", 20)]);
  const reader = new ChatHistoryReader({
    read: source.read, logger: quietLogger, filterMode: "off"
  });
  await reader.fetch();
  await reader.fetch();
  assert.equal(reader.filterStatus, "disabled");
  assert.deepEqual(source.queries, [{}, {}]);
});
