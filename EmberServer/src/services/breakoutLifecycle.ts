import { findById } from "../db/usersRepo";
import { createTombstone } from "../db/chatsRepo";
import { volatileChatStore, VolatileChatMeta } from "./volatileChatStore";

/**
 * Attaches the optional, content-free tombstone logger to a newly
 * created breakout chat. Writes a tombstone row only if the chat's
 * creator has enabled it in Settings (spec 4.2 / 6), and only when the
 * chat was discarded rather than kept — a promoted chat is already
 * fully persisted as a normal chat, so a tombstone would be redundant.
 */
export function attachTombstoneLogging(meta: VolatileChatMeta): void {
  let wasPromoted = false;

  const unsubscribe = volatileChatStore.onChatEvent(meta.id, (event) => {
    if (event.type === "promoted") {
      wasPromoted = true;
    }
    if (event.type === "purged") {
      unsubscribe();
      if (wasPromoted) return;

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
