import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import { randomUUID } from "crypto";
import { verifyToken } from "../services/auth";
import { registerConnection, unregisterConnection, sendToUsers } from "./hub";
import { volatileChatStore, VolatileMessage } from "../services/volatileChatStore";

interface ClientMessage {
  type: "breakout:subscribe" | "breakout:unsubscribe" | "breakout:send" | "ping";
  chatId?: string;
  text?: string;
}

const MAX_MESSAGE_LENGTH = 4000;

/**
 * One WebSocket connection per client, authenticated via `?token=` in
 * the URL (a JWT from POST /auth/login). Handles:
 *  - registering the connection so REST routes can push persisted-chat
 *    messages/typing events to this user (see routes/chats.ts)
 *  - subscribing to a breakout chat's live event stream, bridging
 *    `VolatileChatStore` events straight to the socket
 *  - presence: a subscription counts as "viewing" the breakout, and when
 *    nobody is viewing it any more the store starts the clearance
 *    countdown after a grace period
 *  - sending breakout messages directly over the socket (lower latency
 *    than the REST fallback in routes/breakouts.ts)
 */
export function attachWebSocketServer(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (socket: WebSocket, request) => {
    const url = new URL(request.url ?? "", "http://localhost");
    const token = url.searchParams.get("token");
    let userId: string;
    try {
      if (!token) throw new Error("missing token");
      userId = verifyToken(token).sub;
    } catch {
      socket.close(4401, "Unauthorized");
      return;
    }

    registerConnection(userId, socket);

    const send = (payload: unknown) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
    };

    const breakoutUnsubscribers = new Map<string, () => void>();

    const leaveBreakout = (chatId: string) => {
      const unsubscribe = breakoutUnsubscribers.get(chatId);
      if (!unsubscribe) return;
      unsubscribe();
      breakoutUnsubscribers.delete(chatId);
      volatileChatStore.viewerLeft(chatId, userId);
    };

    socket.on("message", (raw) => {
      let parsed: ClientMessage;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (parsed.type) {
        case "ping":
          send({ type: "pong" });
          break;

        case "breakout:subscribe": {
          const chatId = parsed.chatId;
          if (!chatId || breakoutUnsubscribers.has(chatId)) return;
          const meta = volatileChatStore.chat(chatId);
          if (!meta || !meta.participantIds.includes(userId)) {
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
            breakout: { ...meta },
            messages: volatileChatStore.messages(chatId),
          });
          // Joining can cancel an "everyone left" countdown, which emits
          // `warningCancelled`, so do it after the snapshot is sent.
          volatileChatStore.viewerJoined(chatId, userId);
          break;
        }

        case "breakout:unsubscribe": {
          if (parsed.chatId) leaveBreakout(parsed.chatId);
          break;
        }

        case "breakout:send": {
          const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
          if (!parsed.chatId || text.length === 0) return;
          if (text.length > MAX_MESSAGE_LENGTH) {
            send({ type: "error", chatId: parsed.chatId, message: `Message longer than ${MAX_MESSAGE_LENGTH} characters` });
            return;
          }
          const meta = volatileChatStore.chat(parsed.chatId);
          if (!meta || !meta.participantIds.includes(userId)) return;
          const message: VolatileMessage = {
            id: randomUUID(),
            chatId: parsed.chatId,
            senderId: userId,
            text,
            sentAt: new Date().toISOString(),
          };
          volatileChatStore.append(parsed.chatId, message);
          break;
        }
      }
    });

    socket.on("close", () => {
      unregisterConnection(userId, socket);
      for (const chatId of [...breakoutUnsubscribers.keys()]) leaveBreakout(chatId);
    });
  });

  return wss;
}

// Re-exported so route handlers can push persisted-chat events without
// importing ws/hub directly in more than one place.
export { sendToUsers };
