import { WebSocket } from "ws";

const connectionsByUser = new Map<string, Set<WebSocket>>();

export function registerConnection(userId: string, socket: WebSocket): void {
  const set = connectionsByUser.get(userId) ?? new Set();
  set.add(socket);
  connectionsByUser.set(userId, set);
}

export function unregisterConnection(userId: string, socket: WebSocket): void {
  const set = connectionsByUser.get(userId);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) connectionsByUser.delete(userId);
}

export function sendToUser(userId: string, payload: unknown): void {
  const set = connectionsByUser.get(userId);
  if (!set) return;
  const json = JSON.stringify(payload);
  for (const socket of set) {
    if (socket.readyState === WebSocket.OPEN) socket.send(json);
  }
}

export function sendToUsers(userIds: string[], payload: unknown): void {
  for (const id of userIds) sendToUser(id, payload);
}

export function isUserOnline(userId: string): boolean {
  return (connectionsByUser.get(userId)?.size ?? 0) > 0;
}

/** Closes every open socket for a user (used by "sign out everywhere"). */
export function closeUserConnections(userId: string): void {
  for (const socket of connectionsByUser.get(userId) ?? []) socket.close(4401, "Signed out");
}
