import { Router } from "express";
import { randomUUID } from "crypto";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { rateLimit } from "../middleware/rateLimit";
import {
  addParticipantsSchema,
  createChatSchema,
  editMessageSchema,
  markReadSchema,
  reactionSchema,
  sendMessageSchema,
  startBreakoutSchema,
  updateChatSchema,
} from "../services/schemas";
import { sendToUsers } from "../ws/hub";
import { sendPush } from "../services/push";
import { volatileChatStore } from "../services/volatileChatStore";
import { attachBreakoutLifecycle, toBreakoutJson } from "../services/breakoutLifecycle";
import { config } from "../config";
import {
  addParticipants,
  ChatRow,
  createChat,
  createMessage,
  createSystemMessage,
  deleteMessageForEveryone,
  editMessage,
  findChatById,
  findDirectChat,
  findMessageInChat,
  isChatAdmin,
  isChatParticipant,
  listChatsForUser,
  listMessages,
  markRead,
  MessageRow,
  participantIdsForChat,
  refreshLastMessagePreview,
  removeParticipant,
  renameChat,
  toChatJson,
  toggleReaction,
  toMessageJson,
  updateChatLastMessage,
} from "../db/chatsRepo";
import { findById, existingUserIds } from "../db/usersRepo";

export const chatsRouter = Router();

const sendLimit = rateLimit("send", 30, 10);
const writeLimit = rateLimit("chat-write", 60, 60);

chatsRouter.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const chats = listChatsForUser(req.userId!);
  return res.json(chats.map((c) => toChatJson(c, req.userId)));
});

chatsRouter.post("/", requireAuth, writeLimit, async (req: AuthedRequest, res) => {
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
    if (existing) return res.status(200).json(toChatJson(existing, req.userId));
  }

  const chat = createChat({
    kind,
    title: title || null,
    createdByUserId: req.userId!,
    isPersisted: true,
    participantIds: allParticipantIds,
  });
  if (kind === "group") {
    createSystemMessage(chat.id, req.userId!, `${nameOf(req.userId!)} created the group`);
  }

  // Let everyone else's chat list pick it up straight away.
  sendToUsers(allParticipantIds.filter((id) => id !== req.userId), { type: "chat:added", chat: toChatJson(findChatById(chat.id)!) });
  return res.status(201).json(toChatJson(findChatById(chat.id)!, req.userId));
});

chatsRouter.get("/:chatId", requireAuth, async (req: AuthedRequest, res) => {
  const chat = requireMembership(req, res);
  if (!chat) return;
  return res.json(toChatJson(chat, req.userId));
});

// --- group management -----------------------------------------------------

/** Rename a group (admins only). A null or empty title falls back to member names. */
chatsRouter.patch("/:chatId", requireAuth, writeLimit, async (req: AuthedRequest, res) => {
  const chat = requireGroupAdmin(req, res);
  if (!chat) return;
  const parsed = updateChatSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const title = parsed.data.title || null;
  if (title === chat.title) return res.json(toChatJson(chat, req.userId));
  renameChat(chat.id, title);
  const notice = createSystemMessage(
    chat.id,
    req.userId!,
    title ? `${nameOf(req.userId!)} renamed the group to "${title}"` : `${nameOf(req.userId!)} removed the group name`
  );
  announceChatChange(chat.id, notice);
  return res.json(toChatJson(findChatById(chat.id)!, req.userId));
});

/** Add people to a group (admins only). */
chatsRouter.post("/:chatId/participants", requireAuth, writeLimit, async (req: AuthedRequest, res) => {
  const chat = requireGroupAdmin(req, res);
  if (!chat) return;
  const parsed = addParticipantsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const current = new Set(participantIdsForChat(chat.id));
  const requested = [...new Set(parsed.data.userIds)].filter((id) => !current.has(id));
  const known = new Set(existingUserIds(requested));
  const unknown = requested.filter((id) => !known.has(id));
  if (unknown.length > 0) return res.status(400).json({ error: `Unknown user ids: ${unknown.join(", ")}` });
  if (requested.length === 0) return res.json(toChatJson(chat, req.userId));

  addParticipants(chat.id, requested);
  const notice = createSystemMessage(chat.id, req.userId!, `${nameOf(req.userId!)} added ${listNames(requested)}`);
  sendToUsers(requested, { type: "chat:added", chat: toChatJson(findChatById(chat.id)!) });
  announceChatChange(chat.id, notice);
  return res.json(toChatJson(findChatById(chat.id)!, req.userId));
});

