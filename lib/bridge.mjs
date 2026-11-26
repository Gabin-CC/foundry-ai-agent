import {
  advanceState, bootstrapState, isUnprocessed, loadState, messageTimestamp,
  orderedMessages, saveState
} from "./checkpoint.mjs";

const roleLabel = role => role === 4 ? "GM (owner)" : role === 3 ? "Assistant GM" : "player";
const stripHtml = text => String(text || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const escapeHtml = text => String(text).replace(/[<>&]/g, char => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[char]));

function senderId(message) {
  const author = message.author;
  if (typeof author === "string") return author;
  if (typeof author?._id === "string") return author._id;
  if (typeof message.user === "string") return message.user;
  return message.user?._id;
}

export class FoundryMessageBridge {
  constructor({ fetchMessages, sendReply, ask, aiId, usersById = {},
    allowedSenders = [], stateFile, resetMs = 86400000, resetMsgs = 1000,
    maxReply = 4000, clock = Date.now, logger = console }) {
    this.fetchMessages = fetchMessages;
    this.sendReply = sendReply;
    this.ask = ask;
    this.aiId = aiId;
    this.usersById = usersById;
    this.allowedSenders = new Set(allowedSenders);
    this.stateFile = stateFile;
    this.resetMs = resetMs;
    this.resetMsgs = resetMsgs;
    this.maxReply = maxReply;
    this.clock = clock;
    this.logger = logger;
    this.state = null;
    this.polling = false;
  }

  async initialize() {
    const saved = await loadState(this.stateFile);
    if (saved) {
      this.state = saved;
      this.logger.error(`[agent] resumed at chat timestamp ${saved.lastTimestamp}`);
      return;
    }
    // First installation: treat existing chat messages as history, not new requests.
    const history = await this.fetchMessages();
    this.state = bootstrapState(history);
    await saveState(this.stateFile, this.state);
    this.logger.error(`[agent] initialized checkpoint from ${history.length} existing messages`);
  }

  async poll() {
    if (!this.state) throw new Error("Bridge must be initialized before polling");
    if (this.polling) return; // No overlapping polls or simultaneous sender sessions.
    this.polling = true;
    try {
      const messages = await this.fetchMessages();
      const missingTimestamps = messages.filter(message =>
        message?._id && messageTimestamp(message) === null).length;
      if (missingTimestamps) {
        this.logger.error(`[agent] skipped ${missingTimestamps} chat messages without timestamps`);
      }
      for (const message of orderedMessages(messages)) {
        if (!isUnprocessed(this.state, message)) continue;
        // sendReply must succeed before advancing the durable checkpoint.
        const threadUpdate = await this.handleMessage(message);
        let nextState = advanceState(this.state, message);
        if (threadUpdate) {
          nextState = {
            ...nextState,
            threads: { ...nextState.threads, [threadUpdate.sender]: threadUpdate.thread }
          };
        }
        await saveState(this.stateFile, nextState);
        this.state = nextState;
      }
    } finally {
      this.polling = false;
    }
  }

  async handleMessage(message) {
    if (!Array.isArray(message.whisper) || !message.whisper.includes(this.aiId)) return null;
    const sender = senderId(message);
    if (!sender || (this.allowedSenders.size && !this.allowedSenders.has(sender))) return null;
    const text = stripHtml(message.content);
    if (!text) return null;

    const info = this.usersById[sender] || { name: "?", role: 2 };
    this.logger.error(`[agent] message from ${info.name} (${roleLabel(info.role)}), ${text.length} characters`);

    let thread = this.state.threads[sender];
    const now = this.clock();
    if (thread && (now - thread.last > this.resetMs || thread.count >= this.resetMsgs)) {
      this.logger.error(`[agent] reset conversation for ${info.name}`);
      thread = null;
    }
    const prompt = `[Sender: ${info.name} — role: ${roleLabel(info.role)}]\n${text}`;
    let output = "", sessionId = thread?.id;
    try {
      const result = await this.ask(prompt, sessionId);
      output = String(result.text || "");
      sessionId = result.sessionID || sessionId;
    } catch (error) {
      this.logger.error(`[agent] OpenCode failed: ${String(error.message || error).slice(0, 300)}`);
      output = `<p>OpenCode error: ${escapeHtml(String(error.message || "Request failed").slice(0, 300))}</p>`;
    }

    await this.sendReply(sender, output.slice(0, this.maxReply) || "<p>(no output)</p>");
    this.logger.error(`[agent] private reply -> ${info.name} (session=${sessionId})`);
    return { sender, thread: { id: sessionId || null, last: now, count: thread ? thread.count + 1 : 1 } };
  }
}
