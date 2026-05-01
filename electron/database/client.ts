import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { schema } from "./schema";

export type ShiguangDrizzleDb = BetterSQLite3Database<typeof schema>;

const drizzleClients = new WeakMap<Database.Database, ShiguangDrizzleDb>();

export function getDrizzleDb(db: Database.Database): ShiguangDrizzleDb {
  const existing = drizzleClients.get(db);
  if (existing) {
    return existing;
  }
  const client = drizzle(db, { schema });
  drizzleClients.set(db, client);
  return client;
}
