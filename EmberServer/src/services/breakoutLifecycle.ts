import { findById } from "../db/usersRepo";
import { createTombstone } from "../db/chatsRepo";
import { sendToUsers } from "../ws/hub";
import { volatileChatStore, VolatileChatMeta } from "./volatileChatStore";

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
  };
}

/**
 * Hooks a newly created breakout chat into the rest of the system:
 *
 *  - When it is cleared without being kept, every participant is told
 *    (`breakout:cleared`) over their user-level socket, so people who
 *    were invited but never opened it can drop it from their UI.
 *  - Optionally writes a content-free tombstone row, only if the chat's
 *    creator enabled it in Settings (spec 4.2 / 6), and only when the
 *    chat was discarded. A kept chat is already fully persisted, so a
 *    tombstone would be redundant.
 */
export function attachBreakoutLifecycle(meta: VolatileChatMeta): void {
  let wasPromoted = false;

  const unsubscribe = volatileChatStore.onChatEvent(meta.id, (event) => {
    if (event.type === "promoted") {
      wasPromoted = true;
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
