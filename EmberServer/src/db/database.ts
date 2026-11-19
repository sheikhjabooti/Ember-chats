import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { config } from "../config";

export const db = new Database(config.databaseFile);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const schemaPath = path.join(__dirname, "schema.sql");
db.exec(fs.readFileSync(schemaPath, "utf-8"));
