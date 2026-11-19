import { Router } from "express";
import { randomUUID } from "crypto";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { rateLimit } from "../middleware/rateLimit";
import { keepResponseSchema, sendMessageSchema } from "../services/schemas";
import { volatileChatStore, VolatileMessage } from "../services/volatileChatStore";
import { saveBreakout, toBreakoutJson } from "../services/breakoutLifecycle";
import { listAllKeptBreakouts, toChatJson } from "../db/chatsRepo";
import { config } from "../config";

export const breakoutsRouter = Router();

const sendLimit = rateLimit("send", 30, 10);

/** Every breakout you were in that someone kept. Shown in their own list, apart from chats. */
breakoutsRouter.get("/kept", requireAuth, async (req: AuthedRequest, res) => {
  return res.json(listAllKeptBreakouts(req.userId!).map((c) => toChatJson(c, req.userId)));
});

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

breakoutsRouter.post("/:breakoutId/messages", requireAuth, sendLimit, async (req: AuthedRequest, res) => {
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
 * "Keep this chat". Starts a vote: the others have KEEP_VOTE_SECONDS to
 * decline, and it's saved unless someone does. 202 while the vote runs,
 * 200 once it's saved. Asking during someone else's vote approves it.
 */
breakoutsRouter.post("/:breakoutId/keep", requireAuth, async (req: AuthedRequest, res) => {
  const meta = requireBreakoutMembership(req, res);
  if (!meta) return;

  try {
    const result = await volatileChatStore.requestKeep(meta.id, req.userId!, saveBreakout, config.keepVoteSeconds);
    if (result.status === "missing") return res.status(404).json({ error: "Breakout chat not found (it may have already been cleared)" });
    if (result.status === "pending") return res.status(202).json({ id: meta.id, status: "pending", secondsRemaining: result.secondsRemaining });
    return res.json({ id: meta.id, status: "kept", isPersisted: true, messageCount: result.messageCount });
  } catch (err) {
    // The store only purges after saving succeeds, so the chat is still live.
    console.error(`[breakouts] failed to keep ${meta.id}`, err);
    return res.status(500).json({ error: "Could not save this chat. It is still open, please try again." });
  }
});

/** Allow or decline someone else's keep request. */
breakoutsRouter.post("/:breakoutId/keep/respond", requireAuth, async (req: AuthedRequest, res) => {
  const meta = requireBreakoutMembership(req, res);
  if (!meta) return;
  const parsed = keepResponseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!volatileChatStore.keepVoteFor(meta.id)) return res.status(409).json({ error: "Nobody is asking to keep this chat right now" });

  await volatileChatStore.respondToKeep(meta.id, req.userId!, parsed.data.allow);
  return res.status(204).end();
});

/** "End Breakout": starts the clearance warning window for everyone. Ending during a keep vote declines it. */
breakoutsRouter.post("/:breakoutId/end", requireAuth, async (req: AuthedRequest, res) => {
  const meta = requireBreakoutMembership(req, res);
  if (!meta) return;
  if (volatileChatStore.keepVoteFor(meta.id)) await volatileChatStore.respondToKeep(meta.id, req.userId!, false);
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
