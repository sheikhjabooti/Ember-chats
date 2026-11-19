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
  token_version: number;
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

/** Returns which of `ids` belong to real users (order preserved). */
export function existingUserIds(ids: string[]): string[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const rows = db.prepare(`SELECT id FROM users WHERE id IN (${placeholders})`).all(...ids) as { id: string }[];
  const found = new Set(rows.map((r) => r.id));
  return ids.filter((id) => found.has(id));
}

/**
 * Finds people to start a chat with: exact match on email or phone, or a
 * case-insensitive prefix match on display name. Never returns the
 * caller themself.
 */
export function searchUsers(query: string, excludeUserId: string, limit = 20): UserRow[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const escaped = trimmed.toLowerCase().replace(/[!%_]/g, (c) => `!${c}`);
  return db
    .prepare(
      `SELECT * FROM users
       WHERE id != ?
         AND (lower(email) = ? OR phone = ? OR lower(display_name) LIKE ? ESCAPE '!')
       ORDER BY display_name COLLATE NOCASE
       LIMIT ?`
    )
    .all(excludeUserId, trimmed.toLowerCase(), trimmed, `${escaped}%`, limit) as UserRow[];
}

/**
 * What other people may see about a user. Unlike `toPublicUser` (which
 * is for the account owner), this leaves out contact details and
 * settings.
 */
export function toProfile(user: UserRow) {
  return {
    id: user.id,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    statusMessage: user.status_message,
  };
}