/** Remove someone (admins only), or leave yourself (anyone). */
chatsRouter.delete("/:chatId/participants/:userId", requireAuth, writeLimit, async (req: AuthedRequest, res) => {
  const chat = requireMembership(req, res);
  if (!chat) return;
  if (chat.kind !== "group") return res.status(400).json({ error: "Only groups have members to add or remove" });

  const targetId = String(req.params.userId);
  const leaving = targetId === req.userId;
  if (!leaving && !isChatAdmin(chat.id, req.userId!)) {
    return res.status(403).json({ error: "Only group admins can remove people" });
  }
  if (!isChatParticipant(chat.id, targetId)) return res.status(404).json({ error: "Not a member of this group" });

  removeParticipant(chat.id, targetId);
  const notice = createSystemMessage(
    chat.id,
    req.userId!,
    leaving ? `${nameOf(targetId)} left the group` : `${nameOf(req.userId!)} removed ${nameOf(targetId)}`
  );
  sendToUsers([targetId], { type: "chat:removed", chatId: chat.id });
  announceChatChange(chat.id, notice);
  return res.status(204).end();
});

// --- messages ---------------------------------------------------------------

chatsRouter.get("/:chatId/messages", requireAuth, async (req: AuthedRequest, res) => {
  const chat = requireMembership(req, res);
  if (!chat) return;

  const before = typeof req.query.before === "string" ? new Date(req.query.before) : undefined;
  if (before && Number.isNaN(before.getTime())) return res.status(400).json({ error: "before must be an ISO date" });
  const limit = Math.min(parseInt(String(req.query.limit ?? "30"), 10) || 30, 100);

  const messages = listMessages(chat.id, before, limit);
  return res.json(messages.map(toMessageJson));
});

chatsRouter.post("/:chatId/messages", requireAuth, sendLimit, async (req: AuthedRequest, res) => {
  const chat = requireMembership(req, res);
  if (!chat) return;

  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { text, replyToMessageId } = parsed.data;
  if (replyToMessageId && !findMessageInChat(chat.id, replyToMessageId)) {
    return res.status(400).json({ error: "You can only reply to a message in the same chat" });
  }

  const message = createMessage({ chatId: chat.id, senderId: req.userId!, text, replyToMessageId });
  updateChatLastMessage(chat.id, text.slice(0, 120), new Date(message.sent_at));
  // Sending something means you've read everything before it.
  markRead(chat.id, req.userId!, new Date(message.sent_at));

  const participants = participantIdsForChat(chat.id);
  // The sender gets it too, so their other open devices stay in sync.
  sendToUsers(participants, { type: "message", chatId: chat.id, message: toMessageJson(message) });

  const sender = findById(req.userId!);
  for (const recipientId of participants.filter((id) => id !== req.userId)) {
    const recipient = findById(recipientId);
    if (recipient?.notifications_enabled) {
      await sendPush(recipient.fcm_token, sender?.display_name ?? "New message", text);
    }
  }

  return res.status(201).json(toMessageJson(message));
});

chatsRouter.patch("/:chatId/messages/:messageId", requireAuth, sendLimit, async (req: AuthedRequest, res) => {
  const found = requireOwnMessage(req, res);
  if (!found) return;
  const parsed = editMessageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const updated = editMessage(found.message.id, parsed.data.text);
  refreshLastMessagePreview(found.chat.id);
  announceMessageUpdate(found.chat.id, updated);
  return res.json(toMessageJson(updated));
});

/** Delete for everyone. Only the text goes; a "message deleted" placeholder stays in place. */
chatsRouter.delete("/:chatId/messages/:messageId", requireAuth, writeLimit, async (req: AuthedRequest, res) => {
  const found = requireOwnMessage(req, res);
  if (!found) return;
  const updated = deleteMessageForEveryone(found.message.id);
  refreshLastMessagePreview(found.chat.id);
  announceMessageUpdate(found.chat.id, updated);
  return res.json(toMessageJson(updated));
});

/** Toggle your reaction. Sending the same emoji again removes it. */
chatsRouter.post("/:chatId/messages/:messageId/reactions", requireAuth, sendLimit, async (req: AuthedRequest, res) => {
  const chat = requireMembership(req, res);
  if (!chat) return;
  const message = findMessageInChat(chat.id, String(req.params.messageId));
  if (!message) return res.status(404).json({ error: "Message not found" });
  if (message.kind !== "text" || message.deletion_state !== "none") {
    return res.status(400).json({ error: "You can't react to that message" });
  }
  const parsed = reactionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const updated = toggleReaction(message.id, req.userId!, parsed.data.emoji);
  announceMessageUpdate(chat.id, updated);
  return res.json(toMessageJson(updated));
});

/** Marks the chat read (up to a message, or everything). Others get a `read` event for "Seen" receipts. */
chatsRouter.post("/:chatId/read", requireAuth, async (req: AuthedRequest, res) => {
  const chat = requireMembership(req, res);
  if (!chat) return;
  const parsed = markReadSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  let at = new Date();
  if (parsed.data.upToMessageId) {
    const message = findMessageInChat(chat.id, parsed.data.upToMessageId);
    if (!message) return res.status(404).json({ error: "Message not found" });
    at = new Date(message.sent_at);
  }
  const lastReadAt = markRead(chat.id, req.userId!, at);
  sendToUsers(participantIdsForChat(chat.id), { type: "read", chatId: chat.id, userId: req.userId, lastReadAt });
  return res.json({ lastReadAt });
});

