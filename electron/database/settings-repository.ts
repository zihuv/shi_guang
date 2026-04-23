import Database from "better-sqlite3";

export function getIndexPaths(db: Database.Database): string[] {
  return (
    db.prepare("SELECT path FROM index_paths ORDER BY id ASC LIMIT 1").all() as Array<{
      path: string;
    }>
  ).map((row) => row.path);
}

export function setIndexPath(db: Database.Database, indexPath: string): void {
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM index_paths").run();
    db.prepare("INSERT INTO index_paths (path) VALUES (?)").run(indexPath);
  });
  transaction();
}

export function addIndexPath(db: Database.Database, indexPath: string): void {
  const current = getIndexPaths(db)[0];
  if (current && current !== indexPath) {
    throw new Error("Only one index path is supported");
  }
  db.prepare("INSERT OR IGNORE INTO index_paths (path) VALUES (?)").run(indexPath);
}

export function removeIndexPath(db: Database.Database, indexPath: string): void {
  db.prepare("DELETE FROM index_paths WHERE path = ?").run(indexPath);
}

export function getSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}
