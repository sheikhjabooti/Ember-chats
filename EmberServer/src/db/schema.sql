-- Ember schema (SQLite). Applied automatically on server startup by
-- src/db/database.ts — no separate migration step needed for this
-- default setup. For Postgres at scale, port these CREATE TABLE
-- statements with a migration tool of your choice (e.g. node-pg-migrate)
-- — the shapes map over directly.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  status_message TEXT,
  tombstone_logging_enabled INTEGER NOT NULL DEFAULT 0,
  notifications_enabled INTEGER NOT NULL DEFAULT 1,
  fcm_token TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT,
  avatar_url TEXT,
  parent_chat_id TEXT,
  is_persisted INTEGER NOT NULL DEFAULT 1,
  inactivity_timeout_seconds INTEGER NOT NULL DEFAULT 1800,
  created_at TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  last_message_preview TEXT,
  last_message_at TEXT,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_chats_parent ON chats(parent_chat_id);

CREATE TABLE IF NOT EXISTS chat_participants (
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (chat_id, user_id),
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_participants_user ON chat_participants(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  text TEXT,
  sent_at TEXT NOT NULL,
  edited_at TEXT,
  deletion_state TEXT NOT NULL DEFAULT 'none',
  reply_to_message_id TEXT,
  reactions_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_messages_chat_sent ON messages(chat_id, sent_at);

CREATE TABLE IF NOT EXISTS message_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  url TEXT NOT NULL,
  thumbnail_url TEXT,
  duration_seconds REAL,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS breakout_tombstones (
  id TEXT PRIMARY KEY,
  parent_chat_id TEXT NOT NULL,
  participant_ids TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  was_kept INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tombstones_parent ON breakout_tombstones(parent_chat_id);
