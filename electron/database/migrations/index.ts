import Database from "better-sqlite3";
import fssync from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { currentTimestamp } from "../shared";
import { schema } from "../schema";

const DRIZZLE_MIGRATIONS_TABLE = "__drizzle_migrations__";
const APP_TABLES = [
  "file_visual_embeddings",
  "folder_trash_entries",
  "file_tags",
  "files",
  "tags",
  "folders",
  "settings",
  "index_paths",
] as const;

export function migrateDatabase(db: Database.Database, dbPath: string): void {
  let resetBackupPath: string | null = null;
  if (hasUnmanagedAppSchema(db)) {
    resetBackupPath = backupDatabaseBeforeReset(db, dbPath);
    resetAppSchema(db);
  }

  const drizzleDb = drizzle(db, { schema });
  try {
    migrate(drizzleDb, {
      migrationsFolder: resolveMigrationsFolder(),
      migrationsTable: DRIZZLE_MIGRATIONS_TABLE,
    });
  } catch (error) {
    const backupMessage = resetBackupPath ? ` Backup saved at: ${resetBackupPath}` : "";
    const wrapped = new Error(`Failed to apply Drizzle migrations.${backupMessage}`);
    (wrapped as Error & { cause?: unknown }).cause = error;
    throw wrapped;
  }
}

function hasUnmanagedAppSchema(db: Database.Database): boolean {
  return (
    !hasTable(db, DRIZZLE_MIGRATIONS_TABLE) &&
    APP_TABLES.some((tableName) => hasTable(db, tableName))
  );
}

function resetAppSchema(db: Database.Database): void {
  db.transaction(() => {
    for (const tableName of APP_TABLES) {
      db.prepare(`DROP TABLE IF EXISTS ${tableName}`).run();
    }
  })();
}

function backupDatabaseBeforeReset(db: Database.Database, dbPath: string): string | null {
  if (dbPath === ":memory:" || !fssync.existsSync(dbPath)) {
    return null;
  }

  db.pragma("wal_checkpoint(FULL)");
  const parsed = path.parse(dbPath);
  const timestamp = `${currentTimestamp().replace(/\D/g, "")}-${Date.now()}`;
  const backupPath = path.join(
    parsed.dir,
    `${parsed.name}.backup-before-drizzle-${timestamp}${parsed.ext}`,
  );
  fssync.copyFileSync(dbPath, backupPath);
  return backupPath;
}

function resolveMigrationsFolder(): string {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidates = [
    process.env.SHIGUANG_MIGRATIONS_DIR,
    path.resolve(process.cwd(), "drizzle"),
    resourcesPath ? path.join(resourcesPath, "app.asar", "drizzle") : null,
    resourcesPath ? path.join(resourcesPath, "app", "drizzle") : null,
    path.resolve(__dirname, "../../drizzle"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const migrationsFolder = candidates.find((candidate) =>
    fssync.existsSync(path.join(candidate, "meta", "_journal.json")),
  );
  if (!migrationsFolder) {
    throw new Error(`Unable to find Drizzle migrations folder. Checked: ${candidates.join(", ")}`);
  }
  return migrationsFolder;
}

function hasTable(db: Database.Database, tableName: string): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .pluck()
      .get(tableName),
  );
}
