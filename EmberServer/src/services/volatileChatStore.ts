import { EventEmitter } from "events";
import { config } from "../config";

export interface VolatileMessage {
  id: string;
  chatId: string;
  senderId: string;
  text?: string;
  sentAt: string; // ISO 8601
}

export interface VolatileChatMeta {
  id: string;
  parentChatId: string;
  participantIds: string[];
  createdByUserId: string;
  createdAt: string;
  inactivityTimeoutSeconds: number;
  expiresAt: string;
}

/**
 * Why the clearance countdown started. It decides what can cancel it:
 *  - "inactivity": no messages for the timeout. A new message cancels it.
 *  - "empty": nobody has had the chat open for the grace period.
 *    Someone opening it again cancels it.
 *  - "ended": a participant tapped End Breakout. Only Keep Chat stops it.
 */
export type WarningReason = "inactivity" | "empty" | "ended";

export type VolatileChatEvent =
  | { type: "message"; chatId: string; message: VolatileMessage }
  | { type: "expiryWarning"; chatId: string; secondsRemaining: number; reason: WarningReason }
  | { type: "warningCancelled"; chatId: string }
  | { type: "purged"; chatId: string }
  | { type: "promoted"; chatId: string };

export type PromotionHandler = (
  messages: VolatileMessage[],
  chat: VolatileChatMeta
) => Promise<void>;

export interface VolatileChatStoreOptions {
  warningWindowSeconds: number;
  /** How long a chat may have zero viewers before the warning starts. */
  emptyGraceSeconds: number;
}

/**
 * Non-persistent, in-process store for breakout chat messages. This is
 * the server-side mirror of the client's `VolatileChatStore` actor:
 * same lifecycle (register -> append/resetExpiry -> warning window ->
 * purge or promote), same guarantee that message content is *only* ever
 * held in this process's memory and is never written to the database
 * unless `promote()` is explicitly called.
 *
 * The server is the single source of truth for this lifecycle. Clients
 * should render the `expiryWarning` / `warningCancelled` / `purged` /
 * `promoted` events they receive rather than running their own timers,
 * so every participant sees the same countdown.
 *
 * NOTE: this is process-local state. A restart clears every live
 * breakout (which is in the spirit of the feature, but worth knowing),
 * and if you deploy more than one server instance you must either route
 * a given breakout chat's traffic to a single instance (sticky sessions
 * or consistent hashing on chatId) or swap this for a Redis-backed
 * implementation behind the same interface.
 */
export class VolatileChatStore extends EventEmitter {
  private messagesByChat = new Map<string, VolatileMessage[]>();
  private chatsById = new Map<string, VolatileChatMeta>();
  private expiryTimers = new Map<string, NodeJS.Timeout>();
  private warningIntervals = new Map<string, NodeJS.Timeout>();
  private warningReasons = new Map<string, WarningReason>();
  /** chatId -> userId -> number of open connections viewing it. */
  private viewers = new Map<string, Map<string, number>>();
  private emptyTimers = new Map<string, NodeJS.Timeout>();
  private promoting = new Set<string>();

  private readonly warningWindowSeconds: number;
  private readonly emptyGraceSeconds: number;

  constructor(options: VolatileChatStoreOptions) {
    super();
    this.warningWindowSeconds = options.warningWindowSeconds;
    this.emptyGraceSeconds = options.emptyGraceSeconds;
    this.setMaxListeners(0);
  }

  register(meta: VolatileChatMeta): void {
    this.chatsById.set(meta.id, meta);
    if (!this.messagesByChat.has(meta.id)) {
      this.messagesByChat.set(meta.id, []);
    }
    this.scheduleExpiry(meta.id);
    // Nobody is viewing it yet. If nobody opens it within the grace
    // period, it should not sit in memory for the full inactivity timeout.
    this.scheduleEmptyCheck(meta.id);
  }

  chat(chatId: string): VolatileChatMeta | undefined {
    return this.chatsById.get(chatId);
  }

  messages(chatId: string): VolatileMessage[] {
    return this.messagesByChat.get(chatId) ?? [];
  }

