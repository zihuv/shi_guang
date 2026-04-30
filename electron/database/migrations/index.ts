import Database from "better-sqlite3";
import fssync from "node:fs";
import path from "node:path";
import { currentTimestamp } from "../shared";
import { migrateLegacySchemaToCurrent } from "./legacy";
import {
  createSchemaTables,
  createSchemaTriggersAndIndexes,
  CURRENT_SCHEMA_VERSION,
} from "./schema";
import { migrateV4ToV5 } from "./v4-to-v5";

export function migrateDatabase(db: Database.Database, dbPath: string): void {
  const userVersion = Number(db.pragma("user_version", { simple: true }) ?? 0);
  const hasSchema = hasTable(db, "files") || hasTable(db, "folders") || hasTable(db, "tags");

  if (!hasSchema) {
    db.transaction(() => {
      createSchemaTables(db);
      createSchemaTriggersAndIndexes(db);
      setSchemaVersion(db, CURRENT_SCHEMA_VERSION);
    })();
    return;
  }

  if (userVersion >= CURRENT_SCHEMA_VERSION) {
    return;
  }

  backupDatabaseBeforeMigration(db, dbPath, userVersion);
  db.transaction(() => {
    runVersionMigrations(db, userVersion);
    setSchemaVersion(db, CURRENT_SCHEMA_VERSION);
  })();
}

function runVersionMigrations(db: Database.Database, userVersion: number): void {
  if (userVersion === 0) {
    migrateLegacySchemaToCurrent(db);
  }
  if (userVersion < 5) {
    migrateV4ToV5(db);
  }
}

function backupDatabaseBeforeMigration(
  db: Database.Database,
  dbPath: string,
  userVersion: number,
): void {
  if (dbPath === ":memory:" || !fssync.existsSync(dbPath)) {
    return;
  }

  db.pragma("wal_checkpoint(FULL)");
  const parsed = path.parse(dbPath);
  const timestamp = `${currentTimestamp().replace(/\D/g, "")}-${Date.now()}`;
  const backupPath = path.join(
    parsed.dir,
    `${parsed.name}.backup-v${userVersion}-${timestamp}${parsed.ext}`,
  );
  fssync.copyFileSync(dbPath, backupPath);
}

function setSchemaVersion(db: Database.Database, version: number): void {
  db.pragma(`user_version = ${version}`);
}

function hasTable(db: Database.Database, tableName: string): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .pluck()
      .get(tableName),
  );
}