chatsRouter.post("/:chatId/typing", requireAuth, async (req: AuthedRequest, res) => {
  const chat = requireMembership(req, res);
  if (!chat) return;
  const isTyping = Boolean(req.body?.isTyping);

  const recipients = participantIdsForChat(chat.id).filter((id) => id !== req.userId);
  sendToUsers(recipients, { type: "typing", chatId: chat.id, userId: req.userId, isTyping });
  return res.status(204).end();
});

// --- breakouts --------------------------------------------------------------

/** Live breakouts started from this chat that the caller was invited to. */
chatsRouter.get("/:chatId/breakouts", requireAuth, async (req: AuthedRequest, res) => {
  const chat = requireMembership(req, res);
  if (!chat) return;
  const active = volatileChatStore
    .chatsForParent(chat.id)
    .filter((meta) => meta.participantIds.includes(req.userId!))
    .map(toBreakoutJson);
  return res.json({ active });
});

chatsRouter.post("/:chatId/breakout", requireAuth, writeLimit, async (req: AuthedRequest, res) => {
  const parentChat = requireMembership(req, res);
  if (!parentChat) return;
  if (parentChat.kind !== "group") {
    return res.status(400).json({ error: "Breakouts start from group chats" });
  }

  const parsed = startBreakoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const parentParticipantIds = participantIdsForChat(parentChat.id);
  const participantIds = Array.from(new Set([req.userId!, ...parsed.data.participantIds]));
  const notMembers = participantIds.filter((id) => !parentParticipantIds.includes(id));
  if (notMembers.length > 0) {
    return res.status(400).json({ error: `Not participants of the parent chat: ${notMembers.join(", ")}` });
  }
  if (participantIds.length < 2) return res.status(400).json({ error: "Invite at least one other person" });

  const now = new Date();
  const inactivitySeconds = config.breakoutDefaultInactivitySeconds;
  const meta = {
    id: randomUUID(),
    parentChatId: parentChat.id,
    participantIds,
    createdByUserId: req.userId!,
    createdAt: now.toISOString(),
    inactivityTimeoutSeconds: inactivitySeconds,
    expiresAt: new Date(now.getTime() + inactivitySeconds * 1000).toISOString(),
  };
  volatileChatStore.register(meta);
  attachBreakoutLifecycle(meta);

  // Only the people invited hear about it. Nothing is posted in the parent
  // chat, so the people left out can't tell a side conversation exists.
  const breakoutPayload = toBreakoutJson(meta);
  sendToUsers(participantIds, { type: "breakout:started", parentChatId: parentChat.id, breakout: breakoutPayload });
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

function requireGroupAdmin(req: AuthedRequest, res: any): ChatRow | null {
  const chat = requireMembership(req, res);
  if (!chat) return null;
  if (chat.kind !== "group") {
    res.status(400).json({ error: "Only group chats can be managed" });
    return null;
  }
  if (!isChatAdmin(chat.id, req.userId!)) {
    res.status(403).json({ error: "Only group admins can do that" });
    return null;
  }
  return chat;
}

function requireOwnMessage(req: AuthedRequest, res: any): { chat: ChatRow; message: MessageRow } | null {
  const chat = requireMembership(req, res);
  if (!chat) return null;
  const message = findMessageInChat(chat.id, String(req.params.messageId));
  if (!message) {
    res.status(404).json({ error: "Message not found" });
    return null;
  }
  if (message.sender_id !== req.userId || message.kind !== "text") {
    res.status(403).json({ error: "You can only change your own messages" });
    return null;
  }
  if (message.deletion_state !== "none") {
    res.status(400).json({ error: "That message was deleted" });
    return null;
  }
  return { chat, message };
}

/** Tells every member about a changed chat (name, members) plus the system notice. */
function announceChatChange(chatId: string, notice: MessageRow) {
  const participants = participantIdsForChat(chatId);
  sendToUsers(participants, { type: "chat:updated", chat: toChatJson(findChatById(chatId)!) });
  sendToUsers(participants, { type: "message", chatId, message: toMessageJson(notice) });
}

function announceMessageUpdate(chatId: string, message: MessageRow) {
  sendToUsers(participantIdsForChat(chatId), { type: "message:updated", chatId, message: toMessageJson(message) });
}

function nameOf(userId: string): string {
  return findById(userId)?.display_name ?? "Someone";
}

/** "Bob", "Bob and Carol", "Bob, Carol and Dan", or "5 people" for bigger lists. */
function listNames(ids: string[]): string {
  if (ids.length > 3) return `${ids.length} people`;
  const names = ids.map(nameOf);
  if (names.length <= 1) return names[0] ?? "nobody";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
