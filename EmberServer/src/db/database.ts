import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { config } from "../config";

export const db = new Database(config.databaseFile);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// schema.sql is the original baseline (version 0). Every later change is a
// numbered migration below, so databases created by older versions are
// upgraded in place. SQLite's `user_version` records how far a file got.
const schemaPath = path.join(__dirname, "schema.sql");
db.exec(fs.readFileSync(schemaPath, "utf-8"));

const migrations: string[] = [
  // 1: system messages, read tracking, "sign out everywhere".
  `
  ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text';
  ALTER TABLE chat_participants ADD COLUMN last_read_at TEXT;
  ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
  `,
];

const current = db.pragma("user_version", { simple: true }) as number;
for (let version = current; version < migrations.length; version++) {
  db.transaction(() => {
    db.exec(migrations[version]);
    db.pragma(`user_version = ${version + 1}`);
  })();
}
