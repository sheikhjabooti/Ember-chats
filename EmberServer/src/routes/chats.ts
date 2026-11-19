import { Router } from "express";
import { randomUUID } from "crypto";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { createChatSchema, sendMessageSchema, startBreakoutSchema } from "../services/schemas";
import { sendToUsers } from "../ws/hub";
import { sendPush } from "../services/push";
import { volatileChatStore } from "../services/volatileChatStore";
import { attachBreakoutLifecycle } from "../services/breakoutLifecycle";
import { config } from "../config";
import {
  createChat,
  findChatById,
  isChatParticipant,
  participantIdsForChat,
  listChatsForUser,
  updateChatLastMessage,
  createMessage,
  listMessages,
  toChatJson,
  toMessageJson,
  listKeptBreakouts,
  findDirectChat,
  ChatRow,
} from "../db/chatsRepo";
import { findById, existingUserIds } from "../db/usersRepo";
import { toBreakoutJson } from "../services/breakoutLifecycle";

export const chatsRouter = Router();

chatsRouter.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const chats = listChatsForUser(req.userId!);
  return res.json(chats.map(toChatJson));
});

chatsRouter.post("/", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = createChatSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { kind, title, participantIds } = parsed.data;

  const allParticipantIds = Array.from(new Set([req.userId!, ...participantIds]));

  const known = new Set(existingUserIds(allParticipantIds));
  const unknown = allParticipantIds.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    return res.status(400).json({ error: `Unknown user ids: ${unknown.join(", ")}` });
  }

  if (kind === "direct") {
    if (allParticipantIds.length !== 2) {
      return res.status(400).json({ error: "A direct chat has exactly one other participant" });
    }
    // Reuse the existing conversation instead of creating duplicates.
    const otherId = allParticipantIds.find((id) => id !== req.userId)!;
    const existing = findDirectChat(req.userId!, otherId);
    if (existing) return res.status(200).json(toChatJson(existing));
  }

  const chat = createChat({
    kind,
    title: title ?? null,
    createdByUserId: req.userId!,
    isPersisted: true,
    participantIds: allParticipantIds,
  });

  return res.status(201).json(toChatJson(chat));
});

chatsRouter.get("/:chatId", requireAuth, async (req: AuthedRequest, res) => {
  const chat = requireMembership(req, res);
  if (!chat) return;
  return res.json(toChatJson(chat));
});

chatsRouter.get("/:chatId/messages", requireAuth, async (req: AuthedRequest, res) => {
  const chat = requireMembership(req, res);
  if (!chat) return;

  const before = typeof req.query.before === "string" ? new Date(req.query.before) : undefined;
  const limit = Math.min(parseInt(String(req.query.limit ?? "30"), 10) || 30, 100);

  const messages = listMessages(chat.id, before, limit);
  return res.json(messages.map(toMessageJson));
});

chatsRouter.post("/:chatId/messages", requireAuth, async (req: AuthedRequest, res) => {
  const chat = requireMembership(req, res);
  if (!chat) return;

  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const message = createMessage({
    chatId: chat.id,
    senderId: req.userId!,
    text: parsed.data.text,
    replyToMessageId: parsed.data.replyToMessageId,
  });
  updateChatLastMessage(chat.id, parsed.data.text?.slice(0, 120) ?? null, new Date(message.sent_at));

  const recipients = participantIdsForChat(chat.id).filter((id) => id !== req.userId);
  sendToUsers(recipients, { type: "message", chatId: chat.id, message: toMessageJson(message) });

  const sender = findById(req.userId!);
  for (const recipientId of recipients) {
    const recipient = findById(recipientId);
    if (recipient?.notifications_enabled) {
      await sendPush(recipient.fcm_token, sender?.display_name ?? "New message", parsed.data.text ?? "");
    }
  }

  return res.status(201).json(toMessageJson(message));
});

chatsRouter.post("/:chatId/typing", requireAuth, async (req: AuthedRequest, res) => {
  const chat = requireMembership(req, res);
  if (!chat) return;
  const isTyping = Boolean(req.body?.isTyping);

  const recipients = participantIdsForChat(chat.id).filter((id) => id !== req.userId);
  sendToUsers(recipients, { type: "typing", chatId: chat.id, userId: req.userId, isTyping });
  return res.status(204).end();
});

/**
 * Breakouts hanging off this chat that the caller is part of: the ones
 * still live in memory (so people who were invited can join) and the
 * ones that were kept and are now persisted threads.
 */
chatsRouter.get("/:chatId/breakouts", requireAuth, async (req: AuthedRequest, res) => {
  const chat = requireMembership(req, res);
  if (!chat) return;
  const active = volatileChatStore
    .chatsForParent(chat.id)
    .filter((meta) => meta.participantIds.includes(req.userId!))
    .map(toBreakoutJson);
  const kept = listKeptBreakouts(chat.id, req.userId!).map(toChatJson);
  return res.json({ active, kept });
});

chatsRouter.post("/:chatId/breakout", requireAuth, async (req: AuthedRequest, res) => {
  const parentChat = requireMembership(req, res);
  if (!parentChat) return;

  const parsed = startBreakoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const parentParticipantIds = participantIdsForChat(parentChat.id);
  const participantIds = Array.from(new Set([req.userId!, ...parsed.data.participantIds]));
  const notMembers = participantIds.filter((id) => !parentParticipantIds.includes(id));
  if (notMembers.length > 0) {
    return res.status(400).json({ error: `Not participants of the parent chat: ${notMembers.join(", ")}` });
  }

  const breakoutId = randomUUID();
  const now = new Date();
  const inactivitySeconds = config.breakoutDefaultInactivitySeconds;

  const meta = {
    id: breakoutId,
    parentChatId: parentChat.id,
    participantIds,
    createdByUserId: req.userId!,
    createdAt: now.toISOString(),
    inactivityTimeoutSeconds: inactivitySeconds,
    expiresAt: new Date(now.getTime() + inactivitySeconds * 1000).toISOString(),
  };
  volatileChatStore.register(meta);
  attachBreakoutLifecycle(meta);

  const sender = findById(req.userId!);
  const systemMessage = createMessage({
    chatId: parentChat.id,
    senderId: req.userId!,
    text: `${sender?.display_name ?? "Someone"} started a breakout with ${describeInvitees(
      participantIds.filter((id) => id !== req.userId)
    )}.`,
  });
  updateChatLastMessage(parentChat.id, systemMessage.text, new Date(systemMessage.sent_at));

  const breakoutPayload = toBreakoutJson(meta);

  sendToUsers(participantIds, { type: "breakout:started", parentChatId: parentChat.id, breakout: breakoutPayload });
  sendToUsers(parentParticipantIds, { type: "message", chatId: parentChat.id, message: toMessageJson(systemMessage) });

  return res.status(201).json(breakoutPayload);
});

// --- helpers -----------------------------------------------------------

function requireMembership(req: AuthedRequest, res: any): ChatRow | null {
  const chat = findChatById(String(req.params.chatId));
  if (!chat) {
    res.status(404).json({ error: "Chat not found" });
    return null;
  }
  if (!isChatParticipant(chat.id, req.userId!)) {
    res.status(403).json({ error: "Not a participant of this chat" });
    return null;
  }
  return chat;
}

/** "Bob", "Bob and Carol", "Bob, Carol and Dan", or "5 people" for bigger groups. */
function describeInvitees(ids: string[]): string {
  if (ids.length > 3) return `${ids.length} people`;
  const names = ids.map((id) => findById(id)?.display_name ?? "someone");
  if (names.length <= 1) return names[0] ?? "nobody";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
