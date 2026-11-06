import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { AUTH_DB_PATH } from "./paths";
import * as schema from "./schema";

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

/**
 * Memoized, unlike the Neon client this replaces: an HTTP client was free to
 * build per call, but a SQLite handle is a real file descriptor and opening one
 * per request would leak them.
 */
export function getDb() {
  if (db) return db;
  const sqlite = new Database(AUTH_DB_PATH);
  sqlite.pragma("busy_timeout = 5000");
  // Switching to WAL upgrades a shared lock to exclusive, so when several processes
  // open a fresh file at once (`next build` collects page data in ~20 workers, each
  // importing auth.ts) SQLite reports the deadlock as SQLITE_BUSY *without* consulting
  // busy_timeout. WAL is persistent in the file, so retrying until one process has
  // won is enough — after that the pragma is a no-op.
  for (let attempt = 0; ; attempt++) {
    try {
      sqlite.pragma("journal_mode = WAL");
      break;
    } catch (error) {
      if ((error as { code?: string }).code !== "SQLITE_BUSY" || attempt >= 50) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 + Math.random() * 80);
    }
  }
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  return db;
}
