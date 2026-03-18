use rusqlite::{Connection, Result, params};
use serde::{Deserialize, Serialize};
use std::path::Path;
use chrono::Local;
use image::GenericImageView;

/// Get image dimensions
pub fn get_image_dimensions(path: &Path) -> Result<(u32, u32), String> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    if ext.eq_ignore_ascii_case("svg") {
        return Ok((0, 0));
    }

    match image::open(path) {
        Ok(img) => Ok(img.dimensions()),
        Err(_) => Ok((0, 0)),
    }
}

/// 统一的图片导入辅助函数
/// 处理文件保存、尺寸获取、色彩分布提取等公共逻辑
/// 注意：created_at 和 modified_at 由调用者提供
pub fn save_and_import_image(
    image_data: &[u8],
    dest_path: &Path,
    folder_id: Option<i64>,
    created_at: String,
    modified_at: String,
) -> Result<FileRecord, String> {
    use std::fs;

    // Save image file
    fs::write(dest_path, image_data).map_err(|e| e.to_string())?;

    // Get image dimensions
    let (width, height) = get_image_dimensions(dest_path).unwrap_or((0, 0));

    // Extract color distribution
    let color_distribution = super::indexer::extract_color_distribution(dest_path)
        .unwrap_or_default();
    let color_distribution_json = serde_json::to_string(&color_distribution)
        .unwrap_or_else(|_| "[]".to_string());
    let dominant_color = color_distribution.first()
        .map(|c| c.color.clone())
        .unwrap_or_default();

    // Get file metadata
    let metadata = fs::metadata(dest_path).map_err(|e| e.to_string())?;
    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    Ok(FileRecord {
        id: 0,
        path: dest_path.to_string_lossy().to_string(),
        name: dest_path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string(),
        ext: dest_path.extension()
            .and_then(|e| e.to_str())
            .unwrap_or("png")
            .to_lowercase(),
        size: metadata.len() as i64,
        width: width as i32,
        height: height as i32,
        folder_id,
        created_at,
        modified_at,
        imported_at: now,
        rating: 0,
        description: String::new(),
        source_url: String::new(),
        dominant_color,
        color_distribution: color_distribution_json,
    })
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Folder {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub parent_id: Option<i64>,
    pub created_at: String,
    #[serde(rename = "isSystem")]
    pub is_system: bool,
    #[serde(rename = "sortOrder")]
    pub sort_order: i32,
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
    #[serde(rename = "sortOrder")]
    pub sort_order: i32,
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
                created_at TEXT NOT NULL,
                modified_at TEXT NOT NULL,
                imported_at TEXT NOT NULL
            );

            -- Trigger to automatically update modified_at when any field is updated
            CREATE TRIGGER IF NOT EXISTS update_files_modified_at
            BEFORE UPDATE ON files
            FOR EACH ROW
            BEGIN
                SELECT NEW.modified_at = datetime('now', 'localtime');
            END;

            CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                color TEXT NOT NULL,
                sort_order INTEGER DEFAULT 0
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
            CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
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

        // Add sort_order column to folders if it doesn't exist (for migration)
        let has_folder_sort_order: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('folders') WHERE name = 'sort_order'",
            [],
            |row| row.get(0),
        )?;
        if has_folder_sort_order == 0 {
            self.conn.execute("ALTER TABLE folders ADD COLUMN sort_order INTEGER DEFAULT 0", [])?;
        }

        // Add sort_order column to tags if it doesn't exist (for migration)
        let has_tag_sort_order: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('tags') WHERE name = 'sort_order'",
            [],
            |row| row.get(0),
        )?;
        if has_tag_sort_order == 0 {
            self.conn.execute("ALTER TABLE tags ADD COLUMN sort_order INTEGER DEFAULT 0", [])?;
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

        // 批量获取所有文件的 tags
        let file_ids: Vec<i64> = files.iter().map(|f| f.id).collect();
        let tags_map = self.get_tags_for_files(&file_ids)?;

        let result: Vec<FileWithTags> = files.into_iter().map(|file| {
            let tags = tags_map.get(&file.id).cloned().unwrap_or_default();
            FileWithTags {
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
            }
        }).collect();

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

        // 批量获取所有文件的 tags
        let file_ids: Vec<i64> = files.iter().map(|f| f.id).collect();
        let tags_map = self.get_tags_for_files(&file_ids)?;

        let result: Vec<FileWithTags> = files.into_iter().map(|file| {
            let tags = tags_map.get(&file.id).cloned().unwrap_or_default();
            FileWithTags {
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
            }
        }).collect();

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

        // 批量获取所有文件的 tags
        let file_ids: Vec<i64> = files.iter().map(|f| f.id).collect();
        let tags_map = self.get_tags_for_files(&file_ids)?;

        let result: Vec<FileWithTags> = files.into_iter().map(|file| {
            let tags = tags_map.get(&file.id).cloned().unwrap_or_default();
            FileWithTags {
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
            }
        }).collect();

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
            "UPDATE files SET rating = ?1, description = ?2, source_url = ?3 WHERE id = ?4",
            params![rating, description, source_url, file_id],
        )?;
        Ok(())
    }

    pub fn update_file_dominant_color(&self, file_id: i64, dominant_color: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE files SET dominant_color = ?1 WHERE id = ?2",
            params![dominant_color, file_id],
        )?;
        Ok(())
    }

    pub fn update_file_name(&self, file_id: i64, name: &str, path: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE files SET name = ?1, path = ?2 WHERE id = ?3",
            params![name, path, file_id],
        )?;
        Ok(())
    }

    pub fn update_file_path_and_folder(&self, file_id: i64, path: &str, folder_id: Option<i64>, modified_at: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE files SET path = ?1, folder_id = ?2, modified_at = ?3 WHERE id = ?4",
            params![path, folder_id, modified_at, file_id],
        )?;
        Ok(())
    }

    pub fn delete_file(&self, path: &str) -> Result<()> {
        self.conn.execute("DELETE FROM files WHERE path = ?1", [path])?;
        Ok(())
    }

    pub fn get_all_tags(&self) -> Result<Vec<Tag>> {
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.name, t.color, COUNT(ft.file_id) as count, t.sort_order
             FROM tags t
             LEFT JOIN file_tags ft ON t.id = ft.tag_id
             GROUP BY t.id
             ORDER BY t.sort_order ASC, t.name ASC"
        )?;
        let tags = stmt.query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                count: row.get(3)?,
                sort_order: row.get(4)?,
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

    /// 批量获取多个文件的 tags，避免 N+1 查询
    pub fn get_tags_for_files(&self, file_ids: &[i64]) -> Result<std::collections::HashMap<i64, Vec<Tag>>> {
        if file_ids.is_empty() {
            return Ok(std::collections::HashMap::new());
        }

        // 构建 IN 查询
        let placeholders: Vec<String> = file_ids.iter().map(|_| "?".to_string()).collect();
        let query = format!(
            "SELECT ft.file_id, t.id, t.name, t.color, t.sort_order FROM tags t
             INNER JOIN file_tags ft ON t.id = ft.tag_id
             WHERE ft.file_id IN ({})",
            placeholders.join(", ")
        );

        let mut stmt = self.conn.prepare(&query)?;

        // 使用 rusqlite::params_from_iter 来构建参数
        use rusqlite::ToSql;
        let params: Vec<Box<dyn ToSql>> = file_ids.iter().map(|&id| Box::new(id) as Box<dyn ToSql>).collect();
        let params_refs: Vec<&dyn ToSql> = params.iter().map(|p| p.as_ref()).collect();

        let mut result: std::collections::HashMap<i64, Vec<Tag>> = std::collections::HashMap::new();
        let rows = stmt.query_map(params_refs.as_slice(), |row| {
            Ok((row.get::<_, i64>(0)?, Tag {
                id: row.get(1)?,
                name: row.get(2)?,
                color: row.get(3)?,
                count: 1,
                sort_order: row.get(4)?,
            }))
        })?;

        for row in rows.flatten() {
            let (file_id, tag) = row;
            result.entry(file_id).or_insert_with(Vec::new).push(tag);
        }

        Ok(result)
    }

    pub fn get_file_tags(&self, file_id: i64) -> Result<Vec<Tag>> {
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.name, t.color, t.sort_order FROM tags t
             INNER JOIN file_tags ft ON t.id = ft.tag_id
             WHERE ft.file_id = ?1"
        )?;
        let tags = stmt.query_map([file_id], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                count: 1,
                sort_order: row.get(3)?,
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

    // Folder operations

    pub fn get_all_folders(&self) -> Result<Vec<Folder>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, name, parent_id, created_at, is_system, sort_order FROM folders ORDER BY sort_order ASC, created_at ASC"
        )?;
        let folders = stmt.query_map([], |row| {
            Ok(Folder {
                id: row.get(0)?,
                path: row.get(1)?,
                name: row.get(2)?,
                parent_id: row.get(3)?,
                created_at: row.get(4)?,
                is_system: row.get::<_, i32>(5)? == 1,
                sort_order: row.get(6)?,
            })
        })?.filter_map(|r| r.ok()).collect();
        Ok(folders)
    }

    pub fn get_folder_by_path(&self, path: &str) -> Result<Option<Folder>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, name, parent_id, created_at, is_system, sort_order FROM folders WHERE path = ?1"
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
                sort_order: row.get(6)?,
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
            "SELECT id, path, name, parent_id, created_at, is_system, sort_order FROM folders WHERE id = ?1"
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
                sort_order: row.get(6)?,
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
            "SELECT id, path, name, parent_id, created_at, is_system, sort_order FROM folders WHERE is_system = 1 LIMIT 1"
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
                sort_order: row.get(6)?,
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

    /// Get all file paths in a directory (including subdirectories)
    pub fn get_file_paths_in_dir(&self, dir_path: &str) -> Result<std::collections::HashSet<String>> {
        let pattern = format!("{}%", dir_path);
        let mut stmt = self.conn.prepare("SELECT path FROM files WHERE path LIKE ?1")?;
        let paths: Vec<String> = stmt.query_map([&pattern], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(paths.into_iter().collect())
    }

    /// 获取每个文件夹的文件数量（高效批量查询）
    pub fn get_file_counts_by_folders(&self) -> Result<std::collections::HashMap<i64, i32>> {
        let mut stmt = self.conn.prepare("SELECT folder_id, COUNT(*) as count FROM files WHERE folder_id IS NOT NULL GROUP BY folder_id")?;
        let counts: Vec<(i64, i32)> = stmt.query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?.filter_map(|r| r.ok()).collect();
        let mut result = std::collections::HashMap::new();
        for (folder_id, count) in counts {
            result.insert(folder_id, count);
        }
        Ok(result)
    }

    /// Check if file is unchanged (by size and modified_at)
    pub fn is_file_unchanged(&self, path: &str, size: i64, modified_at: &str) -> Result<bool> {
        let mut stmt = self.conn.prepare(
            "SELECT size, modified_at FROM files WHERE path = ?1"
        )?;
        let mut rows = stmt.query([path])?;
        if let Some(row) = rows.next()? {
            let db_size: i64 = row.get(0)?;
            let db_modified_at: String = row.get(1)?;
            // Compare size and modified_at
            Ok(db_size == size && db_modified_at == modified_at)
        } else {
            Ok(false)
        }
    }

    /// Update only basic file info (name, size, dimensions, etc.) without affecting user metadata
    pub fn update_file_basic_info(&self, path: &str, name: &str, ext: &str, size: i64, width: i32, height: i32, folder_id: Option<i64>, created_at: &str, modified_at: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE files SET name = ?1, ext = ?2, size = ?3, width = ?4, height = ?5, folder_id = ?6, created_at = ?7, modified_at = ?8 WHERE path = ?9",
            params![name, ext, size, width, height, folder_id, created_at, modified_at, path],
        )?;
        Ok(())
    }

    /// Reorder folders by updating their sort_order values
    pub fn reorder_folders(&self, folder_ids: &[i64]) -> Result<()> {
        for (index, folder_id) in folder_ids.iter().enumerate() {
            self.conn.execute(
                "UPDATE folders SET sort_order = ?1 WHERE id = ?2",
                params![index as i64, folder_id],
            )?;
        }
        Ok(())
    }

    /// Reorder tags by updating their sort_order values
    pub fn reorder_tags(&self, tag_ids: &[i64]) -> Result<()> {
        for (index, tag_id) in tag_ids.iter().enumerate() {
            self.conn.execute(
                "UPDATE tags SET sort_order = ?1 WHERE id = ?2",
                params![index as i64, tag_id],
            )?;
        }
        Ok(())
    }

    /// Move a folder to a new parent and/or position
    pub fn move_folder(&self, folder_id: i64, new_parent_id: Option<i64>, sort_order: i64) -> Result<()> {
        // Get current folder info
        let folder = self.get_folder_by_id(folder_id)?;
        if let Some(folder) = folder {
            let old_folder_path = folder.path.clone();

            // Get new parent folder path
            let new_parent_path = if let Some(parent_id) = new_parent_id {
                let parent = self.get_folder_by_id(parent_id)?;
                parent.map(|p| p.path.clone()).unwrap_or_default()
            } else {
                // Root level - should use index paths or a base path
                // For now, use the parent of the old path
                std::path::Path::new(&old_folder_path)
                    .parent()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default()
            };

            let new_folder_path = std::path::Path::new(&new_parent_path)
                .join(&folder.name)
                .to_string_lossy()
                .to_string();

            // Move folder in file system - source must exist
            let old_path = std::path::Path::new(&old_folder_path);
            let new_path = std::path::Path::new(&new_folder_path);

            // If source doesn't exist, we can't move it
            if !old_path.exists() {
                return Err(rusqlite::Error::InvalidParameterName(
                    format!("Source folder does not exist: {}", old_folder_path)
                ));
            }

            if new_path.exists() {
                return Err(rusqlite::Error::InvalidParameterName(
                    format!("Destination path already exists: {}", new_folder_path)
                ));
            }

            // Try rename first (works within same volume)
            match std::fs::rename(old_path, new_path) {
                Ok(_) => {}
                Err(e) => {
                    // If rename fails (e.g., cross-volume on Windows), try copy+delete
                    if let Err(copy_err) = Self::copy_dir_recursive(old_path, new_path) {
                        return Err(rusqlite::Error::InvalidParameterName(
                            format!("Failed to move folder: {} -> {}: {} / copy failed: {}",
                                old_folder_path, new_folder_path, e, copy_err)
                        ));
                    }
                    // Clean up old directory
                    if let Err(del_err) = std::fs::remove_dir_all(old_path) {
                        // Log but don't fail - the move succeeded
                        eprintln!("Warning: failed to remove old folder after copy: {}", del_err);
                    }
                }
            }

            // Update folder's parent_id, sort_order and path
            self.conn.execute(
                "UPDATE folders SET parent_id = ?1, sort_order = ?2, path = ?3 WHERE id = ?4",
                params![new_parent_id, sort_order, new_folder_path, folder_id],
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

    /// Copy directory recursively (for cross-volume moves on Windows)
    fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
        if !dst.exists() {
            std::fs::create_dir_all(dst)?;
        }

        for entry in std::fs::read_dir(src)? {
            let entry = entry?;
            let entry_path = entry.path();
            let dst_path = dst.join(entry.file_name());

            if entry_path.is_dir() {
                Self::copy_dir_recursive(&entry_path, &dst_path)?;
            } else {
                std::fs::copy(&entry_path, &dst_path)?;
            }
        }
        Ok(())
    }

    /// Clear folder_id (set to NULL) for all files in a folder and its subfolders
    pub fn clear_files_folder_id(&self, folder_ids: &[i64]) -> Result<()> {
        for folder_id in folder_ids {
            self.conn.execute(
                "UPDATE files SET folder_id = NULL WHERE folder_id = ?1",
                params![folder_id],
            )?;
        }
        Ok(())
    }
}
