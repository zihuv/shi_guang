use super::*;

impl Database {
    pub fn new(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        let db = Database { conn };
        db.init_tables()?;
        Ok(db)
    }

    fn init_tables(&self) -> Result<()> {
        // Enable foreign keys
        let _ = self.conn.execute_batch("PRAGMA foreign_keys = ON;");
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS folders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                parent_id INTEGER,
                created_at TEXT NOT NULL,
                is_system INTEGER DEFAULT 0,
                sort_order INTEGER DEFAULT 0,
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
                rating INTEGER NOT NULL DEFAULT 0,
                description TEXT NOT NULL DEFAULT '',
                source_url TEXT NOT NULL DEFAULT '',
                dominant_color TEXT NOT NULL DEFAULT '',
                dominant_r INTEGER,
                dominant_g INTEGER,
                dominant_b INTEGER,
                color_distribution TEXT NOT NULL DEFAULT '[]',
                deleted_at TEXT DEFAULT NULL,
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

            CREATE TABLE IF NOT EXISTS file_embeddings (
                file_id INTEGER PRIMARY KEY,
                model TEXT NOT NULL,
                dimensions INTEGER NOT NULL,
                embedding BLOB,
                search_text TEXT NOT NULL DEFAULT '',
                source_updated_at TEXT NOT NULL,
                indexed_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                last_error TEXT NOT NULL DEFAULT '',
                FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
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
            ",
        )?;

        // Add folder_id column if it doesn't exist (for migration)
        let has_folder_id: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('files') WHERE name = 'folder_id'",
            [],
            |row| row.get(0),
        )?;
        if has_folder_id == 0 {
            self.conn.execute(
                "ALTER TABLE files ADD COLUMN folder_id INTEGER REFERENCES folders(id)",
                [],
            )?;
        }

