import { randomUUID } from "crypto";
import { db } from "../db/database";

export interface ChatRow {
  id: string;
  kind: string;
  title: string | null;
  avatar_url: string | null;
  parent_chat_id: string | null;
  is_persisted: number;
  inactivity_timeout_seconds: number;
  created_at: string;
  created_by_user_id: string;
  last_message_preview: string | null;
  last_message_at: string | null;
}

export type MessageKind = "text" | "system";
export type DeletionState = "none" | "deletedForEveryone";

export interface MessageRow {
  id: string;
  chat_id: string;
  sender_id: string;
  kind: MessageKind;
  text: string | null;
  sent_at: string;
  edited_at: string | null;
  deletion_state: DeletionState;
  reply_to_message_id: string | null;
  reactions_json: string;
}

export interface ParticipantRow {
  user_id: string;
  role: "admin" | "member";
  joined_at: string;
  last_read_at: string | null;
}

// --- chats --------------------------------------------------------------

export function createChat(input: {
  id?: string;
  kind: "direct" | "group" | "breakout";
  title?: string | null;
  parentChatId?: string | null;
  isPersisted?: boolean;
  createdByUserId: string;
  createdAt?: Date;
  participantIds: string[];
}): ChatRow {
  const id = input.id ?? randomUUID();
  const createdAt = (input.createdAt ?? new Date()).toISOString();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO chats (id, kind, title, parent_chat_id, is_persisted, created_at, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, input.kind, input.title ?? null, input.parentChatId ?? null, input.isPersisted === false ? 0 : 1, createdAt, input.createdByUserId);

    const insertParticipant = db.prepare(
      `INSERT INTO chat_participants (chat_id, user_id, role, last_read_at) VALUES (?, ?, ?, ?)`
    );
    for (const userId of input.participantIds) {
      insertParticipant.run(id, userId, userId === input.createdByUserId ? "admin" : "member", createdAt);
    }
  });
  tx();
  return findChatById(id)!;
}

export function findChatById(id: string): ChatRow | undefined {
  return db.prepare("SELECT * FROM chats WHERE id = ?").get(id) as ChatRow | undefined;
}

export function renameChat(chatId: string, title: string | null): void {
  db.prepare("UPDATE chats SET title = ? WHERE id = ?").run(title, chatId);
}

export function participantIdsForChat(chatId: string): string[] {
  return (db.prepare("SELECT user_id FROM chat_participants WHERE chat_id = ? ORDER BY joined_at").all(chatId) as { user_id: string }[]).map(
    (r) => r.user_id
  );
}

export function participantsForChat(chatId: string): ParticipantRow[] {
  return db
    .prepare("SELECT user_id, role, joined_at, last_read_at FROM chat_participants WHERE chat_id = ? ORDER BY joined_at")
    .all(chatId) as ParticipantRow[];
}

export function isChatParticipant(chatId: string, userId: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM chat_participants WHERE chat_id = ? AND user_id = ?")
    .get(chatId, userId);
  return !!row;
}

export function isChatAdmin(chatId: string, userId: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM chat_participants WHERE chat_id = ? AND user_id = ? AND role = 'admin'")
    .get(chatId, userId);
  return !!row;
}

