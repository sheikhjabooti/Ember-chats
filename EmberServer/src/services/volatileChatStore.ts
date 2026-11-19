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

export type VolatileChatEvent =
  | { type: "message"; chatId: string; message: VolatileMessage }
  | { type: "expiryWarning"; chatId: string; secondsRemaining: number }
  | { type: "purged"; chatId: string }
  | { type: "promoted"; chatId: string };

export type PromotionHandler = (
  messages: VolatileMessage[],
  chat: VolatileChatMeta
) => Promise<void>;

/**
 * Non-persistent, in-process store for breakout chat messages. This is
 * the server-side mirror of the client's `VolatileChatStore` actor:
 * same lifecycle (register -> append/resetExpiry -> warning window ->
 * purge or promote), same guarantee that message content is *only* ever
 * held in this process's memory and is never written to the database
 * unless `promote()` is explicitly called.
 *
 * NOTE: this is process-local state. If you deploy more than one
 * server instance, either (a) route a given breakout chat's traffic to
 * a single instance via sticky sessions / consistent hashing on
 * chatId, or (b) swap this for a Redis-backed implementation behind
 * the same interface — the REST/WS layers only depend on the methods
 * below, not on this being in-memory.
 */
class VolatileChatStore extends EventEmitter {
  private messagesByChat = new Map<string, VolatileMessage[]>();
  private chatsById = new Map<string, VolatileChatMeta>();
  private expiryTimers = new Map<string, NodeJS.Timeout>();
  private warningIntervals = new Map<string, NodeJS.Timeout>();

  constructor(private readonly warningWindowSeconds: number) {
    super();
    this.setMaxListeners(0);
  }

  register(meta: VolatileChatMeta): void {
    this.chatsById.set(meta.id, meta);
    if (!this.messagesByChat.has(meta.id)) {
      this.messagesByChat.set(meta.id, []);
    }
    this.scheduleExpiry(meta.id);
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

  /** Subscribe to lifecycle events for one chat. Returns an unsubscribe fn. */
  onChatEvent(chatId: string, listener: (event: VolatileChatEvent) => void): () => void {
    const channel = `chat:${chatId}`;
    this.on(channel, listener);
    return () => this.off(channel, listener);
  }

  private emit_(chatId: string, event: VolatileChatEvent) {
    this.emit(`chat:${chatId}`, event);
  }

  append(chatId: string, message: VolatileMessage): void {
    if (!this.chatsById.has(chatId)) return;
    const list = this.messagesByChat.get(chatId) ?? [];
    list.push(message);
    this.messagesByChat.set(chatId, list);
    this.emit_(chatId, { type: "message", chatId, message });
    this.resetExpiry(chatId);
  }

  /** Explicit "End Breakout" — skips straight to the warning window. */
  requestEnd(chatId: string): void {
    this.beginWarningWindow(chatId);
  }

  /** Transport layer reports zero active viewers left. */
  allParticipantsLeft(chatId: string): void {
    this.beginWarningWindow(chatId);
  }

  /**
   * Hands the full history to `handler` (expected to write to the DB),
   * then purges memory. Callable at any point, not just during the
   * warning window ("Keep Chat" / mid-conversation save).
   */
  async promote(chatId: string, handler: PromotionHandler): Promise<VolatileMessage[]> {
    const history = this.messagesByChat.get(chatId) ?? [];
    const meta = this.chatsById.get(chatId);
    if (!meta) return history;
    await handler(history, meta);
    this.emit_(chatId, { type: "promoted", chatId });
    this.purge(chatId);
    return history;
  }

  /** Hard delete: removes all message content + metadata from memory. */
  purge(chatId: string): void {
    this.messagesByChat.delete(chatId);
    this.chatsById.delete(chatId);
    const expiry = this.expiryTimers.get(chatId);
    if (expiry) clearTimeout(expiry);
    this.expiryTimers.delete(chatId);
    const warning = this.warningIntervals.get(chatId);
    if (warning) clearInterval(warning);
    this.warningIntervals.delete(chatId);
    this.emit_(chatId, { type: "purged", chatId });
    this.removeAllListeners(`chat:${chatId}`);
  }

  private scheduleExpiry(chatId: string): void {
    const existing = this.expiryTimers.get(chatId);
    if (existing) clearTimeout(existing);

    const meta = this.chatsById.get(chatId);
    if (!meta) return;
    const delayMs = new Date(meta.expiresAt).getTime() - Date.now();

    if (delayMs <= 0) {
      this.beginWarningWindow(chatId);
      return;
    }
    const timer = setTimeout(() => this.beginWarningWindow(chatId), delayMs);
    this.expiryTimers.set(chatId, timer);
  }

  private resetExpiry(chatId: string): void {
    const meta = this.chatsById.get(chatId);
    if (!meta) return;
    meta.expiresAt = new Date(Date.now() + meta.inactivityTimeoutSeconds * 1000).toISOString();
    this.chatsById.set(chatId, meta);
    this.scheduleExpiry(chatId);
  }

  private beginWarningWindow(chatId: string): void {
    if (!this.chatsById.has(chatId) || this.warningIntervals.has(chatId)) return;
    const expiry = this.expiryTimers.get(chatId);
    if (expiry) clearTimeout(expiry);

    let remaining = this.warningWindowSeconds;
    this.emit_(chatId, { type: "expiryWarning", chatId, secondsRemaining: remaining });

    const interval = setInterval(() => {
      remaining -= 1;
      if (!this.chatsById.has(chatId)) {
        clearInterval(interval);
        return;
      }
      if (remaining > 0) {
        this.emit_(chatId, { type: "expiryWarning", chatId, secondsRemaining: remaining });
      } else {
        clearInterval(interval);
        this.warningIntervals.delete(chatId);
        this.purge(chatId);
      }
    }, 1000);

    this.warningIntervals.set(chatId, interval);
  }
}

export const volatileChatStore = new VolatileChatStore(config.breakoutWarningWindowSeconds);
