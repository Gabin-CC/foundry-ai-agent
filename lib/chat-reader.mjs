import { messageTimestamp } from "./checkpoint.mjs";

const DEFAULT_RESYNC_MS = 120000;
const DEFAULT_LOOKBACK_MS = 120000;

/**
 * Read Foundry chat safely. The FoundrySession client forwards query objects,
 * but server-side comparison operators are not guaranteed across versions.
 * Verify filtering against real chat history before relying on it, and always
 * keep periodic full reads as a safety net.
 */
export class ChatHistoryReader {
  constructor({ read, clock = Date.now, logger = console, filterMode = "auto",
    resyncMs = DEFAULT_RESYNC_MS, lookbackMs = DEFAULT_LOOKBACK_MS }) {
    if (!["auto", "off"].includes(filterMode)) throw new Error("CHAT_FILTER_MODE must be auto or off");
    if (!Number.isFinite(resyncMs) || resyncMs < 1000 ||
        !Number.isFinite(lookbackMs) || lookbackMs < 1000) {
      throw new Error("Chat polling intervals must be at least 1000 ms");
    }
    this.read = read;
    this.clock = clock;
    this.logger = logger;
    this.filterMode = filterMode;
    this.resyncMs = resyncMs;
    this.lookbackMs = lookbackMs;
    this.filterStatus = filterMode === "off" ? "disabled" : "unknown";
    this.lastFullAt = null;
    this.lastObservedTimestamp = 0;
  }

  observe(messages) {
    for (const message of messages) {
      const timestamp = messageTimestamp(message);
      if (timestamp !== null) this.lastObservedTimestamp = Math.max(this.lastObservedTimestamp, timestamp);
    }
  }

  async readFull() {
    const messages = await this.read({});
    if (!Array.isArray(messages)) throw new TypeError("Foundry chat query did not return an array");
    this.lastFullAt = this.clock();
    this.observe(messages);
    if (this.filterStatus === "unknown") await this.verifyFilter(messages);
    return messages;
  }

  async verifyFilter(messages) {
    const timestamps = messages.map(messageTimestamp).filter(t => t !== null);
    if (timestamps.length < 2) return;
    const latest = timestamps.reduce((max, timestamp) => Math.max(max, timestamp), 0);
    if (!timestamps.some(t => t < latest)) return;

    const expected = messages.filter(m => messageTimestamp(m) === latest)
      .map(m => m._id).filter(Boolean).sort();
    try {
      const result = await this.read({ timestamp: { $gte: latest } });
      if (!Array.isArray(result)) throw new TypeError("Filtered chat query did not return an array");
      const actual = result.map(m => m._id).filter(Boolean).sort();
      if (expected.length && JSON.stringify(actual) === JSON.stringify(expected)) {
        this.filterStatus = "enabled";
        this.logger.error("[agent] verified server-side chat timestamp filtering");
      } else {
        this.filterStatus = "disabled";
        this.logger.error("[agent] chat timestamp filtering unsupported; using full polling");
      }
    } catch (error) {
      this.filterStatus = "disabled";
      this.logger.error(`[agent] chat timestamp filter unavailable: ${error.message}`);
    }
  }

  async fetch(failedSince = null) {
    if (this.filterStatus !== "enabled" || this.lastFullAt === null ||
        this.clock() - this.lastFullAt >= this.resyncMs) {
      return this.readFull();
    }

    // Follow the server's observed timestamps, not local wall-clock time.
    // Keep an overlap for equal timestamps and delayed message delivery.
    let since = Math.max(0, this.lastObservedTimestamp - this.lookbackMs);
    if (Number.isFinite(failedSince) && failedSince >= 0) since = Math.min(since, failedSince);
    try {
      const result = await this.read({ timestamp: { $gte: since } });
      if (!Array.isArray(result) || result.some(m => {
        const t = messageTimestamp(m);
        return t === null || t < since;
      })) {
        throw new Error("Foundry did not respect the timestamp filter");
      }
      this.observe(result);
      return result;
    } catch (error) {
      this.filterStatus = "disabled";
      this.logger.error(`[agent] disabling chat filter after failed query: ${error.message}`);
      return this.readFull();
    }
  }
}
