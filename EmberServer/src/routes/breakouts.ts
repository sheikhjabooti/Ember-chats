import { Router } from "express";
import { randomUUID } from "crypto";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { sendMessageSchema } from "../services/schemas";
import { volatileChatStore, VolatileMessage } from "../services/volatileChatStore";
import { sendToUsers } from "../ws/hub";
import { createChat, createMessage, updateChatLastMessage } from "../db/chatsRepo";

export const breakoutsRouter = Router();

breakoutsRouter.get("/:breakoutId", requireAuth, async (req: AuthedRequest, res) => {
  const meta = requireBreakoutMembership(req, res);
  if (!meta) return;
  return res.json({
    id: meta.id,
    kind: "breakout",
    parentChatId: meta.parentChatId,
    participantIds: meta.participantIds,
    isPersisted: false,
    createdAt: meta.createdAt,
    createdByUserId: meta.createdByUserId,
    expiresAt: meta.expiresAt,
  });
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

/** "Keep this chat" — promotes the breakout to a persisted chat. */
breakoutsRouter.post("/:breakoutId/keep", requireAuth, async (req: AuthedRequest, res) => {
  const meta = requireBreakoutMembership(req, res);
  if (!meta) return;

  const persisted = await volatileChatStore.promote(meta.id, async (messages, chatMeta) => {
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

  sendToUsers(meta.participantIds, { type: "breakout:promoted", chatId: meta.id });
  return res.json({ id: meta.id, isPersisted: true, messageCount: persisted.length });
});

/** "End Breakout" — starts the clearance warning window for everyone. */
breakoutsRouter.post("/:breakoutId/end", requireAuth, async (req: AuthedRequest, res) => {
  const meta = requireBreakoutMembership(req, res);
  if (!meta) return;
  volatileChatStore.requestEnd(meta.id);
  return res.status(204).end();
});

function requireBreakoutMembership(req: AuthedRequest, res: any) {
  const meta = volatileChatStore.chat(req.params.breakoutId);
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
