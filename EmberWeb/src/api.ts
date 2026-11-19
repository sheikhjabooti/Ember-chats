import type { Breakout, Chat, Me, Message, Profile } from "./types";

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

let token: string | null = null;
let onUnauthorized: () => void = () => {};

export function setToken(value: string | null) {
  token = value;
}

export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

/** Turns the server's error bodies (plain strings or zod `flatten()` output) into one sentence. */
function errorMessage(body: unknown, status: number): string {
  const err = (body as { error?: unknown } | undefined)?.error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const flat = err as { formErrors?: string[]; fieldErrors?: Record<string, string[] | undefined> };
    const parts = [
      ...(flat.formErrors ?? []),
      ...Object.entries(flat.fieldErrors ?? {}).flatMap(([field, msgs]) => (msgs ?? []).map((m) => `${field}: ${m}`)),
    ];
    if (parts.length > 0) return parts.join(". ");
  }
  return `Request failed (${status})`;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Can't reach the Ember server. Is it running?", 0);
  }

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }

  if (res.status === 401 && token) onUnauthorized();
  if (!res.ok) throw new ApiError(errorMessage(parsed, res.status), res.status);
  return parsed as T;
}

interface AuthResponse {
  token: string;
  user: Me;
}

export const api = {
  register: (email: string, password: string, displayName: string) =>
    request<AuthResponse>("POST", "/auth/register", { email, password, displayName }),
  login: (email: string, password: string) => request<AuthResponse>("POST", "/auth/login", { email, password }),
  me: () => request<Me>("GET", "/auth/me"),
  logoutEverywhere: () => request<void>("POST", "/auth/logout-all", {}),
  updateMe: (fields: Partial<Pick<Me, "displayName" | "statusMessage" | "tombstoneLoggingEnabled" | "notificationsEnabled">>) =>
    request<Me>("PATCH", "/users/me", fields),

  searchUsers: (q: string) => request<Profile[]>("GET", `/users/search?q=${encodeURIComponent(q)}`),
  user: (id: string) => request<Profile>("GET", `/users/${encodeURIComponent(id)}`),

  chats: () => request<Chat[]>("GET", "/chats"),
  chat: (id: string) => request<Chat>("GET", `/chats/${id}`),
  createChat: (kind: "direct" | "group", participantIds: string[], title?: string) =>
    request<Chat>("POST", "/chats", { kind, participantIds, title }),
  renameChat: (id: string, title: string | null) => request<Chat>("PATCH", `/chats/${id}`, { title }),
  addMembers: (id: string, userIds: string[]) => request<Chat>("POST", `/chats/${id}/participants`, { userIds }),
  removeMember: (id: string, userId: string) => request<void>("DELETE", `/chats/${id}/participants/${userId}`),

  messages: (chatId: string, before?: string, limit = 30) =>
    request<Message[]>(
      "GET",
      `/chats/${chatId}/messages?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ""}`
    ),
  sendMessage: (chatId: string, text: string, replyToMessageId?: string) =>
    request<Message>("POST", `/chats/${chatId}/messages`, { text, replyToMessageId }),
  editMessage: (chatId: string, messageId: string, text: string) =>
    request<Message>("PATCH", `/chats/${chatId}/messages/${messageId}`, { text }),
  deleteMessage: (chatId: string, messageId: string) => request<Message>("DELETE", `/chats/${chatId}/messages/${messageId}`),
  react: (chatId: string, messageId: string, emoji: string) =>
    request<Message>("POST", `/chats/${chatId}/messages/${messageId}/reactions`, { emoji }),
  markRead: (chatId: string, upToMessageId?: string) =>
    request<{ lastReadAt: string }>("POST", `/chats/${chatId}/read`, { upToMessageId }),
  typing: (chatId: string, isTyping: boolean) => request<void>("POST", `/chats/${chatId}/typing`, { isTyping }),

  activeBreakouts: (chatId: string) => request<{ active: Breakout[] }>("GET", `/chats/${chatId}/breakouts`),
  keptBreakouts: () => request<Chat[]>("GET", "/breakouts/kept"),
  startBreakout: (chatId: string, participantIds: string[]) =>
    request<Breakout>("POST", `/chats/${chatId}/breakout`, { participantIds }),
  keepBreakout: (id: string) =>
    request<{ id: string; status: "pending" | "kept"; secondsRemaining?: number }>("POST", `/breakouts/${id}/keep`, {}),
  respondToKeep: (id: string, allow: boolean) => request<void>("POST", `/breakouts/${id}/keep/respond`, { allow }),
  endBreakout: (id: string) => request<void>("POST", `/breakouts/${id}/end`, {}),
};