        // Add imported_at column if it doesn't exist (for migration)
        let has_imported_at: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('files') WHERE name = 'imported_at'",
            [],
            |row| row.get(0),
        )?;
        if has_imported_at == 0 {
            // SQLite doesn't support adding a column with non-constant default
            // Add it as nullable first, then update with modified_at as fallback
            self.conn
                .execute("ALTER TABLE files ADD COLUMN imported_at TEXT", [])?;
            // Update existing records with modified_at value
            self.conn.execute(
                "UPDATE files SET imported_at = modified_at WHERE imported_at IS NULL",
                [],
            )?;
        }

        // Add rating column if it doesn't exist (for migration)
        let has_rating: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('files') WHERE name = 'rating'",
            [],
            |row| row.get(0),
        )?;
        if has_rating == 0 {
            self.conn
                .execute("ALTER TABLE files ADD COLUMN rating INTEGER DEFAULT 0", [])?;
        }

        // Add description column if it doesn't exist (for migration)
        let has_description: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('files') WHERE name = 'description'",
            [],
            |row| row.get(0),
        )?;
        if has_description == 0 {
            self.conn.execute(
                "ALTER TABLE files ADD COLUMN description TEXT DEFAULT ''",
                [],
            )?;
        }

        // Add source_url column if it doesn't exist (for migration)
        let has_source_url: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('files') WHERE name = 'source_url'",
            [],
            |row| row.get(0),
        )?;
        if has_source_url == 0 {
            self.conn.execute(
                "ALTER TABLE files ADD COLUMN source_url TEXT DEFAULT ''",
                [],
            )?;
        }

        // Add dominant_color column if it doesn't exist (for migration)
        let has_dominant_color: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('files') WHERE name = 'dominant_color'",
            [],
            |row| row.get(0),
        )?;
        if has_dominant_color == 0 {
            self.conn.execute(
                "ALTER TABLE files ADD COLUMN dominant_color TEXT DEFAULT ''",
                [],
            )?;
        }

        let has_dominant_r: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('files') WHERE name = 'dominant_r'",
            [],
            |row| row.get(0),
        )?;
        if has_dominant_r == 0 {
            self.conn
                .execute("ALTER TABLE files ADD COLUMN dominant_r INTEGER", [])?;
        }

        let has_dominant_g: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('files') WHERE name = 'dominant_g'",
            [],
            |row| row.get(0),
        )?;
        if has_dominant_g == 0 {
            self.conn
                .execute("ALTER TABLE files ADD COLUMN dominant_g INTEGER", [])?;
        }

        let has_dominant_b: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('files') WHERE name = 'dominant_b'",
            [],
            |row| row.get(0),
        )?;
        if has_dominant_b == 0 {
            self.conn
                .execute("ALTER TABLE files ADD COLUMN dominant_b INTEGER", [])?;
        }

        // Add color_distribution column if it doesn't exist (for migration)
        let has_color_distribution: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('files') WHERE name = 'color_distribution'",
            [],
            |row| row.get(0),
        )?;
        if has_color_distribution == 0 {
            self.conn.execute(
                "ALTER TABLE files ADD COLUMN color_distribution TEXT DEFAULT '[]'",
                [],
            )?;
        }

        // Add sort_order column to folders if it doesn't exist (for migration)
        let has_folder_sort_order: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('folders') WHERE name = 'sort_order'",
            [],
            |row| row.get(0),
        )?;
        if has_folder_sort_order == 0 {
            self.conn.execute(
                "ALTER TABLE folders ADD COLUMN sort_order INTEGER DEFAULT 0",
                [],
            )?;
        }

        // Add sort_order column to tags if it doesn't exist (for migration)
        let has_tag_sort_order: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('tags') WHERE name = 'sort_order'",
            [],
            |row| row.get(0),
        )?;
        if has_tag_sort_order == 0 {
            self.conn.execute(
                "ALTER TABLE tags ADD COLUMN sort_order INTEGER DEFAULT 0",
                [],
            )?;
        }

        let has_tag_parent_id: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('tags') WHERE name = 'parent_id'",
            [],
            |row| row.get(0),
        )?;
        if has_tag_parent_id == 0 {
            self.conn
                .execute("ALTER TABLE tags ADD COLUMN parent_id INTEGER", [])?;
        }

        // Add deleted_at column to files if it doesn't exist (for migration)
        let has_deleted_at: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('files') WHERE name = 'deleted_at'",
            [],
            |row| row.get(0),
        )?;
        if has_deleted_at == 0 {
            self.conn.execute(
                "ALTER TABLE files ADD COLUMN deleted_at TEXT DEFAULT NULL",
                [],
            )?;
        }

        let has_sync_id: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('files') WHERE name = 'sync_id'",
            [],
            |row| row.get(0),
        )?;
        if has_sync_id == 0 {
            self.conn
                .execute("ALTER TABLE files ADD COLUMN sync_id TEXT", [])?;
        }

        let has_content_hash: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('files') WHERE name = 'content_hash'",
            [],
            |row| row.get(0),
        )?;
        if has_content_hash == 0 {
            self.conn
                .execute("ALTER TABLE files ADD COLUMN content_hash TEXT", [])?;
        }

        let has_fs_modified_at: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('files') WHERE name = 'fs_modified_at'",
            [],
            |row| row.get(0),
        )?;
        if has_fs_modified_at == 0 {
            self.conn
                .execute("ALTER TABLE files ADD COLUMN fs_modified_at TEXT", [])?;
        }

        let has_updated_at: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('files') WHERE name = 'updated_at'",
            [],
            |row| row.get(0),
        )?;
        if has_updated_at == 0 {
            self.conn
                .execute("ALTER TABLE files ADD COLUMN updated_at TEXT", [])?;
        }

        let has_folder_sync_id: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('folders') WHERE name = 'sync_id'",
            [],
            |row| row.get(0),
        )?;
        if has_folder_sync_id == 0 {
            self.conn
                .execute("ALTER TABLE folders ADD COLUMN sync_id TEXT", [])?;
        }

        let has_folder_updated_at: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('folders') WHERE name = 'updated_at'",
            [],
            |row| row.get(0),
        )?;
        if has_folder_updated_at == 0 {
            self.conn
                .execute("ALTER TABLE folders ADD COLUMN updated_at TEXT", [])?;
        }

        let has_tag_sync_id: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('tags') WHERE name = 'sync_id'",
            [],
            |row| row.get(0),
        )?;
        if has_tag_sync_id == 0 {
            self.conn
                .execute("ALTER TABLE tags ADD COLUMN sync_id TEXT", [])?;
        }

        let has_tag_updated_at: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('tags') WHERE name = 'updated_at'",
            [],
            |row| row.get(0),
        )?;
        if has_tag_updated_at == 0 {
            self.conn
                .execute("ALTER TABLE tags ADD COLUMN updated_at TEXT", [])?;
        }

        super::migrations::run_migrations(self)?;
        self.create_triggers()?;
        self.create_indexes()?;

        // Initialize default settings if not exist
        self.conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES ('use_trash', 'true')",
            [],
        )?;

        Ok(())
    }

    fn create_triggers(&self) -> Result<()> {
        self.conn.execute_batch(
            "
            DROP TRIGGER IF EXISTS update_files_modified_at;
            DROP TRIGGER IF EXISTS update_files_updated_at;
            DROP TRIGGER IF EXISTS update_folders_updated_at;
            DROP TRIGGER IF EXISTS update_tags_updated_at;
            DROP TRIGGER IF EXISTS update_file_tags_file_updated_at_insert;
            DROP TRIGGER IF EXISTS update_file_tags_file_updated_at_delete;

            CREATE TRIGGER IF NOT EXISTS update_files_updated_at
            AFTER UPDATE ON files
            FOR EACH ROW
            WHEN NEW.updated_at = OLD.updated_at
            BEGIN
                UPDATE files
                SET updated_at = datetime('now', 'localtime')
                WHERE id = OLD.id;
            END;

            CREATE TRIGGER IF NOT EXISTS update_folders_updated_at
            AFTER UPDATE ON folders
            FOR EACH ROW
            WHEN NEW.updated_at = OLD.updated_at
            BEGIN
                UPDATE folders
                SET updated_at = datetime('now', 'localtime')
                WHERE id = OLD.id;
            END;

            CREATE TRIGGER IF NOT EXISTS update_tags_updated_at
            AFTER UPDATE ON tags
            FOR EACH ROW
            WHEN NEW.updated_at = OLD.updated_at
            BEGIN
                UPDATE tags
                SET updated_at = datetime('now', 'localtime')
                WHERE id = OLD.id;
            END;

            CREATE TRIGGER IF NOT EXISTS update_file_tags_file_updated_at_insert
            AFTER INSERT ON file_tags
            FOR EACH ROW
            BEGIN
                UPDATE files
                SET updated_at = datetime('now', 'localtime')
                WHERE id = NEW.file_id;
            END;

            CREATE TRIGGER IF NOT EXISTS update_file_tags_file_updated_at_delete
            AFTER DELETE ON file_tags
            FOR EACH ROW
            BEGIN
                UPDATE files
                SET updated_at = datetime('now', 'localtime')
                WHERE id = OLD.file_id;
            END;
            ",
        )?;

        Ok(())
    }

    fn create_indexes(&self) -> Result<()> {
        self.conn.execute_batch(
            "
            CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);
            CREATE INDEX IF NOT EXISTS idx_files_ext ON files(ext);
            CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
            CREATE INDEX IF NOT EXISTS idx_files_folder_id ON files(folder_id);
            CREATE INDEX IF NOT EXISTS idx_files_active_order ON files(deleted_at, imported_at DESC, id ASC);
            CREATE INDEX IF NOT EXISTS idx_files_folder_active_order ON files(folder_id, deleted_at, imported_at DESC, id ASC);
            CREATE INDEX IF NOT EXISTS idx_files_dominant_rgb ON files(dominant_r, dominant_g, dominant_b);
            CREATE INDEX IF NOT EXISTS idx_files_deleted_at ON files(deleted_at);
            CREATE INDEX IF NOT EXISTS idx_files_sync_id ON files(sync_id);
            CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id);
            CREATE INDEX IF NOT EXISTS idx_folders_parent_sort_order ON folders(parent_id, sort_order, name);
            CREATE INDEX IF NOT EXISTS idx_folders_sync_id ON folders(sync_id);
            CREATE INDEX IF NOT EXISTS idx_tags_parent_id ON tags(parent_id);
            CREATE INDEX IF NOT EXISTS idx_tags_parent_sort_order ON tags(parent_id, sort_order, name);
            CREATE INDEX IF NOT EXISTS idx_tags_sync_id ON tags(sync_id);
            CREATE INDEX IF NOT EXISTS idx_file_tags_tag_id_file_id ON file_tags(tag_id, file_id);
            CREATE INDEX IF NOT EXISTS idx_file_embeddings_model_status ON file_embeddings(model, status);
            CREATE INDEX IF NOT EXISTS idx_file_visual_embeddings_model_status ON file_visual_embeddings(model_id, status);
            "
        )?;

        Ok(())
    }
}
