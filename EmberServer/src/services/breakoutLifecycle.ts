import { db } from "../db/database";
import { findById } from "../db/usersRepo";
import {
  createChat,
  createMessage,
  createTombstone,
  findChatById,
  markRead,
  toChatJson,
  updateChatLastMessage,
} from "../db/chatsRepo";
import { sendToUsers } from "../ws/hub";
import { volatileChatStore, VolatileChatMeta, VolatileMessage } from "./volatileChatStore";

/** Wire shape of a live (volatile) breakout chat. */
export function toBreakoutJson(meta: VolatileChatMeta) {
  return {
    id: meta.id,
    kind: "breakout" as const,
    parentChatId: meta.parentChatId,
    participantIds: meta.participantIds,
    isPersisted: false,
    inactivityTimeoutSeconds: meta.inactivityTimeoutSeconds,
    createdAt: meta.createdAt,
    createdByUserId: meta.createdByUserId,
    expiresAt: meta.expiresAt,
    keepVote: volatileChatStore.keepVoteFor(meta.id) ?? null,
  };
}

/**
 * Writes a breakout and its whole history to the database in one
 * transaction, so a failure halfway through can never leave a
 * half-saved chat behind. Everyone has already seen these messages
 * live, so they start out read.
 */
const persistBreakout = db.transaction((messages: VolatileMessage[], chatMeta: VolatileChatMeta) => {
  createChat({
    id: chatMeta.id,
    kind: "breakout",
    parentChatId: chatMeta.parentChatId,
    isPersisted: true,
    createdByUserId: chatMeta.createdByUserId,
    createdAt: new Date(chatMeta.createdAt),
    participantIds: chatMeta.participantIds,
  });
  for (const m of messages) {
    createMessage({ id: m.id, chatId: chatMeta.id, senderId: m.senderId, text: m.text, sentAt: new Date(m.sentAt) });
  }
  if (messages.length > 0) {
    const last = messages[messages.length - 1];
    updateChatLastMessage(chatMeta.id, last.text?.slice(0, 120) ?? null, new Date(last.sentAt));
  }
  const now = new Date();
  for (const id of chatMeta.participantIds) markRead(chatMeta.id, id, now);
});

export async function saveBreakout(messages: VolatileMessage[], meta: VolatileChatMeta): Promise<void> {
  persistBreakout(messages, meta);
}

/**
 * Hooks a newly created breakout chat into the rest of the system:
 *
 *  - When it is kept (however the keep vote ended), every participant
 *    gets `breakout:promoted` with the saved chat.
 *  - When it is cleared without being kept, every participant is told
 *    (`breakout:cleared`) over their user-level socket, so people who
 *    were invited but never opened it can drop it from their UI.
 *  - Optionally writes a content-free tombstone row, only if the chat's
 *    creator enabled it in Settings, and only when the chat was
 *    discarded. A kept chat is already fully saved.
 */
export function attachBreakoutLifecycle(meta: VolatileChatMeta): void {
  let wasPromoted = false;

  const unsubscribe = volatileChatStore.onChatEvent(meta.id, (event) => {
    if (event.type === "promoted") {
      wasPromoted = true;
      const chat = findChatById(meta.id);
      sendToUsers(meta.participantIds, {
        type: "breakout:promoted",
        chatId: meta.id,
        parentChatId: meta.parentChatId,
        chat: chat ? toChatJson(chat) : undefined,
      });
    }
    if (event.type === "purged") {
      unsubscribe();
      if (wasPromoted) return;

      sendToUsers(meta.participantIds, {
        type: "breakout:cleared",
        chatId: meta.id,
        parentChatId: meta.parentChatId,
      });

      const creator = findById(meta.createdByUserId);
      if (!creator?.tombstone_logging_enabled) return;

      createTombstone({
        parentChatId: meta.parentChatId,
        participantIds: meta.participantIds,
        startedAt: new Date(meta.createdAt),
        endedAt: new Date(),
        wasKept: false,
      });
    }
  });
}
