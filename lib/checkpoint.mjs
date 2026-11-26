import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const STATE_VERSION = 1;

export function messageTimestamp(message) {
  const value = message?.timestamp ?? message?._stats?.createdTime;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function orderedMessages(messages) {
  if (!Array.isArray(messages)) throw new TypeError("Expected an array of Foundry chat messages");
  return messages
    .filter(message => typeof message?._id === "string" && messageTimestamp(message) !== null)
    .sort((a, b) => messageTimestamp(a) - messageTimestamp(b) || a._id.localeCompare(b._id));
}

export function emptyState() {
  return { version: STATE_VERSION, opencodeSessionFormat: "v2", lastTimestamp: 0,
    seenAtTimestamp: [], threads: {}, senderCursors: {} };
}

// Older checkpoints may contain V1 OpenCode session IDs. Do not try to
// migrate or reuse them. Retain Foundry cursors to avoid replaying history.
export function discardV1Sessions(state) {
  if (state.opencodeSessionFormat === "v2") return state;
  return { ...state, opencodeSessionFormat: "v2", threads: {} };
}

export function isUnprocessed(state, message) {
  const timestamp = messageTimestamp(message);
  if (timestamp === null || typeof message?._id !== "string") return false;
  return timestamp > state.lastTimestamp ||
    (timestamp === state.lastTimestamp && !state.seenAtTimestamp.includes(message._id));
}

export function advanceState(state, message) {
  const timestamp = messageTimestamp(message);
  if (timestamp === null || !message?._id) throw new TypeError("Message needs an ID and timestamp");
  if (timestamp > state.lastTimestamp) {
    return { ...state, lastTimestamp: timestamp, seenAtTimestamp: [message._id] };
  }
  if (timestamp === state.lastTimestamp && !state.seenAtTimestamp.includes(message._id)) {
    return { ...state, seenAtTimestamp: [...state.seenAtTimestamp, message._id] };
  }
  return state;
}

export function bootstrapState(messages) {
  return orderedMessages(messages).reduce(advanceState, emptyState());
}

// The original global checkpoint becomes the baseline for senders that have
// not yet received a separate cursor. This preserves v1 state after upgrades.
export function cursorForSender(state, sender) {
  return state.senderCursors?.[sender] || {
    lastTimestamp: state.lastTimestamp,
    seenAtTimestamp: state.seenAtTimestamp
  };
}

export function isUnprocessedForSender(state, sender, message) {
  return isUnprocessed(cursorForSender(state, sender), message);
}

export function advanceSenderState(state, sender, message, thread) {
  const nextCursor = advanceState(cursorForSender(state, sender), message);
  return {
    ...state,
    senderCursors: {
      ...state.senderCursors,
      [sender]: { lastTimestamp: nextCursor.lastTimestamp, seenAtTimestamp: nextCursor.seenAtTimestamp }
    },
    threads: thread ? { ...state.threads, [sender]: thread } : state.threads
  };
}

function validateState(state) {
  if (state?.version !== STATE_VERSION || !Number.isFinite(state.lastTimestamp) ||
      state.lastTimestamp < 0 || !Array.isArray(state.seenAtTimestamp) ||
      !state.seenAtTimestamp.every(id => typeof id === "string") ||
      !state.threads || typeof state.threads !== "object" || Array.isArray(state.threads)) {
    throw new Error("Invalid bridge state file (unsupported or corrupted format)");
  }
  if (state.opencodeSessionFormat !== undefined && state.opencodeSessionFormat !== "v2") {
    throw new Error("Invalid bridge state file (unsupported OpenCode session format)");
  }
  if (state.senderCursors !== undefined &&
      (!state.senderCursors || typeof state.senderCursors !== "object" || Array.isArray(state.senderCursors))) {
    throw new Error("Invalid bridge sender cursors");
  }
  for (const cursor of Object.values(state.senderCursors || {})) {
    if (!cursor || !Number.isFinite(cursor.lastTimestamp) || cursor.lastTimestamp < 0 ||
        !Array.isArray(cursor.seenAtTimestamp) ||
        !cursor.seenAtTimestamp.every(id => typeof id === "string")) {
      throw new Error("Invalid bridge sender cursor");
    }
  }
  return { ...state, senderCursors: state.senderCursors || {} };
}

export async function loadState(filePath) {
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  return validateState(JSON.parse(content));
}

export async function saveState(filePath, state) {
  state = validateState(state);
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryFile = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryFile, JSON.stringify(state) + "\n", { mode: 0o600, flag: "wx" });
    await rename(temporaryFile, filePath);
  } finally {
    await unlink(temporaryFile).catch(error => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
