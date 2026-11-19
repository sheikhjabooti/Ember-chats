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

/**
 * One WebSocket connection per client, authenticated via `?token=` in
 * the URL (a JWT from POST /auth/login). Handles:
 *  - registering the connection so REST routes can push persisted-chat
 *    messages/typing events to this user (see routes/chats.ts)
 *  - subscribing to a breakout chat's live event stream, bridging
 *    `VolatileChatStore` events straight to the socket
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

    const breakoutUnsubscribers = new Map<string, () => void>();

    socket.on("message", (raw) => {
      let parsed: ClientMessage;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (parsed.type) {
        case "ping":
          socket.send(JSON.stringify({ type: "pong" }));
          break;

        case "breakout:subscribe": {
          if (!parsed.chatId || breakoutUnsubscribers.has(parsed.chatId)) return;
          const meta = volatileChatStore.chat(parsed.chatId);
          if (!meta || !meta.participantIds.includes(userId)) {
            socket.send(JSON.stringify({ type: "error", message: "Cannot subscribe to that breakout chat" }));
            return;
          }
          const unsubscribe = volatileChatStore.onChatEvent(parsed.chatId, (event) => {
            socket.send(JSON.stringify({ ...event, chatId: parsed.chatId }));
          });
          breakoutUnsubscribers.set(parsed.chatId, unsubscribe);
          socket.send(
            JSON.stringify({
              type: "breakout:snapshot",
              chatId: parsed.chatId,
              messages: volatileChatStore.messages(parsed.chatId),
            })
          );
          break;
        }

        case "breakout:unsubscribe": {
          if (!parsed.chatId) return;
          breakoutUnsubscribers.get(parsed.chatId)?.();
          breakoutUnsubscribers.delete(parsed.chatId);
          break;
        }

        case "breakout:send": {
          if (!parsed.chatId || !parsed.text) return;
          const meta = volatileChatStore.chat(parsed.chatId);
          if (!meta || !meta.participantIds.includes(userId)) return;
          const message: VolatileMessage = {
            id: randomUUID(),
            chatId: parsed.chatId,
            senderId: userId,
            text: parsed.text,
            sentAt: new Date().toISOString(),
          };
          volatileChatStore.append(parsed.chatId, message);
          break;
        }
      }
    });

    socket.on("close", () => {
      unregisterConnection(userId, socket);
      for (const unsubscribe of breakoutUnsubscribers.values()) unsubscribe();
      breakoutUnsubscribers.clear();
    });
  });

  return wss;
}

// Re-exported so route handlers can push persisted-chat events without
// importing ws/hub directly in more than one place.
export { sendToUsers };