export function addParticipants(chatId: string, userIds: string[]): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO chat_participants (chat_id, user_id, role, joined_at, last_read_at) VALUES (?, ?, 'member', ?, ?)`
  );
  db.transaction(() => {
    for (const id of userIds) insert.run(chatId, id, now, now);
  })();
}

/**
 * Removes someone from a chat. If that leaves a group with no admin, the
 * longest-standing remaining member becomes admin so the group is never
 * left unmanageable.
 */
export function removeParticipant(chatId: string, userId: string): void {
  db.transaction(() => {
    db.prepare("DELETE FROM chat_participants WHERE chat_id = ? AND user_id = ?").run(chatId, userId);
    const admins = db.prepare("SELECT COUNT(*) AS n FROM chat_participants WHERE chat_id = ? AND role = 'admin'").get(chatId) as { n: number };
    if (admins.n === 0) {
      db.prepare(
        `UPDATE chat_participants SET role = 'admin'
         WHERE chat_id = ? AND user_id = (SELECT user_id FROM chat_participants WHERE chat_id = ? ORDER BY joined_at LIMIT 1)`
      ).run(chatId, chatId);
    }
  })();
}

export function listChatsForUser(userId: string): ChatRow[] {
  return db
    .prepare(
      `SELECT c.* FROM chats c
       JOIN chat_participants p ON p.chat_id = c.id
       WHERE p.user_id = ?
         AND (c.kind != 'breakout' OR c.parent_chat_id IS NULL)
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`
    )
    .all(userId) as ChatRow[];
}

/**
 * Every breakout `userId` took part in that someone kept. These live in
 * their own list (the "Kept" tab), apart from normal chats.
 */
export function listAllKeptBreakouts(userId: string): ChatRow[] {
  return db
    .prepare(
      `SELECT c.* FROM chats c
       JOIN chat_participants p ON p.chat_id = c.id
       WHERE p.user_id = ? AND c.kind = 'breakout' AND c.parent_chat_id IS NOT NULL
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`
    )
    .all(userId) as ChatRow[];
}

/** An existing direct chat between exactly these two users, if any. */
export function findDirectChat(userA: string, userB: string): ChatRow | undefined {
  return db
    .prepare(
      `SELECT c.* FROM chats c
       WHERE c.kind = 'direct'
         AND EXISTS (SELECT 1 FROM chat_participants WHERE chat_id = c.id AND user_id = ?)
         AND EXISTS (SELECT 1 FROM chat_participants WHERE chat_id = c.id AND user_id = ?)
         AND (SELECT COUNT(*) FROM chat_participants WHERE chat_id = c.id) = 2
       LIMIT 1`
    )
    .get(userA, userB) as ChatRow | undefined;
}

export function updateChatLastMessage(chatId: string, preview: string | null, at: Date): void {
  db.prepare("UPDATE chats SET last_message_preview = ?, last_message_at = ? WHERE id = ?").run(
    preview,
    at.toISOString(),
    chatId
  );
}

// --- reading ------------------------------------------------------------

/** Marks everything in the chat up to `at` as read by `userId`. Never moves backwards. */
export function markRead(chatId: string, userId: string, at: Date): string | null {
  const iso = at.toISOString();
  db.prepare(
    `UPDATE chat_participants SET last_read_at = ?
     WHERE chat_id = ? AND user_id = ? AND (last_read_at IS NULL OR last_read_at < ?)`
  ).run(iso, chatId, userId, iso);
  const row = db.prepare("SELECT last_read_at FROM chat_participants WHERE chat_id = ? AND user_id = ?").get(chatId, userId) as
    | { last_read_at: string | null }
    | undefined;
  return row?.last_read_at ?? null;
}

export function unreadCount(chatId: string, userId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM messages m
       JOIN chat_participants p ON p.chat_id = m.chat_id AND p.user_id = ?
       WHERE m.chat_id = ? AND m.sender_id != ? AND m.deletion_state = 'none'
         AND (p.last_read_at IS NULL OR m.sent_at > p.last_read_at)`
    )
    .get(userId, chatId, userId) as { n: number };
  return row.n;
}

// --- messages -----------------------------------------------------------