  activeChatCount(): number {
    return this.chatsById.size;
  }

  /** Live breakouts started from `parentChatId`. */
  chatsForParent(parentChatId: string): VolatileChatMeta[] {
    return [...this.chatsById.values()].filter((meta) => meta.parentChatId === parentChatId);
  }

  /** Current countdown reason, or undefined if no countdown is running. */
  warningReason(chatId: string): WarningReason | undefined {
    return this.warningReasons.get(chatId);
  }

  viewerCount(chatId: string): number {
    return this.viewers.get(chatId)?.size ?? 0;
  }

  /** Subscribe to lifecycle events for one chat. Returns an unsubscribe fn. */
  onChatEvent(chatId: string, listener: (event: VolatileChatEvent) => void): () => void {
    const channel = `chat:${chatId}`;
    this.on(channel, listener);
    return () => this.off(channel, listener);
  }

  private emitChatEvent(chatId: string, event: VolatileChatEvent) {
    this.emit(`chat:${chatId}`, event);
  }

  append(chatId: string, message: VolatileMessage): void {
    if (!this.chatsById.has(chatId)) return;
    const list = this.messagesByChat.get(chatId) ?? [];
    list.push(message);
    this.messagesByChat.set(chatId, list);
    this.emitChatEvent(chatId, { type: "message", chatId, message });
    // People are still talking, so an inactivity countdown no longer applies.
    if (this.warningReasons.get(chatId) === "inactivity") this.cancelWarning(chatId);
    this.resetExpiry(chatId);
  }

  /** Explicit "End Breakout": skips straight to the warning window. */
  requestEnd(chatId: string): void {
    // An explicit end outranks a softer countdown that is already running.
    const current = this.warningReasons.get(chatId);
    if (current && current !== "ended") this.cancelWarning(chatId, { silent: true });
    this.beginWarningWindow(chatId, "ended");
  }

  /** Transport layer reports zero active viewers left. */
  allParticipantsLeft(chatId: string): void {
    this.beginWarningWindow(chatId, "empty");
  }

  /**
   * A participant opened the chat (one call per connection). If the
   * countdown was only running because the room was empty, it stops.
   */
  viewerJoined(chatId: string, userId: string): void {
    if (!this.chatsById.has(chatId)) return;
    const byUser = this.viewers.get(chatId) ?? new Map<string, number>();
    byUser.set(userId, (byUser.get(userId) ?? 0) + 1);
    this.viewers.set(chatId, byUser);

    this.clearEmptyTimer(chatId);
    if (this.warningReasons.get(chatId) === "empty") this.cancelWarning(chatId);
  }

  /**
   * A participant's connection closed or unsubscribed. Once nobody is
   * left, wait `emptyGraceSeconds` (to ride out app switches and flaky
   * networks) and then start the clearance warning.
   */
  viewerLeft(chatId: string, userId: string): void {
    const byUser = this.viewers.get(chatId);
    if (!byUser) return;
    const remaining = (byUser.get(userId) ?? 0) - 1;
    if (remaining > 0) byUser.set(userId, remaining);
    else byUser.delete(userId);

    if (byUser.size === 0) {
      this.viewers.delete(chatId);
      this.scheduleEmptyCheck(chatId);
    }
  }

  /**
   * Hands the full history to `handler` (expected to write to the DB),
   * then purges memory. Callable at any point, not just during the
   * warning window ("Keep Chat" / mid-conversation save). If the
   * handler throws, nothing is purged and the error propagates, so the
   * caller can retry. Concurrent calls for the same chat are ignored
   * while the first one is in flight.
   */
  async promote(chatId: string, handler: PromotionHandler): Promise<VolatileMessage[]> {
    const meta = this.chatsById.get(chatId);
    if (!meta || this.promoting.has(chatId)) return this.messages(chatId);
    this.promoting.add(chatId);
    try {
      const history = [...this.messages(chatId)];
      await handler(history, meta);
      this.emitChatEvent(chatId, { type: "promoted", chatId });
      this.purge(chatId);
      return history;
    } finally {
      this.promoting.delete(chatId);
    }
  }

