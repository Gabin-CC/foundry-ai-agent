import assert from "node:assert/strict";
import { test } from "node:test";
import { foundryModuleSpecifier, DEFAULT_FOUNDRY_MODULE } from "../lib/foundry-module.mjs";
import { checkFoundryConnection } from "../lib/smoke-check.mjs";

test("default and legacy package specifiers use the Foundry client, not the server", () => {
  assert.equal(foundryModuleSpecifier(), DEFAULT_FOUNDRY_MODULE);
  assert.equal(foundryModuleSpecifier("foundry-vtt-mcp-server"), DEFAULT_FOUNDRY_MODULE);
  assert.equal(foundryModuleSpecifier("/opt/foundry/src/foundry.mjs"), "/opt/foundry/src/foundry.mjs");
});

test("smoke check reads users and chat without writing and closes the session", async () => {
  const calls = [];
  const session = {
    userId: "assistant",
    async doc(action, type, options) {
      calls.push([action, type, options]);
      return type === "User" ? [{ _id: "assistant" }, { _id: "gm" }] : [{ _id: "msg" }];
    },
    async close() { calls.push(["close"]); }
  };
  const result = await checkFoundryConnection({
    login: async (username, password, options) => {
      assert.equal(username, "AI");
      assert.equal(password, "test-password");
      assert.deepEqual(options, { adminPassword: "admin" });
      return session;
    },
    username: "AI",
    password: "test-password",
    adminPassword: "admin"
  });
  assert.deepEqual(result, { userCount: 2, messageCount: 1 });
  assert.deepEqual(calls, [
    ["get", "User", { query: {} }],
    ["get", "ChatMessage", { query: {} }],
    ["close"]
  ]);
});

test("smoke check rejects failed login", async () => {
  await assert.rejects(checkFoundryConnection({
    login: async () => null,
    username: "AI",
    password: "wrong"
  }), /login failed/);
});

test("smoke check rejects unexpected data and still closes the session", async () => {
  let closed = false;
  await assert.rejects(checkFoundryConnection({
    login: async () => ({
      userId: "assistant",
      doc: async () => null,
      close: async () => { closed = true; }
    }),
    username: "AI",
    password: "secret"
  }), /did not return a list/);
  assert.equal(closed, true);
});

test("smoke check propagates query failures and still closes the session", async () => {
  let closed = false;
  await assert.rejects(checkFoundryConnection({
    login: async () => ({
      userId: "assistant",
      doc: async (_action, type) => {
        if (type === "ChatMessage") throw new Error("Foundry connection lost");
        return [];
      },
      close: async () => { closed = true; }
    }),
    username: "AI",
    password: "secret"
  }), /connection lost/);
  assert.equal(closed, true);
});
