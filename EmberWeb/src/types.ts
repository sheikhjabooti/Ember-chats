// Wire types, matching what EmberServer sends (see EmberServer/README.md).

export interface Profile {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
  statusMessage?: string | null;
}

export interface Me extends Profile {
  email?: string | null;
  phone?: string | null;
  tombstoneLoggingEnabled: boolean;
  notificationsEnabled: boolean;
}

export type ChatKind = "direct" | "group" | "breakout";

export interface Chat {
  id: string;
  kind: ChatKind;
  title: string | null;
  parentChatId: string | null;
  participantIds: string[];
  adminIds: string[];
  /** userId -> when they last read this chat (ISO), for "Seen" receipts. */
  readState: Record<string, string | null>;
  /** Only meaningful in responses made for the signed-in user. */
  unreadCount: number;
  isPersisted: boolean;
  inactivityTimeoutSeconds: number;
  createdAt: string;
  createdByUserId: string;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
}

export interface KeepVote {
  requestedBy: string;
  approvedBy: string[];
  secondsRemaining: number;
}

/** A live breakout. It only exists in the server's memory. */
export interface Breakout {
  id: string;
  kind: "breakout";
  parentChatId: string;
  participantIds: string[];
  isPersisted: false;
  inactivityTimeoutSeconds: number;
  createdAt: string;
  createdByUserId: string;
  expiresAt: string;
  /** Set when started with "Reply in a breakout". */
  quotedMessage: { id: string; senderId: string; text: string; sentAt: string } | null;
  keepVote: KeepVote | null;
}

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  /** Breakout messages don't carry these; treat missing as a plain text message. */
  kind?: "text" | "system";
  text?: string | null;
  sentAt: string;
  editedAt?: string | null;
  deletionState?: "none" | "deletedForEveryone";
  replyToMessageId?: string | null;
  replyTo?: { id: string; senderId: string; text: string | null; deleted: boolean } | null;
  reactions?: Record<string, string[]>;
}

export type WarningReason = "inactivity" | "empty" | "ended";

/** Every frame the server can push over the WebSocket. */
export type ServerFrame =
  | { type: "ready"; userId: string }
  | { type: "pong" }
  | { type: "error"; chatId?: string; message: string }
  | { type: "message"; chatId: string; message: Message }
  | { type: "message:updated"; chatId: string; message: Message }
  | { type: "typing"; chatId: string; userId: string; isTyping: boolean }
  | { type: "read"; chatId: string; userId: string; lastReadAt: string }
  | { type: "chat:added"; chat: Chat }
  | { type: "chat:updated"; chat: Chat }
  | { type: "chat:removed"; chatId: string }
  | { type: "breakout:started"; parentChatId: string; breakout: Breakout }
  | { type: "breakout:promoted"; chatId: string; parentChatId: string; chat?: Chat }
  | { type: "breakout:cleared"; chatId: string; parentChatId: string }
  | { type: "breakout:snapshot"; chatId: string; breakout: Breakout; messages: Message[] }
  | { type: "expiryWarning"; chatId: string; secondsRemaining: number; reason: WarningReason }
  | { type: "warningCancelled"; chatId: string }
  | { type: "keepRequested"; chatId: string; requestedBy: string; secondsRemaining: number; approvedBy: string[] }
  | { type: "keepDeclined"; chatId: string; declinedBy: string }
  | { type: "keepFailed"; chatId: string }
  | { type: "purged"; chatId: string }
  | { type: "promoted"; chatId: string };