  /** Hard delete: removes all message content + metadata from memory. */
  purge(chatId: string): void {
    if (!this.chatsById.has(chatId)) return;
    this.messagesByChat.delete(chatId);
    this.chatsById.delete(chatId);
    this.clearTimer(this.expiryTimers, chatId);
    this.clearEmptyTimer(chatId);
    const warning = this.warningIntervals.get(chatId);
    if (warning) clearInterval(warning);
    this.warningIntervals.delete(chatId);
    this.warningReasons.delete(chatId);
    this.viewers.delete(chatId);
    this.emitChatEvent(chatId, { type: "purged", chatId });
    this.removeAllListeners(`chat:${chatId}`);
  }

  // --- timers -----------------------------------------------------------

  private clearTimer(map: Map<string, NodeJS.Timeout>, chatId: string) {
    const timer = map.get(chatId);
    if (timer) clearTimeout(timer);
    map.delete(chatId);
  }

  private clearEmptyTimer(chatId: string) {
    this.clearTimer(this.emptyTimers, chatId);
  }

  private scheduleEmptyCheck(chatId: string): void {
    this.clearEmptyTimer(chatId);
    if (!this.chatsById.has(chatId)) return;
    const timer = setTimeout(() => {
      this.emptyTimers.delete(chatId);
      if (this.viewerCount(chatId) === 0) this.allParticipantsLeft(chatId);
    }, this.emptyGraceSeconds * 1000);
    timer.unref?.();
    this.emptyTimers.set(chatId, timer);
  }

  private scheduleExpiry(chatId: string): void {
    this.clearTimer(this.expiryTimers, chatId);

    const meta = this.chatsById.get(chatId);
    if (!meta) return;
    const delayMs = new Date(meta.expiresAt).getTime() - Date.now();

    if (delayMs <= 0) {
      this.beginWarningWindow(chatId, "inactivity");
      return;
    }
    const timer = setTimeout(() => this.beginWarningWindow(chatId, "inactivity"), delayMs);
    timer.unref?.();
    this.expiryTimers.set(chatId, timer);
  }

  private resetExpiry(chatId: string): void {
    const meta = this.chatsById.get(chatId);
    if (!meta) return;
    meta.expiresAt = new Date(Date.now() + meta.inactivityTimeoutSeconds * 1000).toISOString();
    this.scheduleExpiry(chatId);
  }

  private cancelWarning(chatId: string, options: { silent?: boolean } = {}): void {
    const interval = this.warningIntervals.get(chatId);
    if (!interval) return;
    clearInterval(interval);
    this.warningIntervals.delete(chatId);
    this.warningReasons.delete(chatId);
    // The chat is alive again, so it gets a fresh inactivity timeout.
    this.resetExpiry(chatId);
    if (!options.silent) this.emitChatEvent(chatId, { type: "warningCancelled", chatId });
  }

  private beginWarningWindow(chatId: string, reason: WarningReason): void {
    if (!this.chatsById.has(chatId) || this.warningIntervals.has(chatId)) return;
    this.clearTimer(this.expiryTimers, chatId);

    let remaining = this.warningWindowSeconds;
    this.warningReasons.set(chatId, reason);
    this.emitChatEvent(chatId, { type: "expiryWarning", chatId, secondsRemaining: remaining, reason });

    const interval = setInterval(() => {
      remaining -= 1;
      if (!this.chatsById.has(chatId)) {
        clearInterval(interval);
        return;
      }
      if (remaining > 0) {
        this.emitChatEvent(chatId, { type: "expiryWarning", chatId, secondsRemaining: remaining, reason });
      } else {
        clearInterval(interval);
        this.warningIntervals.delete(chatId);
        this.purge(chatId);
      }
    }, 1000);

    this.warningIntervals.set(chatId, interval);
  }
}

export const volatileChatStore = new VolatileChatStore({
  warningWindowSeconds: config.breakoutWarningWindowSeconds,
  emptyGraceSeconds: config.breakoutEmptyGraceSeconds,
});
