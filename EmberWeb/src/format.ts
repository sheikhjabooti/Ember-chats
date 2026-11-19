import type { Chat, Me } from "./types";

export function chatTitle(chat: Chat, me: Me, nameOf: (id: string) => string): string {
  if (chat.title) return chat.title;
  const others = chat.participantIds.filter((id) => id !== me.id);
  if (others.length === 0) return "Just you";
  if (chat.kind === "breakout") return `Breakout with ${others.map(nameOf).join(", ")}`;
  return others.map(nameOf).join(", ");
}

export function shortTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}

export function sortChats(chats: Chat[]): Chat[] {
  return [...chats].sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt));
}
