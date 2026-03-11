use rusqlite::{Connection, Result, params};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileRecord {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub ext: String,
    pub size: i64,
    pub width: i32,
    pub height: i32,
    pub created_at: String,
    pub modified_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: String,
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
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "modifiedAt")]
    pub modified_at: String,
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
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                ext TEXT NOT NULL,
                size INTEGER NOT NULL,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                modified_at TEXT NOT NULL
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
        Ok(())
    }

    pub fn get_all_files(&self) -> Result<Vec<FileWithTags>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, name, ext, size, width, height, created_at, modified_at FROM files ORDER BY modified_at DESC"
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
                created_at: row.get(7)?,
                modified_at: row.get(8)?,
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
                created_at: file.created_at,
                modified_at: file.modified_at,
                tags,
            });
        }

        Ok(result)
    }

    pub fn search_files(&self, query: &str) -> Result<Vec<FileWithTags>> {
        let search_pattern = format!("%{}%", query);
        let mut stmt = self.conn.prepare(
            "SELECT id, path, name, ext, size, width, height, created_at, modified_at
             FROM files
             WHERE name LIKE ?1
             ORDER BY modified_at DESC"
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
                created_at: row.get(7)?,
                modified_at: row.get(8)?,
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
                created_at: file.created_at,
                modified_at: file.modified_at,
                tags,
            });
        }

        Ok(result)
    }

    pub fn get_file_by_id(&self, id: i64) -> Result<Option<FileWithTags>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, name, ext, size, width, height, created_at, modified_at FROM files WHERE id = ?1"
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
                created_at: row.get(7)?,
                modified_at: row.get(8)?,
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
                created_at: file.created_at,
                modified_at: file.modified_at,
                tags,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn insert_file(&self, file: &FileRecord) -> Result<i64> {
        self.conn.execute(
            "INSERT OR REPLACE INTO files (path, name, ext, size, width, height, created_at, modified_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![file.path, file.name, file.ext, file.size, file.width, file.height, file.created_at, file.modified_at],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn get_file_by_path(&self, path: &str) -> Result<Option<FileWithTags>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, name, ext, size, width, height, created_at, modified_at FROM files WHERE path = ?1"
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
                created_at: row.get(7)?,
                modified_at: row.get(8)?,
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
                    created_at: file.created_at,
                    modified_at: file.modified_at,
                    tags,
                }))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn delete_file(&self, path: &str) -> Result<()> {
        self.conn.execute("DELETE FROM files WHERE path = ?1", [path])?;
        Ok(())
    }

    pub fn get_all_tags(&self) -> Result<Vec<Tag>> {
        let mut stmt = self.conn.prepare("SELECT id, name, color FROM tags ORDER BY name")?;
        let tags = stmt.query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
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
            })
        })?.filter_map(|r| r.ok()).collect();
        Ok(tags)
    }

    pub fn add_tag_to_file(&self, file_id: i64, tag_id: i64) -> Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?1, ?2)",
            params![file_id, tag_id],
        )?;
        Ok(())
    }

    pub fn remove_tag_from_file(&self, file_id: i64, tag_id: i64) -> Result<()> {
        self.conn.execute(
            "DELETE FROM file_tags WHERE file_id = ?1 AND tag_id = ?2",
            params![file_id, tag_id],
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
}
