import Database from "better-sqlite3";

export const CURRENT_SCHEMA_VERSION = 4;

export function createSchemaTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      parent_id INTEGER,
      created_at TEXT NOT NULL,
      is_system INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      deleted_at TEXT DEFAULT NULL,
      sync_id TEXT NOT NULL UNIQUE,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      ext TEXT NOT NULL,
      size INTEGER NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      modified_at TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      last_accessed_at TEXT DEFAULT NULL,
      rating INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      dominant_color TEXT NOT NULL DEFAULT '',
      dominant_r INTEGER,
      dominant_g INTEGER,
      dominant_b INTEGER,
      color_distribution TEXT NOT NULL DEFAULT '[]',
      thumb_hash TEXT NOT NULL DEFAULT '',
      deleted_at TEXT DEFAULT NULL,
      missing_at TEXT DEFAULT NULL,
      sync_id TEXT NOT NULL UNIQUE,
      content_hash TEXT,
      fs_modified_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL,
      parent_id INTEGER,
      sort_order INTEGER DEFAULT 0,
      sync_id TEXT NOT NULL UNIQUE,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (parent_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS file_tags (
      file_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (file_id, tag_id),
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS index_paths (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS folder_trash_entries (
      folder_id INTEGER PRIMARY KEY,
      temp_path TEXT NOT NULL,
      deleted_at TEXT NOT NULL,
      file_count INTEGER NOT NULL DEFAULT 0,
      subfolder_count INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS file_visual_embeddings (
      file_id INTEGER PRIMARY KEY,
      model_id TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      embedding BLOB,
      source_size INTEGER NOT NULL,
      source_modified_at TEXT NOT NULL,
      source_content_hash TEXT,
      indexed_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      last_error TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
    );
  `);
}

export function createSchemaTriggersAndIndexes(db: Database.Database): void {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS update_files_updated_at
    AFTER UPDATE ON files
    FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN
      UPDATE files SET updated_at = datetime('now', 'localtime') WHERE id = OLD.id;
    END;

    CREATE TRIGGER IF NOT EXISTS update_folders_updated_at
    AFTER UPDATE ON folders
    FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN
      UPDATE folders SET updated_at = datetime('now', 'localtime') WHERE id = OLD.id;
    END;

    CREATE TRIGGER IF NOT EXISTS update_tags_updated_at
    AFTER UPDATE ON tags
    FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN
      UPDATE tags SET updated_at = datetime('now', 'localtime') WHERE id = OLD.id;
    END;

    CREATE TRIGGER IF NOT EXISTS update_file_tags_file_updated_at_insert
    AFTER INSERT ON file_tags
    FOR EACH ROW
    BEGIN
      UPDATE files SET updated_at = datetime('now', 'localtime') WHERE id = NEW.file_id;
    END;

    CREATE TRIGGER IF NOT EXISTS update_file_tags_file_updated_at_delete
    AFTER DELETE ON file_tags
    FOR EACH ROW
    BEGIN
      UPDATE files SET updated_at = datetime('now', 'localtime') WHERE id = OLD.file_id;
    END;

    CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);
    CREATE INDEX IF NOT EXISTS idx_files_ext ON files(ext);
    CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
    CREATE INDEX IF NOT EXISTS idx_files_folder_id ON files(folder_id);
    DROP INDEX IF EXISTS idx_files_active_order;
    DROP INDEX IF EXISTS idx_files_folder_active_order;
    CREATE INDEX IF NOT EXISTS idx_files_active_order ON files(deleted_at, missing_at, imported_at DESC, id ASC);
    CREATE INDEX IF NOT EXISTS idx_files_folder_active_order ON files(folder_id, deleted_at, missing_at, imported_at DESC, id ASC);
    CREATE INDEX IF NOT EXISTS idx_files_dominant_rgb ON files(dominant_r, dominant_g, dominant_b);
    CREATE INDEX IF NOT EXISTS idx_files_deleted_at ON files(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_files_missing_at ON files(missing_at);
    CREATE INDEX IF NOT EXISTS idx_files_last_accessed_at ON files(last_accessed_at);
    CREATE INDEX IF NOT EXISTS idx_files_content_hash ON files(content_hash);
    CREATE INDEX IF NOT EXISTS idx_files_sync_id ON files(sync_id);
    CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id);
    CREATE INDEX IF NOT EXISTS idx_folders_parent_sort_order ON folders(parent_id, sort_order, name);
    CREATE INDEX IF NOT EXISTS idx_folders_deleted_at ON folders(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_folders_sync_id ON folders(sync_id);
    CREATE INDEX IF NOT EXISTS idx_folder_trash_entries_deleted_at ON folder_trash_entries(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_tags_parent_id ON tags(parent_id);
    CREATE INDEX IF NOT EXISTS idx_tags_parent_sort_order ON tags(parent_id, sort_order, name);
    CREATE INDEX IF NOT EXISTS idx_tags_sync_id ON tags(sync_id);
    CREATE INDEX IF NOT EXISTS idx_file_tags_tag_id_file_id ON file_tags(tag_id, file_id);
    CREATE INDEX IF NOT EXISTS idx_file_visual_embeddings_model_status ON file_visual_embeddings(model_id, status);
  `);
}
