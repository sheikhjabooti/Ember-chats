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
  isPersisted: boolean;
  inactivityTimeoutSeconds: number;
  createdAt: string;
  createdByUserId: string;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
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
}

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  text?: string | null;
  sentAt: string;
}

export interface BreakoutsForChat {
  active: Breakout[];
  kept: Chat[];
}

export type WarningReason = "inactivity" | "empty" | "ended";

/** Every frame the server can push over the WebSocket. */
export type ServerFrame =
  | { type: "pong" }
  | { type: "error"; chatId?: string; message: string }
  | { type: "message"; chatId: string; message: Message }
  | { type: "typing"; chatId: string; userId: string; isTyping: boolean }
  | { type: "breakout:started"; parentChatId: string; breakout: Breakout }
  | { type: "breakout:promoted"; chatId: string; parentChatId: string; chat?: Chat }
  | { type: "breakout:cleared"; chatId: string; parentChatId: string }
  | { type: "breakout:snapshot"; chatId: string; breakout: Breakout; messages: Message[] }
  | { type: "expiryWarning"; chatId: string; secondsRemaining: number; reason: WarningReason }
  | { type: "warningCancelled"; chatId: string }
  | { type: "purged"; chatId: string }
  | { type: "promoted"; chatId: string };
