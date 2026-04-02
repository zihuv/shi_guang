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
                deleted_at TEXT DEFAULT NULL
            );

            -- Trigger to automatically update modified_at when any field is updated
            CREATE TRIGGER IF NOT EXISTS update_files_modified_at
            AFTER UPDATE ON files
            FOR EACH ROW
            WHEN NEW.modified_at = OLD.modified_at
            BEGIN
                UPDATE files
                SET modified_at = datetime('now', 'localtime')
                WHERE id = OLD.id;
            END;

            CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                color TEXT NOT NULL,
                parent_id INTEGER,
                sort_order INTEGER DEFAULT 0,
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

        self.run_migrations()?;
        self.create_indexes()?;

        // Initialize default settings if not exist
        self.conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES ('use_trash', 'true')",
            [],
        )?;

        Ok(())
    }

    fn run_migrations(&self) -> Result<()> {
        let current_version: i32 = self
            .conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))?;

        if current_version < 1 {
            self.migrate_files_table()?;
        }

        if current_version < 2 {
            self.normalize_existing_data()?;
        }

        if current_version < 3 {
            self.backfill_dominant_color_channels()?;
        }

        if current_version < 4 {
            self.normalize_browser_collection_folder()?;
        }

        self.conn
            .execute_batch(&format!("PRAGMA user_version = {};", DB_SCHEMA_VERSION))?;
        Ok(())
    }

    fn migrate_files_table(&self) -> Result<()> {
        self.conn.execute_batch(
            "
            BEGIN IMMEDIATE;
            PRAGMA foreign_keys = OFF;

            DROP TRIGGER IF EXISTS update_files_modified_at;
            DROP TABLE IF EXISTS files_new;

            CREATE TABLE IF NOT EXISTS files_new (
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
                deleted_at TEXT DEFAULT NULL
            );

            INSERT INTO files_new (
                id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at,
                rating, description, source_url, dominant_color, dominant_r, dominant_g, dominant_b, color_distribution, deleted_at
            )
            SELECT
                id,
                path,
                name,
                ext,
                size,
                width,
                height,
                CASE
                    WHEN folder_id IS NULL THEN NULL
                    WHEN EXISTS (SELECT 1 FROM folders WHERE folders.id = files.folder_id) THEN folder_id
                    ELSE NULL
                END,
                COALESCE(created_at, datetime('now', 'localtime')),
                COALESCE(modified_at, created_at, datetime('now', 'localtime')),
                COALESCE(imported_at, modified_at, created_at, datetime('now', 'localtime')),
                COALESCE(rating, 0),
                COALESCE(description, ''),
                COALESCE(source_url, ''),
                COALESCE(dominant_color, ''),
                NULL,
                NULL,
                NULL,
                CASE
                    WHEN color_distribution IS NULL OR trim(color_distribution) = '' THEN '[]'
                    ELSE color_distribution
                END,
                deleted_at
            FROM files;

            DROP TABLE files;
            ALTER TABLE files_new RENAME TO files;

            CREATE TRIGGER IF NOT EXISTS update_files_modified_at
            AFTER UPDATE ON files
            FOR EACH ROW
            WHEN NEW.modified_at = OLD.modified_at
            BEGIN
                UPDATE files
                SET modified_at = datetime('now', 'localtime')
                WHERE id = OLD.id;
            END;

            PRAGMA foreign_keys = ON;
            COMMIT;
            "
        )?;

        Ok(())
    }

    fn normalize_existing_data(&self) -> Result<()> {
        self.conn.execute_batch(
            "
            UPDATE files
            SET imported_at = COALESCE(NULLIF(imported_at, ''), modified_at, created_at, datetime('now', 'localtime'))
            WHERE imported_at IS NULL OR imported_at = '';

            UPDATE files
            SET description = COALESCE(description, ''),
                source_url = COALESCE(source_url, ''),
                dominant_color = COALESCE(dominant_color, ''),
                color_distribution = CASE
                    WHEN color_distribution IS NULL OR trim(color_distribution) = '' THEN '[]'
                    ELSE color_distribution
                END,
                rating = COALESCE(rating, 0);

            UPDATE files
            SET folder_id = NULL
            WHERE folder_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM folders WHERE folders.id = files.folder_id);
            "
        )?;

        Ok(())
    }

    fn backfill_dominant_color_channels(&self) -> Result<()> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, dominant_color FROM files WHERE dominant_color IS NOT NULL")?;
        let rows: Vec<(i64, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .filter_map(|row| row.ok())
            .collect();

        for (id, dominant_color) in rows {
            let (r, g, b) = match parse_hex_color(&dominant_color) {
                Some((r, g, b)) => (Some(r as i64), Some(g as i64), Some(b as i64)),
                None => (None, None, None),
            };

            self.conn.execute(
                "UPDATE files SET dominant_r = ?1, dominant_g = ?2, dominant_b = ?3 WHERE id = ?4",
                params![r, g, b, id],
            )?;
        }

        Ok(())
    }

    fn normalize_browser_collection_folder(&self) -> Result<()> {
        self.conn.execute(
            "UPDATE folders
             SET sort_order = ?1
             WHERE is_system = 1 AND name = ?2",
            params![
                BROWSER_COLLECTION_FOLDER_SORT_ORDER,
                BROWSER_COLLECTION_FOLDER_NAME
            ],
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
            CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id);
            CREATE INDEX IF NOT EXISTS idx_folders_parent_sort_order ON folders(parent_id, sort_order, name);
            CREATE INDEX IF NOT EXISTS idx_tags_parent_id ON tags(parent_id);
            CREATE INDEX IF NOT EXISTS idx_tags_parent_sort_order ON tags(parent_id, sort_order, name);
            CREATE INDEX IF NOT EXISTS idx_file_tags_tag_id_file_id ON file_tags(tag_id, file_id);
            "
        )?;

        Ok(())
    }
}
