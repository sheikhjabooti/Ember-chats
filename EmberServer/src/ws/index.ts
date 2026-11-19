import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import { randomUUID } from "crypto";
import { authenticate } from "../services/auth";
import { registerConnection, unregisterConnection, sendToUsers } from "./hub";
import { volatileChatStore, VolatileMessage } from "../services/volatileChatStore";
import { toBreakoutJson } from "../services/breakoutLifecycle";
import { MAX_MESSAGE_LENGTH } from "../services/schemas";
import { RateLimiter } from "../middleware/rateLimit";
import { config } from "../config";

interface ClientMessage {
  type: "auth" | "breakout:subscribe" | "breakout:unsubscribe" | "breakout:send" | "breakout:typing" | "ping";
  token?: string;
  chatId?: string;
  text?: string;
  isTyping?: boolean;
}

const AUTH_TIMEOUT_MS = 5000;

/**
 * One WebSocket connection per client. Protocol:
 *
 *  1. Connect to /ws, then send `{"type":"auth","token":"<JWT>"}` as the
 *     first message (within 5 seconds). The server answers
 *     `{"type":"ready","userId"}` or closes with code 4401. The token is
 *     not put in the URL because URLs end up in proxy and server logs.
 *  2. After that the socket receives every event for the user's chats,
 *     and can subscribe to breakouts (`breakout:subscribe`), send in them
 *     (`breakout:send`) and show typing (`breakout:typing`).
 *
 * A breakout subscription also counts as "viewing" it. When nobody is
 * viewing any more, the store starts the clearance countdown after a
 * grace period.
 */
export function attachWebSocketServer(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 64 * 1024 });

  wss.on("connection", (socket: WebSocket) => {
    let userId: string | null = null;
    const breakoutUnsubscribers = new Map<string, () => void>();
    // 20 breakout messages per 10 seconds per connection.
    const sendLimiter = new RateLimiter(20, 10_000);

    const send = (payload: unknown) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
    };

    const authTimer = setTimeout(() => {
      if (!userId) socket.close(4401, "Authenticate first");
    }, AUTH_TIMEOUT_MS);

    const leaveBreakout = (chatId: string) => {
      const unsubscribe = breakoutUnsubscribers.get(chatId);
      if (!unsubscribe) return;
      unsubscribe();
      breakoutUnsubscribers.delete(chatId);
      if (userId) volatileChatStore.viewerLeft(chatId, userId);
    };

    socket.on("message", (raw) => {
      let parsed: ClientMessage;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (!userId) {
        const authed = parsed.type === "auth" && typeof parsed.token === "string" ? authenticate(parsed.token) : null;
        if (!authed) {
          socket.close(4401, "Unauthorized");
          return;
        }
        userId = authed;
        clearTimeout(authTimer);
        registerConnection(userId, socket);
        send({ type: "ready", userId });
        return;
      }
      const me = userId;

      switch (parsed.type) {
        case "ping":
          send({ type: "pong" });
          break;

        case "breakout:subscribe": {
          const chatId = parsed.chatId;
          if (!chatId || breakoutUnsubscribers.has(chatId)) return;
          const meta = volatileChatStore.chat(chatId);
          if (!meta || !meta.participantIds.includes(me)) {
            send({ type: "error", chatId, message: "Cannot subscribe to that breakout chat" });
            return;
          }
          const unsubscribe = volatileChatStore.onChatEvent(chatId, (event) => {
            send({ ...event, chatId });
            // The store drops its listeners on purge, so forget ours too.
            if (event.type === "purged") breakoutUnsubscribers.delete(chatId);
          });
          breakoutUnsubscribers.set(chatId, unsubscribe);
          send({
            type: "breakout:snapshot",
            chatId,
            breakout: toBreakoutJson(meta),
            messages: volatileChatStore.messages(chatId),
          });
          // Joining can cancel an "everyone left" countdown, which emits
          // `warningCancelled`, so do it after the snapshot is sent.
          volatileChatStore.viewerJoined(chatId, me);
          break;
        }

        case "breakout:unsubscribe": {
          if (parsed.chatId) leaveBreakout(parsed.chatId);
          break;
        }

        case "breakout:typing": {
          if (parsed.chatId) volatileChatStore.typing(parsed.chatId, me, Boolean(parsed.isTyping));
          break;
        }

        case "breakout:send": {
          const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
          if (!parsed.chatId || text.length === 0) return;
          if (text.length > MAX_MESSAGE_LENGTH) {
            send({ type: "error", chatId: parsed.chatId, message: `Message longer than ${MAX_MESSAGE_LENGTH} characters` });
            return;
          }
          if (config.rateLimitsEnabled && sendLimiter.hit("send") > 0) {
            send({ type: "error", chatId: parsed.chatId, message: "You're sending messages too fast. Slow down a little." });
            return;
          }
          const meta = volatileChatStore.chat(parsed.chatId);
          if (!meta || !meta.participantIds.includes(me)) return;
          const message: VolatileMessage = {
            id: randomUUID(),
            chatId: parsed.chatId,
            senderId: me,
            text,
            sentAt: new Date().toISOString(),
          };
          volatileChatStore.typing(parsed.chatId, me, false);
          volatileChatStore.append(parsed.chatId, message);
          break;
        }
      }
    });

    socket.on("close", () => {
      clearTimeout(authTimer);
      if (userId) unregisterConnection(userId, socket);
      for (const chatId of [...breakoutUnsubscribers.keys()]) leaveBreakout(chatId);
    });
  });

  return wss;
}

// Re-exported so route handlers can push persisted-chat events without
// importing ws/hub directly in more than one place.
export { sendToUsers };
