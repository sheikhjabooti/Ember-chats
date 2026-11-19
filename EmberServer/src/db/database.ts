import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const dbFile = process.env.DATABASE_FILE ?? "./ember.db";

export const db = new Database(dbFile);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const schemaPath = path.join(__dirname, "schema.sql");
db.exec(fs.readFileSync(schemaPath, "utf-8"));
