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

export interface MessageRow {
  id: string;
  chat_id: string;
  sender_id: string;
  text: string | null;
  sent_at: string;
  edited_at: string | null;
  deletion_state: string;
  reply_to_message_id: string | null;
  reactions_json: string;
}

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
      `INSERT INTO chat_participants (chat_id, user_id, role) VALUES (?, ?, ?)`
    );
    for (const userId of input.participantIds) {
      insertParticipant.run(id, userId, userId === input.createdByUserId ? "admin" : "member");
    }
  });
  tx();
  return findChatById(id)!;
}

export function findChatById(id: string): ChatRow | undefined {
  return db.prepare("SELECT * FROM chats WHERE id = ?").get(id) as ChatRow | undefined;
}

export function participantIdsForChat(chatId: string): string[] {
  return (db.prepare("SELECT user_id FROM chat_participants WHERE chat_id = ?").all(chatId) as { user_id: string }[]).map(
    (r) => r.user_id
  );
}

export function isChatParticipant(chatId: string, userId: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM chat_participants WHERE chat_id = ? AND user_id = ?")
    .get(chatId, userId);
  return !!row;
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

export function updateChatLastMessage(chatId: string, preview: string | null, at: Date): void {
  db.prepare("UPDATE chats SET last_message_preview = ?, last_message_at = ? WHERE id = ?").run(
    preview,
    at.toISOString(),
    chatId
  );
}

export function createMessage(input: {
  id?: string;
  chatId: string;
  senderId: string;
  text?: string | null;
  sentAt?: Date;
  replyToMessageId?: string | null;
}): MessageRow {
  const id = input.id ?? randomUUID();
  const sentAt = (input.sentAt ?? new Date()).toISOString();
  db.prepare(
    `INSERT INTO messages (id, chat_id, sender_id, text, sent_at, reply_to_message_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, input.chatId, input.senderId, input.text ?? null, sentAt, input.replyToMessageId ?? null);
  return findMessageById(id)!;
}

export function findMessageById(id: string): MessageRow | undefined {
  return db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | undefined;
}

export function listMessages(chatId: string, before?: Date, limit = 30): MessageRow[] {
  const rows = before
    ? db
        .prepare("SELECT * FROM messages WHERE chat_id = ? AND sent_at < ? ORDER BY sent_at DESC LIMIT ?")
        .all(chatId, before.toISOString(), limit)
    : db.prepare("SELECT * FROM messages WHERE chat_id = ? ORDER BY sent_at DESC LIMIT ?").all(chatId, limit);
  return (rows as MessageRow[]).reverse();
}

export function toChatJson(chat: ChatRow) {
  return {
    id: chat.id,
    kind: chat.kind,
    title: chat.title,
    parentChatId: chat.parent_chat_id,
    participantIds: participantIdsForChat(chat.id),
    isPersisted: !!chat.is_persisted,
    inactivityTimeoutSeconds: chat.inactivity_timeout_seconds,
    createdAt: chat.created_at,
    createdByUserId: chat.created_by_user_id,
    lastMessagePreview: chat.last_message_preview,
    lastMessageAt: chat.last_message_at,
  };
}

export function toMessageJson(message: MessageRow) {
  return {
    id: message.id,
    chatId: message.chat_id,
    senderId: message.sender_id,
    text: message.text,
    sentAt: message.sent_at,
    editedAt: message.edited_at,
    deletionState: message.deletion_state,
    replyToMessageId: message.reply_to_message_id,
    attachments: [] as unknown[],
    reactions: JSON.parse(message.reactions_json ?? "{}"),
  };
}

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

/**
 * Breakouts that were kept (promoted) under `parentChatId` and that
 * `userId` took part in. These are hidden from the main chat list and
 * surface as threads under their parent chat instead.
 */
export function listKeptBreakouts(parentChatId: string, userId: string): ChatRow[] {
  return db
    .prepare(
      `SELECT c.* FROM chats c
       JOIN chat_participants p ON p.chat_id = c.id
       WHERE c.parent_chat_id = ? AND c.kind = 'breakout' AND p.user_id = ?
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`
    )
    .all(parentChatId, userId) as ChatRow[];
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
