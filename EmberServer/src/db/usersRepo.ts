import { randomUUID } from "crypto";
import { db } from "../db/database";

export interface UserRow {
  id: string;
  email: string | null;
  phone: string | null;
  password_hash: string;
  display_name: string;
  avatar_url: string | null;
  status_message: string | null;
  tombstone_logging_enabled: number;
  notifications_enabled: number;
  fcm_token: string | null;
  created_at: string;
}

export function findByEmailOrPhone(email?: string, phone?: string): UserRow | undefined {
  if (email) {
    const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
    if (row) return row;
  }
  if (phone) {
    return db.prepare("SELECT * FROM users WHERE phone = ?").get(phone) as UserRow | undefined;
  }
  return undefined;
}

export function findById(id: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export function createUser(input: {
  email?: string;
  phone?: string;
  passwordHash: string;
  displayName: string;
}): UserRow {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO users (id, email, phone, password_hash, display_name)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, input.email ?? null, input.phone ?? null, input.passwordHash, input.displayName);
  return findById(id)!;
}

export function updateUser(
  id: string,
  fields: Partial<{
    displayName: string;
    statusMessage: string;
    tombstoneLoggingEnabled: boolean;
    notificationsEnabled: boolean;
    fcmToken: string;
  }>
): UserRow {
  const columnMap: Record<string, string> = {
    displayName: "display_name",
    statusMessage: "status_message",
    tombstoneLoggingEnabled: "tombstone_logging_enabled",
    notificationsEnabled: "notifications_enabled",
    fcmToken: "fcm_token",
  };
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    sets.push(`${columnMap[key]} = ?`);
    values.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
  }
  if (sets.length > 0) {
    values.push(id);
    db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  }
  return findById(id)!;
}

export function toPublicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    statusMessage: user.status_message,
    tombstoneLoggingEnabled: !!user.tombstone_logging_enabled,
    notificationsEnabled: !!user.notifications_enabled,
  };
}
