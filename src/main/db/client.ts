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
  return new Database(dbPath);
}
