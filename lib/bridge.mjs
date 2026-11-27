import {
  advanceSenderState, bootstrapState, discardV1Sessions, isUnprocessedForSender, loadState,
  messageTimestamp, orderedMessages, saveState
} from "./checkpoint.mjs";
import { accessRole } from "./rules-access.mjs";

const roleLabel = role => role === 4 ? "GM (owner)" : role === 3 ? "Assistant GM" : "player";
const stripHtml = text => String(text || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

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
    maxReply = 4000, maxConcurrent = 3, clock = Date.now, logger = console,
    replyGuard = null, getAccessRevision = async () => null }) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 16) {
      throw new RangeError("MAX_CONCURRENT must be an integer between 1 and 16");
    }
    this.fetchMessages = fetchMessages;
    this.sendReply = sendReply;
    this.ask = ask;
    this.replyGuard = replyGuard;
    this.getAccessRevision = getAccessRevision;
    this.aiId = aiId;
    this.usersById = usersById;
    this.allowedSenders = new Set(allowedSenders);
    this.stateFile = stateFile;
    this.resetMs = resetMs;
    this.resetMsgs = resetMsgs;
    this.maxReply = maxReply;
    this.maxConcurrent = maxConcurrent;
    this.clock = clock;
    this.logger = logger;
    this.state = null;
    this.polling = false;
    this.queues = new Map();
    this.pendingIds = new Set();
    this.failedTimestamps = new Map();
    this.activeSenders = new Set();
    this.workers = new Set();
    this.persistChain = Promise.resolve();
  }

  async initialize() {
    const saved = await loadState(this.stateFile);
    if (saved) {
      this.state = discardV1Sessions(saved);
      if (this.state !== saved) {
        await saveState(this.stateFile, this.state);
        this.logger.error("[agent] discarded old OpenCode V1 sessions; preserved Foundry chat cursors");
      }
      this.logger.error(`[agent] resumed from chat baseline ${saved.lastTimestamp}`);
      return;
    }
    // First installation: existing messages are history, not new requests.
    const history = await this.fetchMessages();
    this.state = bootstrapState(history);
    await saveState(this.stateFile, this.state);
    this.logger.error(`[agent] initialized checkpoint from ${history.length} existing messages`);
  }

  // Polling only discovers work. Long OpenCode calls run in background workers.
  async poll() {
    if (!this.state) throw new Error("Bridge must be initialized before polling");
    if (this.polling) return;
    this.polling = true;
    try {
      const failedSince = this.failedTimestamps.size
        ? Math.min(...this.failedTimestamps.values()) : null;
      const messages = await this.fetchMessages(failedSince);
      // Filter before sorting; the MCP API still fetches the full chat history.
      const addressed = messages.filter(message => message?.whisper?.includes(this.aiId));
      const missingTimestamps = addressed.filter(message =>
        message?._id && messageTimestamp(message) === null).length;
      if (missingTimestamps) {
        this.logger.error(`[agent] skipped ${missingTimestamps} whispers without timestamps`);
      }
      for (const message of orderedMessages(addressed)) {
        const sender = senderId(message);
        if (!sender || (this.allowedSenders.size && !this.allowedSenders.has(sender))) continue;
        if (this.pendingIds.has(message._id) ||
            !isUnprocessedForSender(this.state, sender, message)) continue;
        let queue = this.queues.get(sender);
        if (!queue) {
          queue = [];
          this.queues.set(sender, queue);
        }
        queue.push(message);
        this.pendingIds.add(message._id);
      }
      this.schedule();
    } finally {
      this.polling = false;
    }
  }

  schedule() {
    for (const [sender, queue] of this.queues) {
      if (this.activeSenders.size >= this.maxConcurrent) break;
      if (!queue.length || this.activeSenders.has(sender)) continue;
      this.activeSenders.add(sender);
      const worker = this.drain(sender, queue);
      this.workers.add(worker);
      void worker.catch(error => this.logger.error("[agent] worker failed", error))
        .finally(() => this.workers.delete(worker));
    }
  }

  async drain(sender, queue) {
    try {
      while (queue.length) {
        const message = queue[0];
        try {
          const thread = await this.handleMessage(sender, message);
          await this.persistProgress(sender, message, thread);
          queue.shift();
          this.pendingIds.delete(message._id);
          this.failedTimestamps.delete(message._id);
        } catch (error) {
          this.logger.error(`[agent] message ${message._id} failed; will retry on next poll`, error);
          this.failedTimestamps.set(message._id, messageTimestamp(message));
          // Later requests from this sender must not overtake a failed request.
          for (const pending of queue) this.pendingIds.delete(pending._id);
          queue.length = 0;
          break;
        }
      }
    } finally {
      this.queues.delete(sender);
      this.activeSenders.delete(sender);
      this.schedule();
    }
  }

  // Each sender has an independent checkpoint; disk writes are serialized so
  // concurrent workers cannot overwrite each other's progress or sessions.
  persistProgress(sender, message, thread) {
    const operation = this.persistChain.then(async () => {
      const nextState = advanceSenderState(this.state, sender, message, thread);
      await saveState(this.stateFile, nextState);
      this.state = nextState;
    });
    this.persistChain = operation.catch(() => {});
    return operation;
  }

  async handleMessage(sender, message) {
    const text = stripHtml(message.content);
    if (!text) return this.state.threads[sender] || null;

    const info = this.usersById[sender] || { name: "?", role: 2 };
    this.logger.error(`[agent] message from ${info.name} (${roleLabel(info.role)}), ${text.length} characters`);

    let thread = this.state.threads[sender];
    const now = this.clock();
    const role = accessRole(info.role);
    const accessRevision = role === "player" ? await this.getAccessRevision() : null;
    // A downgraded GM must never resume a conversation that has already seen
    // GM-only source passages. Pre-policy sessions also start fresh once.
    if (thread && (thread.accessRole !== role ||
        (role === "player" && thread.accessRevision !== accessRevision))) {
      this.logger.error(`[agent] reset conversation after role/policy change for ${info.name}`);
      thread = null;
    }
    if (thread && (now - thread.last > this.resetMs || thread.count >= this.resetMsgs)) {
      this.logger.error(`[agent] reset conversation for ${info.name}`);
      thread = null;
    }
    const prompt = `[Sender: ${info.name}]\n${text}`;
    // A failed/incomplete OpenCode call does not consume the player's message.
    // The worker retries it on the next poll with the previous session ID.
    const result = await this.ask(prompt, thread?.id, { role: info.role });
    const output = String(result?.text || "");
    const sessionId = result?.sessionID || thread?.id;
    const toolCalls = result?.ruleCalls || [];
    if (!output.trim() || !sessionId) throw new Error("Incomplete OpenCode V2 response; retrying");

    let reply = output.slice(0, this.maxReply) || "<p>(no output)</p>";
    if (this.replyGuard) {
      try { reply = await this.replyGuard({ question: text, reply, toolCalls, role: info.role }); }
      catch (error) {
        this.logger.error("[agent] rules citation guard failed", error);
        reply = "<p>Rules citation verification unavailable. Please check the indexed rulebooks.</p>";
      }
    }
    await this.sendReply(sender, reply.slice(0, this.maxReply));
    this.logger.error(`[agent] private reply -> ${info.name} (session=${sessionId})`);
    return { id: sessionId || null, last: now, count: thread ? thread.count + 1 : 1,
      accessRole: role, accessRevision };
  }

  async waitForIdle() {
    while (this.workers.size) await Promise.allSettled([...this.workers]);
  }
}
