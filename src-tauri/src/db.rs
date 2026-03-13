use rusqlite::{Connection, Result, params};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Folder {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub parent_id: Option<i64>,
    pub created_at: String,
    #[serde(rename = "isSystem")]
    pub is_system: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileRecord {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub ext: String,
    pub size: i64,
    pub width: i32,
    pub height: i32,
    pub folder_id: Option<i64>,
    pub created_at: String,
    pub modified_at: String,
    pub imported_at: String,
    pub rating: i32,
    pub description: String,
    pub source_url: String,
    pub dominant_color: String,
    pub color_distribution: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileWithTags {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub ext: String,
    pub size: i64,
    pub width: i32,
    pub height: i32,
    #[serde(rename = "folderId")]
    pub folder_id: Option<i64>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "modifiedAt")]
    pub modified_at: String,
    #[serde(rename = "importedAt")]
    pub imported_at: String,
    pub rating: i32,
    pub description: String,
    #[serde(rename = "sourceUrl")]
    pub source_url: String,
    #[serde(rename = "dominantColor")]
    pub dominant_color: String,
    #[serde(rename = "colorDistribution")]
    pub color_distribution: String,
    pub tags: Vec<Tag>,
}

pub struct Database {
    conn: Connection,
}

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
                created_at TEXT NOT NULL,
                modified_at TEXT NOT NULL,
                imported_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                color TEXT NOT NULL
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

            CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);
            CREATE INDEX IF NOT EXISTS idx_files_ext ON files(ext);
            "
        )?;

        // Add folder_id column if it doesn't exist (for migration)
        let has_folder_id: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('files') WHERE name = 'folder_id'",
            [],
            |row| row.get(0),
        )?;
        if has_folder_id == 0 {
            self.conn.execute("ALTER TABLE files ADD COLUMN folder_id INTEGER REFERENCES folders(id)", [])?;
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
            self.conn.execute("ALTER TABLE files ADD COLUMN imported_at TEXT", [])?;
            // Update existing records with modified_at value
            self.conn.execute("UPDATE files SET imported_at = modified_at WHERE imported_at IS NULL", [])?;
        }

        // Add rating column if it doesn't exist (for migration)
        let has_rating: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('files') WHERE name = 'rating'",
            [],
            |row| row.get(0),
        )?;
        if has_rating == 0 {
            self.conn.execute("ALTER TABLE files ADD COLUMN rating INTEGER DEFAULT 0", [])?;
        }

        // Add description column if it doesn't exist (for migration)
        let has_description: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('files') WHERE name = 'description'",
            [],
            |row| row.get(0),
        )?;
        if has_description == 0 {
            self.conn.execute("ALTER TABLE files ADD COLUMN description TEXT DEFAULT ''", [])?;
        }

        // Add source_url column if it doesn't exist (for migration)
        let has_source_url: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('files') WHERE name = 'source_url'",
            [],
            |row| row.get(0),
        )?;
        if has_source_url == 0 {
            self.conn.execute("ALTER TABLE files ADD COLUMN source_url TEXT DEFAULT ''", [])?;
        }

        // Add dominant_color column if it doesn't exist (for migration)
        let has_dominant_color: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('files') WHERE name = 'dominant_color'",
            [],
            |row| row.get(0),
        )?;
        if has_dominant_color == 0 {
            self.conn.execute("ALTER TABLE files ADD COLUMN dominant_color TEXT DEFAULT ''", [])?;
        }

        // Add color_distribution column if it doesn't exist (for migration)
        let has_color_distribution: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('files') WHERE name = 'color_distribution'",
            [],
            |row| row.get(0),
        )?;
        if has_color_distribution == 0 {
            self.conn.execute("ALTER TABLE files ADD COLUMN color_distribution TEXT DEFAULT '[]'", [])?;
        }

        // Create indexes after migration
        self.conn.execute_batch(
            "
            CREATE INDEX IF NOT EXISTS idx_files_folder_id ON files(folder_id);
            CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id);
            "
        )?;

        Ok(())
    }

    pub fn get_all_files(&self) -> Result<Vec<FileWithTags>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution FROM files ORDER BY imported_at ASC, id ASC"
        )?;

        let files: Vec<FileRecord> = stmt.query_map([], |row| {
            Ok(FileRecord {
                id: row.get(0)?,
                path: row.get(1)?,
                name: row.get(2)?,
                ext: row.get(3)?,
                size: row.get(4)?,
                width: row.get(5)?,
                height: row.get(6)?,
                folder_id: row.get(7)?,
                created_at: row.get(8)?,
                modified_at: row.get(9)?,
                imported_at: row.get(10)?,
                rating: row.get(11)?,
                description: row.get(12)?,
                source_url: row.get(13)?,
                dominant_color: row.get(14)?,
                color_distribution: row.get(15)?,
            })
        })?.filter_map(|r| r.ok()).collect();

        let mut result = Vec::new();
        for file in files {
            let tags = self.get_file_tags(file.id)?;
            result.push(FileWithTags {
                id: file.id,
                path: file.path,
                name: file.name,
                ext: file.ext,
                size: file.size,
                width: file.width,
                height: file.height,
                folder_id: file.folder_id,
                created_at: file.created_at,
                modified_at: file.modified_at,
                imported_at: file.imported_at,
                rating: file.rating,
                description: file.description,
                source_url: file.source_url,
                dominant_color: file.dominant_color,
                color_distribution: file.color_distribution,
                tags,
            });
        }

        Ok(result)
    }

    pub fn search_files(&self, query: &str) -> Result<Vec<FileWithTags>> {
        let search_pattern = format!("%{}%", query);
        let mut stmt = self.conn.prepare(
            "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution
             FROM files
             WHERE name LIKE ?1
             ORDER BY imported_at ASC, id ASC"
        )?;

        let files: Vec<FileRecord> = stmt.query_map([&search_pattern], |row| {
            Ok(FileRecord {
                id: row.get(0)?,
                path: row.get(1)?,
                name: row.get(2)?,
                ext: row.get(3)?,
                size: row.get(4)?,
                width: row.get(5)?,
                height: row.get(6)?,
                folder_id: row.get(7)?,
                created_at: row.get(8)?,
                modified_at: row.get(9)?,
                imported_at: row.get(10)?,
                rating: row.get(11)?,
                description: row.get(12)?,
                source_url: row.get(13)?,
                dominant_color: row.get(14)?,
                color_distribution: row.get(15)?,
            })
        })?.filter_map(|r| r.ok()).collect();

        let mut result = Vec::new();
        for file in files {
            let tags = self.get_file_tags(file.id)?;
            result.push(FileWithTags {
                id: file.id,
                path: file.path,
                name: file.name,
                ext: file.ext,
                size: file.size,
                width: file.width,
                height: file.height,
                folder_id: file.folder_id,
                created_at: file.created_at,
                modified_at: file.modified_at,
                imported_at: file.imported_at,
                rating: file.rating,
                description: file.description,
                source_url: file.source_url,
                dominant_color: file.dominant_color,
                color_distribution: file.color_distribution,
                tags,
            });
        }

        Ok(result)
    }

    pub fn get_files_in_folder(&self, folder_id: Option<i64>) -> Result<Vec<FileWithTags>> {
        let mut stmt = if folder_id.is_some() {
            self.conn.prepare(
                "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution
                 FROM files
                 WHERE folder_id = ?1
                 ORDER BY imported_at ASC, id ASC"
            )?
        } else {
            self.conn.prepare(
                "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution
                 FROM files
                 WHERE folder_id IS NULL
                 ORDER BY imported_at ASC, id ASC"
            )?
        };

        let files: Vec<FileRecord> = if let Some(fid) = folder_id {
            stmt.query_map([fid], |row| {
                Ok(FileRecord {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    name: row.get(2)?,
                    ext: row.get(3)?,
                    size: row.get(4)?,
                    width: row.get(5)?,
                    height: row.get(6)?,
                    folder_id: row.get(7)?,
                    created_at: row.get(8)?,
                    modified_at: row.get(9)?,
                    imported_at: row.get(10)?,
                    rating: row.get(11)?,
                    description: row.get(12)?,
                    source_url: row.get(13)?,
                    dominant_color: row.get(14)?,
                    color_distribution: row.get(15)?,
                })
            })?.filter_map(|r| r.ok()).collect()
        } else {
            stmt.query_map([], |row| {
                Ok(FileRecord {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    name: row.get(2)?,
                    ext: row.get(3)?,
                    size: row.get(4)?,
                    width: row.get(5)?,
                    height: row.get(6)?,
                    folder_id: row.get(7)?,
                    created_at: row.get(8)?,
                    modified_at: row.get(9)?,
                    imported_at: row.get(10)?,
                    rating: row.get(11)?,
                    description: row.get(12)?,
                    source_url: row.get(13)?,
                    dominant_color: row.get(14)?,
                    color_distribution: row.get(15)?,
                })
            })?.filter_map(|r| r.ok()).collect()
        };

        let mut result = Vec::new();
        for file in files {
            let tags = self.get_file_tags(file.id)?;
            result.push(FileWithTags {
                id: file.id,
                path: file.path,
                name: file.name,
                ext: file.ext,
                size: file.size,
                width: file.width,
                height: file.height,
                folder_id: file.folder_id,
                created_at: file.created_at,
                modified_at: file.modified_at,
                imported_at: file.imported_at,
                rating: file.rating,
                description: file.description,
                source_url: file.source_url,
                dominant_color: file.dominant_color,
                color_distribution: file.color_distribution,
                tags,
            });
        }

        Ok(result)
    }

    pub fn get_file_by_id(&self, id: i64) -> Result<Option<FileWithTags>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution FROM files WHERE id = ?1"
        )?;

        let mut rows = stmt.query([id])?;
        if let Some(row) = rows.next()? {
            let file = FileRecord {
                id: row.get(0)?,
                path: row.get(1)?,
                name: row.get(2)?,
                ext: row.get(3)?,
                size: row.get(4)?,
                width: row.get(5)?,
                height: row.get(6)?,
                folder_id: row.get(7)?,
                created_at: row.get(8)?,
                modified_at: row.get(9)?,
                imported_at: row.get(10)?,
                rating: row.get(11)?,
                description: row.get(12)?,
                source_url: row.get(13)?,
                dominant_color: row.get(14)?,
                color_distribution: row.get(15)?,
            };
            let tags = self.get_file_tags(file.id)?;
            Ok(Some(FileWithTags {
                id: file.id,
                path: file.path,
                name: file.name,
                ext: file.ext,
                size: file.size,
                width: file.width,
                height: file.height,
                folder_id: file.folder_id,
                created_at: file.created_at,
                modified_at: file.modified_at,
                imported_at: file.imported_at,
                rating: file.rating,
                description: file.description,
                source_url: file.source_url,
                dominant_color: file.dominant_color,
                color_distribution: file.color_distribution,
                tags,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn insert_file(&self, file: &FileRecord) -> Result<i64> {
        // First check if file already exists to preserve metadata
        let existing = self.get_file_by_path(&file.path).ok().flatten();

        // Use existing metadata if available, otherwise use new values
        let rating = existing.as_ref().map(|e| e.rating).unwrap_or(file.rating);
        let description = existing.as_ref().map(|e| e.description.as_str()).unwrap_or(&file.description).to_string();
        let source_url = existing.as_ref().map(|e| e.source_url.as_str()).unwrap_or(&file.source_url).to_string();
        let dominant_color = existing.as_ref().map(|e| e.dominant_color.as_str()).unwrap_or(&file.dominant_color).to_string();
        let color_distribution = existing.as_ref().map(|e| e.color_distribution.as_str()).unwrap_or(&file.color_distribution).to_string();

        self.conn.execute(
            "INSERT INTO files (path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
             ON CONFLICT(path) DO UPDATE SET
                name = excluded.name,
                ext = excluded.ext,
                size = excluded.size,
                width = excluded.width,
                height = excluded.height,
                folder_id = excluded.folder_id,
                created_at = excluded.created_at,
                modified_at = excluded.modified_at,
                imported_at = excluded.imported_at,
                rating = excluded.rating,
                description = excluded.description,
                source_url = excluded.source_url,
                dominant_color = excluded.dominant_color,
                color_distribution = excluded.color_distribution",
            params![file.path, file.name, file.ext, file.size, file.width, file.height, file.folder_id, file.created_at, file.modified_at, file.imported_at, rating, description, source_url, dominant_color, color_distribution],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn get_file_by_path(&self, path: &str) -> Result<Option<FileWithTags>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution FROM files WHERE path = ?1"
        )?;

        let file_result = stmt.query_row([path], |row| {
            Ok(FileRecord {
                id: row.get(0)?,
                path: row.get(1)?,
                name: row.get(2)?,
                ext: row.get(3)?,
                size: row.get(4)?,
                width: row.get(5)?,
                height: row.get(6)?,
                folder_id: row.get(7)?,
                created_at: row.get(8)?,
                modified_at: row.get(9)?,
                imported_at: row.get(10)?,
                rating: row.get(11)?,
                description: row.get(12)?,
                source_url: row.get(13)?,
                dominant_color: row.get(14)?,
                color_distribution: row.get(15)?,
            })
        });

        match file_result {
            Ok(file) => {
                let tags = self.get_file_tags(file.id)?;
                Ok(Some(FileWithTags {
                    id: file.id,
                    path: file.path,
                    name: file.name,
                    ext: file.ext,
                    size: file.size,
                    width: file.width,
                    height: file.height,
                    folder_id: file.folder_id,
                    created_at: file.created_at,
                    modified_at: file.modified_at,
                    imported_at: file.imported_at,
                    rating: file.rating,
                    description: file.description,
                    source_url: file.source_url,
                    dominant_color: file.dominant_color,
                    color_distribution: file.color_distribution,
                    tags,
                }))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn update_file_folder(&self, file_id: i64, folder_id: Option<i64>) -> Result<()> {
        self.conn.execute(
            "UPDATE files SET folder_id = ?1 WHERE id = ?2",
            params![folder_id, file_id],
        )?;
        Ok(())
    }

    pub fn update_file_metadata(&self, file_id: i64, rating: i32, description: &str, source_url: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE files SET rating = ?1, description = ?2, source_url = ?3, modified_at = datetime('now', 'localtime') WHERE id = ?4",
            params![rating, description, source_url, file_id],
        )?;
        Ok(())
    }

    pub fn update_file_dominant_color(&self, file_id: i64, dominant_color: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE files SET dominant_color = ?1, modified_at = datetime('now', 'localtime') WHERE id = ?2",
            params![dominant_color, file_id],
        )?;
        Ok(())
    }

    pub fn update_file_name(&self, file_id: i64, name: &str, path: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE files SET name = ?1, path = ?2, modified_at = datetime('now', 'localtime') WHERE id = ?3",
            params![name, path, file_id],
        )?;
        Ok(())
    }

    pub fn delete_file(&self, path: &str) -> Result<()> {
        self.conn.execute("DELETE FROM files WHERE path = ?1", [path])?;
        Ok(())
    }

    pub fn get_all_tags(&self) -> Result<Vec<Tag>> {
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.name, t.color, COUNT(ft.file_id) as count
             FROM tags t
             LEFT JOIN file_tags ft ON t.id = ft.tag_id
             GROUP BY t.id
             ORDER BY t.name"
        )?;
        let tags = stmt.query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                count: row.get(3)?,
            })
        })?.filter_map(|r| r.ok()).collect();
        Ok(tags)
    }

    pub fn create_tag(&self, name: &str, color: &str) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO tags (name, color) VALUES (?1, ?2)",
            params![name, color],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn update_tag(&self, id: i64, name: &str, color: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE tags SET name = ?1, color = ?2 WHERE id = ?3",
            params![name, color, id],
        )?;
        Ok(())
    }

    pub fn delete_tag(&self, id: i64) -> Result<()> {
        self.conn.execute("DELETE FROM tags WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn get_file_tags(&self, file_id: i64) -> Result<Vec<Tag>> {
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.name, t.color FROM tags t
             INNER JOIN file_tags ft ON t.id = ft.tag_id
             WHERE ft.file_id = ?1"
        )?;
        let tags = stmt.query_map([file_id], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                count: 1,
            })
        })?.filter_map(|r| r.ok()).collect();
        Ok(tags)
    }

    pub fn add_tag_to_file(&self, file_id: i64, tag_id: i64) -> Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?1, ?2)",
            params![file_id, tag_id],
        )?;
        self.conn.execute(
            "UPDATE files SET modified_at = datetime('now', 'localtime') WHERE id = ?1",
            [file_id],
        )?;
        Ok(())
    }

    pub fn remove_tag_from_file(&self, file_id: i64, tag_id: i64) -> Result<()> {
        self.conn.execute(
            "DELETE FROM file_tags WHERE file_id = ?1 AND tag_id = ?2",
            params![file_id, tag_id],
        )?;
        self.conn.execute(
            "UPDATE files SET modified_at = datetime('now', 'localtime') WHERE id = ?1",
            [file_id],
        )?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let mut stmt = self.conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query([key])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_index_paths(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare("SELECT path FROM index_paths")?;
        let paths = stmt.query_map([], |row| row.get(0))?.filter_map(|r| r.ok()).collect();
        Ok(paths)
    }

    pub fn add_index_path(&self, path: &str) -> Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO index_paths (path) VALUES (?1)",
            [path],
        )?;
        Ok(())
    }

    pub fn remove_index_path(&self, path: &str) -> Result<()> {
        self.conn.execute("DELETE FROM index_paths WHERE path = ?1", [path])?;
        Ok(())
    }

    // Folder operations

    pub fn get_all_folders(&self) -> Result<Vec<Folder>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, name, parent_id, created_at, is_system FROM folders ORDER BY created_at"
        )?;
        let folders = stmt.query_map([], |row| {
            Ok(Folder {
                id: row.get(0)?,
                path: row.get(1)?,
                name: row.get(2)?,
                parent_id: row.get(3)?,
                created_at: row.get(4)?,
                is_system: row.get::<_, i32>(5)? == 1,
            })
        })?.filter_map(|r| r.ok()).collect();
        Ok(folders)
    }

    pub fn get_folder_by_path(&self, path: &str) -> Result<Option<Folder>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, name, parent_id, created_at, is_system FROM folders WHERE path = ?1"
        )?;
        let mut rows = stmt.query([path])?;
        if let Some(row) = rows.next()? {
            Ok(Some(Folder {
                id: row.get(0)?,
                path: row.get(1)?,
                name: row.get(2)?,
                parent_id: row.get(3)?,
                created_at: row.get(4)?,
                is_system: row.get::<_, i32>(5)? == 1,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn create_folder(&self, path: &str, name: &str, parent_id: Option<i64>, is_system: bool) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO folders (path, name, parent_id, created_at, is_system) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![path, name, parent_id, chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(), is_system as i32],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn get_or_create_folder(&self, folder_path: &str, index_paths: &[String]) -> Result<Option<i64>> {
        // Find which index_path this folder is under
        for index_path in index_paths {
            if folder_path.starts_with(index_path) {
                // Get parent folder path
                let parent = std::path::Path::new(folder_path);
                let folder_name = parent.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();

                if folder_path == index_path {
                    // This is the root index path, return None (root folder)
                    return Ok(None);
                }

                // Get parent folder
                let parent_path = parent.parent()
                    .map(|p| p.to_string_lossy().to_string());

                let parent_id = if let Some(pp) = parent_path {
                    self.get_or_create_folder(&pp, index_paths)?
                } else {
                    None
                };

                // Check if folder exists
                if let Some(folder) = self.get_folder_by_path(folder_path)? {
                    return Ok(Some(folder.id));
                }

                // Create folder
                let id = self.create_folder(folder_path, &folder_name, parent_id, false)?;
                return Ok(Some(id));
            }
        }
        Ok(None)
    }

    pub fn delete_folder(&self, id: i64) -> Result<()> {
        self.conn.execute("DELETE FROM folders WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn rename_folder(&self, id: i64, name: &str) -> Result<()> {
        // Get current folder path
        let folder = self.get_folder_by_id(id)?;
        if let Some(folder) = folder {
            let parent_path = std::path::Path::new(&folder.path)
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let old_folder_path = folder.path.clone();
            let new_folder_path = format!("{}/{}", parent_path, name);

            // Rename folder in file system
            let old_path = std::path::Path::new(&old_folder_path);
            let new_path_obj = std::path::Path::new(&new_folder_path);
            if old_path.exists() {
                std::fs::rename(old_path, new_path_obj).map_err(|e| rusqlite::Error::InvalidParameterName(e.to_string()))?;
            }

            // Update folder's own path
            self.conn.execute(
                "UPDATE folders SET name = ?1, path = ?2 WHERE id = ?3",
                params![name, new_folder_path, id],
            )?;

            // Update all subfolder paths (recursive)
            let mut stmt = self.conn.prepare("SELECT id, path FROM folders WHERE path LIKE ?1")?;
            let pattern = format!("{}/%", old_folder_path);
            let subfolders: Vec<(i64, String)> = stmt
                .query_map([pattern], |row| Ok((row.get(0)?, row.get(1)?)))?
                .filter_map(|r| r.ok())
                .collect();
            for (subfolder_id, subfolder_old_path) in subfolders {
                let new_subfolder_path = subfolder_old_path.replacen(&old_folder_path, &new_folder_path, 1);
                self.conn.execute(
                    "UPDATE folders SET path = ?1 WHERE id = ?2",
                    params![new_subfolder_path, subfolder_id],
                )?;
            }

            // Update all file paths
            let mut stmt = self.conn.prepare("SELECT id, path FROM files WHERE path LIKE ?1")?;
            let pattern = format!("{}/%", old_folder_path);
            let files: Vec<(i64, String)> = stmt
                .query_map([pattern], |row| Ok((row.get(0)?, row.get(1)?)))?
                .filter_map(|r| r.ok())
                .collect();
            for (file_id, file_old_path) in files {
                let new_file_path = file_old_path.replacen(&old_folder_path, &new_folder_path, 1);
                self.conn.execute(
                    "UPDATE files SET path = ?1 WHERE id = ?2",
                    params![new_file_path, file_id],
                )?;
            }
        }
        Ok(())
    }

    pub fn get_folder_by_id(&self, id: i64) -> Result<Option<Folder>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, name, parent_id, created_at, is_system FROM folders WHERE id = ?1"
        )?;
        let mut rows = stmt.query([id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(Folder {
                id: row.get(0)?,
                path: row.get(1)?,
                name: row.get(2)?,
                parent_id: row.get(3)?,
                created_at: row.get(4)?,
                is_system: row.get::<_, i32>(5)? == 1,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn clear_folders(&self) -> Result<()> {
        self.conn.execute("DELETE FROM folders", [])?;
        Ok(())
    }

    pub fn get_browser_collection_folder(&self) -> Result<Option<Folder>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, name, parent_id, created_at, is_system FROM folders WHERE is_system = 1 LIMIT 1"
        )?;
        let mut rows = stmt.query([])?;
        if let Some(row) = rows.next()? {
            Ok(Some(Folder {
                id: row.get(0)?,
                path: row.get(1)?,
                name: row.get(2)?,
                parent_id: row.get(3)?,
                created_at: row.get(4)?,
                is_system: row.get::<_, i32>(5)? == 1,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn is_folder_system(&self, id: i64) -> Result<bool> {
        let mut stmt = self.conn.prepare("SELECT is_system FROM folders WHERE id = ?1")?;
        let mut rows = stmt.query([id])?;
        if let Some(row) = rows.next()? {
            Ok(row.get::<_, i32>(0)? == 1)
        } else {
            Ok(false)
        }
    }
}