export function createMessage(input: {
  id?: string;
  chatId: string;
  senderId: string;
  kind?: MessageKind;
  text?: string | null;
  sentAt?: Date;
  replyToMessageId?: string | null;
}): MessageRow {
  const id = input.id ?? randomUUID();
  const sentAt = (input.sentAt ?? new Date()).toISOString();
  db.prepare(
    `INSERT INTO messages (id, chat_id, sender_id, kind, text, sent_at, reply_to_message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.chatId, input.senderId, input.kind ?? "text", input.text ?? null, sentAt, input.replyToMessageId ?? null);
  return findMessageById(id)!;
}

/**
 * Posts a system notice ("Alice added Bob") into a chat. `actorId` is
 * stored as the sender so clients can still say who did it.
 */
export function createSystemMessage(chatId: string, actorId: string, text: string): MessageRow {
  const message = createMessage({ chatId, senderId: actorId, kind: "system", text });
  updateChatLastMessage(chatId, text, new Date(message.sent_at));
  return message;
}

export function findMessageById(id: string): MessageRow | undefined {
  return db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | undefined;
}

export function findMessageInChat(chatId: string, messageId: string): MessageRow | undefined {
  return db.prepare("SELECT * FROM messages WHERE id = ? AND chat_id = ?").get(messageId, chatId) as MessageRow | undefined;
}

export function listMessages(chatId: string, before?: Date, limit = 30): MessageRow[] {
  const rows = before
    ? db
        .prepare("SELECT * FROM messages WHERE chat_id = ? AND sent_at < ? ORDER BY sent_at DESC LIMIT ?")
        .all(chatId, before.toISOString(), limit)
    : db.prepare("SELECT * FROM messages WHERE chat_id = ? ORDER BY sent_at DESC LIMIT ?").all(chatId, limit);
  return (rows as MessageRow[]).reverse();
}

export function editMessage(messageId: string, text: string): MessageRow {
  db.prepare("UPDATE messages SET text = ?, edited_at = ? WHERE id = ?").run(text, new Date().toISOString(), messageId);
  return findMessageById(messageId)!;
}

/** Deleting for everyone wipes the text and reactions; only a placeholder remains. */
export function deleteMessageForEveryone(messageId: string): MessageRow {
  db.prepare("UPDATE messages SET text = NULL, reactions_json = '{}', deletion_state = 'deletedForEveryone' WHERE id = ?").run(messageId);
  return findMessageById(messageId)!;
}

/** Adds the user's reaction with `emoji`, or removes it if it is already there. */
export function toggleReaction(messageId: string, userId: string, emoji: string): MessageRow {
  return db.transaction(() => {
    const row = findMessageById(messageId)!;
    const reactions = JSON.parse(row.reactions_json || "{}") as Record<string, string[]>;
    const users = new Set(reactions[emoji] ?? []);
    if (users.has(userId)) users.delete(userId);
    else users.add(userId);
    if (users.size === 0) delete reactions[emoji];
    else reactions[emoji] = [...users];
    db.prepare("UPDATE messages SET reactions_json = ? WHERE id = ?").run(JSON.stringify(reactions), messageId);
    return findMessageById(messageId)!;
  })();
}

/** Refreshes a chat's preview after its latest message was edited or deleted. */
export function refreshLastMessagePreview(chatId: string): void {
  const last = db
    .prepare("SELECT * FROM messages WHERE chat_id = ? ORDER BY sent_at DESC LIMIT 1")
    .get(chatId) as MessageRow | undefined;
  if (!last) return;
  const preview = last.deletion_state === "deletedForEveryone" ? "Message deleted" : last.text?.slice(0, 120) ?? null;
  db.prepare("UPDATE chats SET last_message_preview = ? WHERE id = ?").run(preview, chatId);
}

// --- JSON ---------------------------------------------------------------

/**
 * `forUserId` adds the per-viewer fields: how many messages they haven't
 * read, and how far everyone else has read (for "Seen" receipts).
 */
export function toChatJson(chat: ChatRow, forUserId?: string) {
  const participants = participantsForChat(chat.id);
  return {
    id: chat.id,
    kind: chat.kind,
    title: chat.title,
    parentChatId: chat.parent_chat_id,
    participantIds: participants.map((p) => p.user_id),
    adminIds: participants.filter((p) => p.role === "admin").map((p) => p.user_id),
    readState: Object.fromEntries(participants.map((p) => [p.user_id, p.last_read_at])),
    unreadCount: forUserId ? unreadCount(chat.id, forUserId) : 0,
    isPersisted: !!chat.is_persisted,
    inactivityTimeoutSeconds: chat.inactivity_timeout_seconds,
    createdAt: chat.created_at,
    createdByUserId: chat.created_by_user_id,
    lastMessagePreview: chat.last_message_preview,
    lastMessageAt: chat.last_message_at,
  };
}

export function toMessageJson(message: MessageRow) {
  const deleted = message.deletion_state === "deletedForEveryone";
  let replyTo: { id: string; senderId: string; text: string | null; deleted: boolean } | null = null;
  if (message.reply_to_message_id) {
    const original = findMessageById(message.reply_to_message_id);
    if (original) {
      replyTo = {
        id: original.id,
        senderId: original.sender_id,
        text: original.deletion_state === "deletedForEveryone" ? null : original.text?.slice(0, 200) ?? null,
        deleted: original.deletion_state === "deletedForEveryone",
      };
    }
  }
  return {
    id: message.id,
    chatId: message.chat_id,
    senderId: message.sender_id,
    kind: message.kind ?? "text",
    text: deleted ? null : message.text,
    sentAt: message.sent_at,
    editedAt: message.edited_at,
    deletionState: message.deletion_state,
    replyToMessageId: message.reply_to_message_id,
    replyTo,
    attachments: [] as unknown[],
    reactions: deleted ? {} : JSON.parse(message.reactions_json ?? "{}"),
  };
}

// --- tombstones ---------------------------------------------------------

export function createTombstone(input: {
  parentChatId: string;
  participantIds: string[];
  startedAt: Date;
  endedAt: Date;
  wasKept: boolean;
}): void {
  db.prepare(
    `INSERT INTO breakout_tombstones (id, parent_chat_id, participant_ids, started_at, ended_at, was_kept)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    input.parentChatId,
    JSON.stringify(input.participantIds),
    input.startedAt.toISOString(),
    input.endedAt.toISOString(),
    input.wasKept ? 1 : 0
  );
}
