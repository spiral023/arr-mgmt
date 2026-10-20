import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export type AppDatabase = Database.Database;

export function createInMemoryDatabase(): AppDatabase {
  return new Database(":memory:");
}

export function createAppDatabase(filePath?: string): AppDatabase {
  const dbPath = filePath ?? join(process.cwd(), "arr-ops.sqlite");
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  // Keep readers (including the companion CLI) independent of short write transactions.
  // Retain SQLite's FULL durability; no reduced synchronous setting is needed.
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = FULL");
  db.pragma("busy_timeout = 5000");
  return db;
}
