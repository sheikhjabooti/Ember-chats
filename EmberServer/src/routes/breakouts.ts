import { Router } from "express";
import { randomUUID } from "crypto";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { sendMessageSchema } from "../services/schemas";
import { volatileChatStore, VolatileMessage, VolatileChatMeta } from "../services/volatileChatStore";
import { toBreakoutJson } from "../services/breakoutLifecycle";
import { sendToUsers } from "../ws/hub";
import { db } from "../db/database";
import { createChat, createMessage, updateChatLastMessage, findChatById, toChatJson } from "../db/chatsRepo";

export const breakoutsRouter = Router();

breakoutsRouter.get("/:breakoutId", requireAuth, async (req: AuthedRequest, res) => {
  const meta = requireBreakoutMembership(req, res);
  if (!meta) return;
  return res.json(toBreakoutJson(meta));
});

breakoutsRouter.get("/:breakoutId/messages", requireAuth, async (req: AuthedRequest, res) => {
  const meta = requireBreakoutMembership(req, res);
  if (!meta) return;
  return res.json(volatileChatStore.messages(meta.id));
});

breakoutsRouter.post("/:breakoutId/messages", requireAuth, async (req: AuthedRequest, res) => {
  const meta = requireBreakoutMembership(req, res);
  if (!meta) return;

  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const message: VolatileMessage = {
    id: randomUUID(),
    chatId: meta.id,
    senderId: req.userId!,
    text: parsed.data.text,
    sentAt: new Date().toISOString(),
  };
  volatileChatStore.append(meta.id, message);

  // Real-time delivery happens via the WS event bridge (see ws/index.ts).
  // This REST endpoint is a fallback for clients not yet connected over WS.
  return res.status(201).json(message);
});

/**
 * Writes a breakout and its whole history to the database in one
 * transaction, so a failure halfway through can never leave a
 * half-saved chat behind.
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
    createMessage({
      id: m.id,
      chatId: chatMeta.id,
      senderId: m.senderId,
      text: m.text,
      sentAt: new Date(m.sentAt),
    });
  }
  if (messages.length > 0) {
    const last = messages[messages.length - 1];
    updateChatLastMessage(chatMeta.id, last.text?.slice(0, 120) ?? null, new Date(last.sentAt));
  }
});

/** "Keep this chat": promotes the breakout to a persisted chat. */
breakoutsRouter.post("/:breakoutId/keep", requireAuth, async (req: AuthedRequest, res) => {
  const meta = requireBreakoutMembership(req, res);
  if (!meta) return;

  let persisted: VolatileMessage[];
  try {
    persisted = await volatileChatStore.promote(meta.id, async (messages, chatMeta) => {
      persistBreakout(messages, chatMeta);
    });
  } catch (err) {
    // The store only purges after the handler succeeds, so the chat is
    // still live in memory and the user can try again.
    console.error(`[breakouts] failed to keep ${meta.id}`, err);
    return res.status(500).json({ error: "Could not save this chat. It is still open, please try again." });
  }

  const chat = findChatById(meta.id);
  sendToUsers(meta.participantIds, {
    type: "breakout:promoted",
    chatId: meta.id,
    parentChatId: meta.parentChatId,
    chat: chat ? toChatJson(chat) : undefined,
  });
  return res.json({ id: meta.id, isPersisted: true, messageCount: persisted.length });
});

/** "End Breakout": starts the clearance warning window for everyone. */
breakoutsRouter.post("/:breakoutId/end", requireAuth, async (req: AuthedRequest, res) => {
  const meta = requireBreakoutMembership(req, res);
  if (!meta) return;
  volatileChatStore.requestEnd(meta.id);
  return res.status(204).end();
});

function requireBreakoutMembership(req: AuthedRequest, res: any) {
  const meta = volatileChatStore.chat(String(req.params.breakoutId));
  if (!meta) {
    res.status(404).json({ error: "Breakout chat not found (it may have already been cleared)" });
    return null;
  }
  if (!meta.participantIds.includes(req.userId!)) {
    res.status(403).json({ error: "Not a participant of this breakout chat" });
    return null;
  }
  return meta;
}
