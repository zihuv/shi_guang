use crate::path_utils::{join_path, normalize_path, path_has_prefix, replace_path_prefix};
use chrono::Local;
use image::GenericImageView;
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Parse a hex color string (#RRGGBB) to RGB components
fn parse_hex_color(hex: &str) -> Option<(u8, u8, u8)> {
    let hex = hex.trim_start_matches('#');
    if hex.len() != 6 {
        return None;
    }
    let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
    let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
    let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
    Some((r, g, b))
}

/// Calculate Euclidean distance between two colors in RGB space
fn color_distance(c1: &str, c2: &str) -> f64 {
    let (r1, g1, b1) = match parse_hex_color(c1) {
        Some(c) => c,
        None => return f64::MAX,
    };
    let (r2, g2, b2) = match parse_hex_color(c2) {
        Some(c) => c,
        None => return f64::MAX,
    };
    let dr = r1 as f64 - r2 as f64;
    let dg = g1 as f64 - g2 as f64;
    let db = b1 as f64 - b2 as f64;
    (dr * dr + dg * dg + db * db).sqrt()
}

/// Check if two colors are similar (within threshold)
fn colors_are_similar(color1: &str, color2: &str, threshold: f64) -> bool {
    color_distance(color1, color2) <= threshold
}

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
    let color_distribution =
        super::indexer::extract_color_distribution(dest_path).unwrap_or_default();
    let color_distribution_json =
        serde_json::to_string(&color_distribution).unwrap_or_else(|_| "[]".to_string());
    let dominant_color = color_distribution
        .first()
        .map(|c| c.color.clone())
        .unwrap_or_default();

    // Get file metadata
    let metadata = fs::metadata(dest_path).map_err(|e| e.to_string())?;
    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    Ok(FileRecord {
        id: 0,
        path: dest_path.to_string_lossy().to_string(),
        name: dest_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string(),
        ext: dest_path
            .extension()
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
    #[serde(rename = "deletedAt")]
    pub deleted_at: Option<String>,
}

pub struct Database {
    conn: Connection,
}

const DB_SCHEMA_VERSION: i32 = 2;

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
                color_distribution TEXT NOT NULL DEFAULT '[]',
                deleted_at TEXT DEFAULT NULL
            );

            INSERT INTO files_new (
                id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at,
                rating, description, source_url, dominant_color, color_distribution, deleted_at
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

    fn create_indexes(&self) -> Result<()> {
        self.conn.execute_batch(
            "
            CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);
            CREATE INDEX IF NOT EXISTS idx_files_ext ON files(ext);
            CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
            CREATE INDEX IF NOT EXISTS idx_files_folder_id ON files(folder_id);
            CREATE INDEX IF NOT EXISTS idx_files_active_order ON files(deleted_at, imported_at DESC, id ASC);
            CREATE INDEX IF NOT EXISTS idx_files_folder_active_order ON files(folder_id, deleted_at, imported_at DESC, id ASC);
            CREATE INDEX IF NOT EXISTS idx_files_deleted_at ON files(deleted_at);
            CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id);
            CREATE INDEX IF NOT EXISTS idx_folders_parent_sort_order ON folders(parent_id, sort_order, name);
            CREATE INDEX IF NOT EXISTS idx_tags_sort_order ON tags(sort_order, name);
            CREATE INDEX IF NOT EXISTS idx_file_tags_tag_id_file_id ON file_tags(tag_id, file_id);
            "
        )?;

        Ok(())
    }

    pub fn get_all_files(
        &self,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<FileWithTags>> {
        let sql = if limit.is_some() && offset.is_some() {
            "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution, deleted_at FROM files WHERE deleted_at IS NULL ORDER BY imported_at ASC, id ASC LIMIT ?1 OFFSET ?2"
        } else if limit.is_some() {
            "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution, deleted_at FROM files WHERE deleted_at IS NULL ORDER BY imported_at ASC, id ASC LIMIT ?1"
        } else {
            "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution, deleted_at FROM files WHERE deleted_at IS NULL ORDER BY imported_at ASC, id ASC"
        };

        let mut stmt = self.conn.prepare(sql)?;

        let files: Vec<FileRecord> = if let (Some(l), Some(o)) = (limit, offset) {
            stmt.query_map(params![l, o], |row| {
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
            })?
            .filter_map(|r| r.ok())
            .collect()
        } else if let Some(l) = limit {
            stmt.query_map(params![l], |row| {
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
            })?
            .filter_map(|r| r.ok())
            .collect()
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
            })?
            .filter_map(|r| r.ok())
            .collect()
        };

        // 批量获取所有文件的 tags
        let file_ids: Vec<i64> = files.iter().map(|f| f.id).collect();
        let tags_map = self.get_tags_for_files(&file_ids)?;

        let result: Vec<FileWithTags> = files
            .into_iter()
            .map(|file| {
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
                    deleted_at: None,
                }
            })
            .collect();

        Ok(result)
    }

    pub fn get_files_count(&self) -> Result<i64> {
        self.conn.query_row(
            "SELECT COUNT(*) FROM files WHERE deleted_at IS NULL",
            [],
            |row| row.get(0),
        )
    }

    pub fn search_files(
        &self,
        query: &str,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<FileWithTags>> {
        let search_pattern = format!("%{}%", query);
        let sql = if limit.is_some() && offset.is_some() {
            "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution
             FROM files
             WHERE name LIKE ?1 AND deleted_at IS NULL
             ORDER BY imported_at ASC, id ASC LIMIT ?2 OFFSET ?3"
        } else if limit.is_some() {
            "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution
             FROM files
             WHERE name LIKE ?1 AND deleted_at IS NULL
             ORDER BY imported_at ASC, id ASC LIMIT ?2"
        } else {
            "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution
             FROM files
             WHERE name LIKE ?1 AND deleted_at IS NULL
             ORDER BY imported_at ASC, id ASC"
        };

        let mut stmt = self.conn.prepare(sql)?;

        let files: Vec<FileRecord> = if let (Some(l), Some(o)) = (limit, offset) {
            stmt.query_map(params![&search_pattern, l, o], |row| {
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
            })?
            .filter_map(|r| r.ok())
            .collect()
        } else if let Some(l) = limit {
            stmt.query_map(params![&search_pattern, l], |row| {
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
            })?
            .filter_map(|r| r.ok())
            .collect()
        } else {
            stmt.query_map([&search_pattern], |row| {
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
            })?
            .filter_map(|r| r.ok())
            .collect()
        };

        // 批量获取所有文件的 tags
        let file_ids: Vec<i64> = files.iter().map(|f| f.id).collect();
        let tags_map = self.get_tags_for_files(&file_ids)?;

        let result: Vec<FileWithTags> = files
            .into_iter()
            .map(|file| {
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
                    deleted_at: None,
                }
            })
            .collect();

        Ok(result)
    }

    pub fn search_files_count(&self, query: &str) -> Result<i64> {
        let search_pattern = format!("%{}%", query);
        self.conn.query_row(
            "SELECT COUNT(*) FROM files WHERE name LIKE ?1 AND deleted_at IS NULL",
            params![&search_pattern],
            |row| row.get(0),
        )
    }

    pub fn get_files_in_folder(
        &self,
        folder_id: Option<i64>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<FileWithTags>> {
        let sql = if folder_id.is_some() {
            if limit.is_some() && offset.is_some() {
                "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution
                 FROM files
                 WHERE folder_id = ?1 AND deleted_at IS NULL
                 ORDER BY imported_at ASC, id ASC LIMIT ?2 OFFSET ?3"
            } else if limit.is_some() {
                "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution
                 FROM files
                 WHERE folder_id = ?1 AND deleted_at IS NULL
                 ORDER BY imported_at ASC, id ASC LIMIT ?2"
            } else {
                "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution
                 FROM files
                 WHERE folder_id = ?1 AND deleted_at IS NULL
                 ORDER BY imported_at ASC, id ASC"
            }
        } else {
            if limit.is_some() && offset.is_some() {
                "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution
                 FROM files
                 WHERE folder_id IS NULL AND deleted_at IS NULL
                 ORDER BY imported_at ASC, id ASC LIMIT ?1 OFFSET ?2"
            } else if limit.is_some() {
                "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution
                 FROM files
                 WHERE folder_id IS NULL AND deleted_at IS NULL
                 ORDER BY imported_at ASC, id ASC LIMIT ?1"
            } else {
                "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution
                 FROM files
                 WHERE folder_id IS NULL AND deleted_at IS NULL
                 ORDER BY imported_at ASC, id ASC"
            }
        };

        let mut stmt = self.conn.prepare(sql)?;

        let files: Vec<FileRecord> =
            if let (Some(fid), Some(l), Some(o)) = (folder_id, limit, offset) {
                stmt.query_map(params![fid, l, o], |row| {
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
                })?
                .filter_map(|r| r.ok())
                .collect()
            } else if let (Some(fid), Some(l)) = (folder_id, limit) {
                stmt.query_map(params![fid, l], |row| {
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
                })?
                .filter_map(|r| r.ok())
                .collect()
            } else if let Some(fid) = folder_id {
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
                })?
                .filter_map(|r| r.ok())
                .collect()
            } else if let (Some(l), Some(o)) = (limit, offset) {
                stmt.query_map(params![l, o], |row| {
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
                })?
                .filter_map(|r| r.ok())
                .collect()
            } else if let Some(l) = limit {
                stmt.query_map(params![l], |row| {
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
                })?
                .filter_map(|r| r.ok())
                .collect()
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
                })?
                .filter_map(|r| r.ok())
                .collect()
            };

        // 批量获取所有文件的 tags
        let file_ids: Vec<i64> = files.iter().map(|f| f.id).collect();
        let tags_map = self.get_tags_for_files(&file_ids)?;

        let result: Vec<FileWithTags> = files
            .into_iter()
            .map(|file| {
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
                    deleted_at: None,
                }
            })
            .collect();

        Ok(result)
    }

    pub fn get_files_in_folder_count(&self, folder_id: Option<i64>) -> Result<i64> {
        if let Some(fid) = folder_id {
            self.conn.query_row(
                "SELECT COUNT(*) FROM files WHERE folder_id = ?1 AND deleted_at IS NULL",
                params![fid],
                |row| row.get(0),
            )
        } else {
            self.conn.query_row(
                "SELECT COUNT(*) FROM files WHERE folder_id IS NULL AND deleted_at IS NULL",
                [],
                |row| row.get(0),
            )
        }
    }

    pub fn get_file_by_id(&self, id: i64) -> Result<Option<FileWithTags>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution, deleted_at FROM files WHERE id = ?1"
        )?;

        let mut rows = stmt.query([id])?;
        if let Some(row) = rows.next()? {
            let deleted_at: Option<String> = row.get(16)?;
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
                deleted_at,
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
        let description = existing
            .as_ref()
            .map(|e| e.description.as_str())
            .unwrap_or(&file.description)
            .to_string();
        let source_url = existing
            .as_ref()
            .map(|e| e.source_url.as_str())
            .unwrap_or(&file.source_url)
            .to_string();
        let dominant_color = existing
            .as_ref()
            .map(|e| e.dominant_color.as_str())
            .unwrap_or(&file.dominant_color)
            .to_string();
        let color_distribution = existing
            .as_ref()
            .map(|e| e.color_distribution.as_str())
            .unwrap_or(&file.color_distribution)
            .to_string();
        let imported_at = existing
            .as_ref()
            .map(|e| e.imported_at.as_str())
            .unwrap_or(&file.imported_at)
            .to_string();

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
            params![file.path, file.name, file.ext, file.size, file.width, file.height, file.folder_id, file.created_at, file.modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn get_file_by_path(&self, path: &str) -> Result<Option<FileWithTags>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution, deleted_at FROM files WHERE path = ?1"
        )?;

        let file_result = stmt.query_row([path], |row| {
            let deleted_at: Option<String> = row.get(16)?;
            Ok((
                FileRecord {
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
                },
                deleted_at,
            ))
        });

        match file_result {
            Ok((file, deleted_at)) => {
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
                    deleted_at,
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

    pub fn update_file_metadata(
        &self,
        file_id: i64,
        rating: i32,
        description: &str,
        source_url: &str,
    ) -> Result<()> {
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

    pub fn update_file_path_and_folder(
        &self,
        file_id: i64,
        path: &str,
        folder_id: Option<i64>,
        modified_at: &str,
    ) -> Result<()> {
        self.conn.execute(
            "UPDATE files SET path = ?1, folder_id = ?2, modified_at = ?3 WHERE id = ?4",
            params![path, folder_id, modified_at, file_id],
        )?;
        Ok(())
    }

    pub fn delete_file(&self, path: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM files WHERE path = ?1", [path])?;
        Ok(())
    }

    // Soft delete - sets deleted_at timestamp
    pub fn soft_delete_file(&self, file_id: i64) -> Result<()> {
        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        self.conn.execute(
            "UPDATE files SET deleted_at = ?1 WHERE id = ?2",
            params![now, file_id],
        )?;
        Ok(())
    }

    // Restore file - clears deleted_at
    pub fn restore_file(&self, file_id: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE files SET deleted_at = NULL WHERE id = ?1",
            params![file_id],
        )?;
        Ok(())
    }

    // Permanent delete - actually removes from database
    pub fn permanent_delete_file(&self, file_id: i64) -> Result<()> {
        self.conn
            .execute("DELETE FROM files WHERE id = ?1", params![file_id])?;
        Ok(())
    }

    // Get all trash files (deleted files)
    pub fn get_trash_files(&self) -> Result<Vec<FileWithTags>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution, deleted_at FROM files WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, id ASC"
        )?;

        let files: Vec<FileRecord> = stmt
            .query_map([], |row| {
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
            })?
            .filter_map(|r| r.ok())
            .collect();

        // 批量获取所有文件的 tags
        let file_ids: Vec<i64> = files.iter().map(|f| f.id).collect();
        let tags_map = self.get_tags_for_files(&file_ids)?;

        // Get deleted_at values separately
        let mut stmt2 = self.conn.prepare(
            "SELECT id, deleted_at FROM files WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, id ASC"
        )?;
        let deleted_at_map: std::collections::HashMap<i64, String> = stmt2
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect::<std::collections::HashMap<_, _>>();

        let result: Vec<FileWithTags> = files
            .into_iter()
            .map(|file| {
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
                    deleted_at: deleted_at_map.get(&file.id).cloned(),
                }
            })
            .collect();

        Ok(result)
    }

    // Get delete mode setting
    pub fn get_delete_mode(&self) -> Result<bool> {
        let mut stmt = self
            .conn
            .prepare("SELECT value FROM settings WHERE key = 'use_trash'")?;
        let mut rows = stmt.query([])?;
        if let Some(row) = rows.next()? {
            let value: String = row.get(0)?;
            Ok(value == "true")
        } else {
            // Default to true (use trash)
            Ok(true)
        }
    }

    // Set delete mode setting
    pub fn set_delete_mode(&self, use_trash: bool) -> Result<()> {
        let value = if use_trash { "true" } else { "false" };
        self.conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('use_trash', ?1)",
            params![value],
        )?;
        Ok(())
    }

    pub fn get_all_tags(&self) -> Result<Vec<Tag>> {
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.name, t.color, COUNT(f.id) as count, t.sort_order
             FROM tags t
             LEFT JOIN file_tags ft ON t.id = ft.tag_id
             LEFT JOIN files f ON f.id = ft.file_id AND f.deleted_at IS NULL
             GROUP BY t.id
             ORDER BY t.sort_order ASC, t.name ASC",
        )?;
        let tags = stmt
            .query_map([], |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    count: row.get(3)?,
                    sort_order: row.get(4)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
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
    pub fn get_tags_for_files(
        &self,
        file_ids: &[i64],
    ) -> Result<std::collections::HashMap<i64, Vec<Tag>>> {
        if file_ids.is_empty() {
            return Ok(std::collections::HashMap::new());
        }

        // 构建 IN 查询
        let placeholders: Vec<String> = file_ids.iter().map(|_| "?".to_string()).collect();
        let query = format!(
            "SELECT ft.file_id, t.id, t.name, t.color, t.sort_order FROM tags t
             INNER JOIN file_tags ft ON t.id = ft.tag_id
             WHERE ft.file_id IN ({})
             ORDER BY t.sort_order ASC, t.name ASC",
            placeholders.join(", ")
        );

        let mut stmt = self.conn.prepare(&query)?;

        // 使用 rusqlite::params_from_iter 来构建参数
        use rusqlite::ToSql;
        let params: Vec<Box<dyn ToSql>> = file_ids
            .iter()
            .map(|&id| Box::new(id) as Box<dyn ToSql>)
            .collect();
        let params_refs: Vec<&dyn ToSql> = params.iter().map(|p| p.as_ref()).collect();

        let mut result: std::collections::HashMap<i64, Vec<Tag>> = std::collections::HashMap::new();
        let rows = stmt.query_map(params_refs.as_slice(), |row| {
            Ok((
                row.get::<_, i64>(0)?,
                Tag {
                    id: row.get(1)?,
                    name: row.get(2)?,
                    color: row.get(3)?,
                    count: 1,
                    sort_order: row.get(4)?,
                },
            ))
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
             WHERE ft.file_id = ?1
             ORDER BY t.sort_order ASC, t.name ASC",
        )?;
        let tags = stmt
            .query_map([file_id], |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    count: 1,
                    sort_order: row.get(3)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
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
        let mut stmt = self
            .conn
            .prepare("SELECT value FROM settings WHERE key = ?1")?;
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
        let paths = stmt
            .query_map([], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
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
        self.conn
            .execute("DELETE FROM index_paths WHERE path = ?1", [path])?;
        Ok(())
    }

    // Folder operations

    pub fn get_all_folders(&self) -> Result<Vec<Folder>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, name, parent_id, created_at, is_system, sort_order FROM folders ORDER BY sort_order ASC, created_at ASC"
        )?;
        let folders = stmt
            .query_map([], |row| {
                Ok(Folder {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    name: row.get(2)?,
                    parent_id: row.get(3)?,
                    created_at: row.get(4)?,
                    is_system: row.get::<_, i32>(5)? == 1,
                    sort_order: row.get(6)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(folders)
    }

    pub fn get_folder_by_path(&self, path: &str) -> Result<Option<Folder>> {
        // Normalize path separators to handle Windows/Unix path differences
        let normalized_path = path.replace('\\', "/");
        let mut stmt = self.conn.prepare(
            "SELECT id, path, name, parent_id, created_at, is_system, sort_order FROM folders WHERE REPLACE(path, '\\', '/') = ?1"
        )?;
        let mut rows = stmt.query([normalized_path.as_str()])?;
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

    pub fn create_folder(
        &self,
        path: &str,
        name: &str,
        parent_id: Option<i64>,
        is_system: bool,
    ) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO folders (path, name, parent_id, created_at, is_system) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![path, name, parent_id, chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(), is_system as i32],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn get_or_create_folder(
        &self,
        folder_path: &str,
        index_paths: &[String],
    ) -> Result<Option<i64>> {
        // Find which index_path this folder is under
        for index_path in index_paths {
            if path_has_prefix(folder_path, index_path) {
                // Get parent folder path
                let parent = std::path::Path::new(folder_path);
                let folder_name = parent
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();

                if std::path::Path::new(folder_path) == std::path::Path::new(index_path) {
                    // This is the root index path, return None (root folder)
                    return Ok(None);
                }

                // Get parent folder
                let parent_path = parent.parent().map(|p| p.to_string_lossy().to_string());

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
        self.conn
            .execute("DELETE FROM folders WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn rename_folder(&self, id: i64, name: &str) -> Result<()> {
        // Get current folder path
        let folder = self.get_folder_by_id(id)?;
        if let Some(folder) = folder {
            let old_folder_path = folder.path.clone();
            let old_path = std::path::Path::new(&old_folder_path);
            let new_folder_path = normalize_path(
                old_path
                    .parent()
                    .unwrap_or_else(|| Path::new(""))
                    .join(name),
            );

            // Rename folder in file system
            let new_path_obj = std::path::Path::new(&new_folder_path);
            if old_path.exists() {
                std::fs::rename(old_path, new_path_obj)
                    .map_err(|e| rusqlite::Error::InvalidParameterName(e.to_string()))?;
            }

            // Update folder's own path
            self.conn.execute(
                "UPDATE folders SET name = ?1, path = ?2 WHERE id = ?3",
                params![name, new_folder_path, id],
            )?;

            // Update all subfolder paths (recursive)
            let subfolders: Vec<(i64, String)> = self
                .get_all_folders()?
                .into_iter()
                .filter(|subfolder| {
                    subfolder.id != id && path_has_prefix(&subfolder.path, &old_folder_path)
                })
                .map(|subfolder| (subfolder.id, subfolder.path))
                .collect();
            for (subfolder_id, subfolder_old_path) in subfolders {
                let Some(new_subfolder_path) =
                    replace_path_prefix(&subfolder_old_path, &old_folder_path, &new_folder_path)
                else {
                    continue;
                };
                self.conn.execute(
                    "UPDATE folders SET path = ?1 WHERE id = ?2",
                    params![new_subfolder_path, subfolder_id],
                )?;
            }

            // Update all file paths
            let files: Vec<(i64, String)> = self
                .get_all_files(None, None)?
                .into_iter()
                .filter(|file| path_has_prefix(&file.path, &old_folder_path))
                .map(|file| (file.id, file.path))
                .collect();
            for (file_id, file_old_path) in files {
                let Some(new_file_path) =
                    replace_path_prefix(&file_old_path, &old_folder_path, &new_folder_path)
                else {
                    continue;
                };
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
        let mut stmt = self
            .conn
            .prepare("SELECT is_system FROM folders WHERE id = ?1")?;
        let mut rows = stmt.query([id])?;
        if let Some(row) = rows.next()? {
            Ok(row.get::<_, i32>(0)? == 1)
        } else {
            Ok(false)
        }
    }

    /// Get all file paths in a directory (including subdirectories)
    pub fn get_file_paths_in_dir(
        &self,
        dir_path: &str,
    ) -> Result<std::collections::HashSet<String>> {
        let paths: Vec<String> = self
            .get_all_files(None, None)?
            .into_iter()
            .filter(|file| path_has_prefix(&file.path, dir_path))
            .map(|file| file.path)
            .collect();
        Ok(paths.into_iter().collect())
    }

    /// 获取每个文件夹的文件数量（高效批量查询）
    pub fn get_file_counts_by_folders(&self) -> Result<std::collections::HashMap<i64, i32>> {
        let mut stmt = self.conn.prepare("SELECT folder_id, COUNT(*) as count FROM files WHERE folder_id IS NOT NULL AND deleted_at IS NULL GROUP BY folder_id")?;
        let counts: Vec<(i64, i32)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();
        let mut result = std::collections::HashMap::new();
        for (folder_id, count) in counts {
            result.insert(folder_id, count);
        }
        Ok(result)
    }

    /// Get trash file count
    pub fn get_trash_count(&self) -> Result<i32> {
        let mut stmt = self
            .conn
            .prepare("SELECT COUNT(*) FROM files WHERE deleted_at IS NOT NULL")?;
        let count: i32 = stmt.query_row([], |row| row.get(0))?;
        Ok(count)
    }

    /// Check if file is unchanged (by size and modified_at)
    pub fn is_file_unchanged(&self, path: &str, size: i64, modified_at: &str) -> Result<bool> {
        let mut stmt = self
            .conn
            .prepare("SELECT size, modified_at FROM files WHERE path = ?1")?;
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
    pub fn update_file_basic_info(
        &self,
        path: &str,
        name: &str,
        ext: &str,
        size: i64,
        width: i32,
        height: i32,
        folder_id: Option<i64>,
        created_at: &str,
        modified_at: &str,
    ) -> Result<()> {
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
    pub fn move_folder(
        &self,
        folder_id: i64,
        new_parent_id: Option<i64>,
        sort_order: i64,
    ) -> Result<()> {
        // Get current folder info
        let folder = self.get_folder_by_id(folder_id)?;
        if let Some(folder) = folder {
            let old_folder_path = normalize_path(&folder.path);

            // Get new parent folder path (normalize to handle mixed separators from database)
            let new_parent_path = if let Some(parent_id) = new_parent_id {
                // Moving to a specific parent folder
                let parent = self.get_folder_by_id(parent_id)?;
                normalize_path(parent.map(|p| p.path.clone()).unwrap_or_default())
            } else {
                // Root level - use the first index path as root
                let index_paths = self.get_index_paths()?;
                index_paths.first().cloned().unwrap_or_default()
            };

            let new_folder_path = join_path(&new_parent_path, &folder.name);

            // Move folder in file system - source must exist
            let old_path = std::path::Path::new(&old_folder_path);
            let new_path = std::path::Path::new(&new_folder_path);

            // If source doesn't exist, we can't move it
            if !old_path.exists() {
                return Err(rusqlite::Error::InvalidParameterName(format!(
                    "Source folder does not exist: {}",
                    old_folder_path
                )));
            }

            if new_path.exists() {
                return Err(rusqlite::Error::InvalidParameterName(format!(
                    "Destination path already exists: {}",
                    new_folder_path
                )));
            }

            // Try rename first (works within same volume)
            match std::fs::rename(old_path, new_path) {
                Ok(_) => {}
                Err(e) => {
                    // If rename fails (e.g., cross-volume on Windows), try copy+delete
                    if let Err(copy_err) = Self::copy_dir_recursive(old_path, new_path) {
                        return Err(rusqlite::Error::InvalidParameterName(format!(
                            "Failed to move folder: {} -> {}: {} / copy failed: {}",
                            old_folder_path, new_folder_path, e, copy_err
                        )));
                    }
                    // Clean up old directory
                    if let Err(del_err) = std::fs::remove_dir_all(old_path) {
                        // Log but don't fail - the move succeeded
                        eprintln!(
                            "Warning: failed to remove old folder after copy: {}",
                            del_err
                        );
                    }
                }
            }

            // Update folder's parent_id, sort_order and path
            self.conn.execute(
                "UPDATE folders SET parent_id = ?1, sort_order = ?2, path = ?3 WHERE id = ?4",
                params![new_parent_id, sort_order, new_folder_path, folder_id],
            )?;

            // Update all subfolder paths (recursive)
            // Use forward slashes for SQL LIKE pattern
            let subfolders: Vec<(i64, String)> = self
                .get_all_folders()?
                .into_iter()
                .filter(|subfolder| {
                    subfolder.id != folder_id && path_has_prefix(&subfolder.path, &old_folder_path)
                })
                .map(|subfolder| (subfolder.id, subfolder.path))
                .collect();
            for (subfolder_id, subfolder_old_path) in subfolders {
                let Some(new_subfolder_path_native) =
                    replace_path_prefix(&subfolder_old_path, &old_folder_path, &new_folder_path)
                else {
                    continue;
                };
                self.conn.execute(
                    "UPDATE folders SET path = ?1 WHERE id = ?2",
                    params![new_subfolder_path_native, subfolder_id],
                )?;
            }

            // Update all file paths
            let files: Vec<(i64, String)> = self
                .get_all_files(None, None)?
                .into_iter()
                .filter(|file| path_has_prefix(&file.path, &old_folder_path))
                .map(|file| (file.id, file.path))
                .collect();
            for (file_id, file_old_path) in files {
                let Some(new_file_path_native) =
                    replace_path_prefix(&file_old_path, &old_folder_path, &new_folder_path)
                else {
                    continue;
                };
                self.conn.execute(
                    "UPDATE files SET path = ?1 WHERE id = ?2",
                    params![new_file_path_native, file_id],
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

    fn append_file_filter_sql(
        sql: &mut String,
        filter: &crate::commands::FileFilter,
        params_vec: &mut Vec<Box<dyn rusqlite::ToSql>>,
    ) -> bool {
        let mut conditions: Vec<String> = Vec::new();

        if let Some(tag_ids) = filter.tag_ids.as_ref() {
            if !tag_ids.is_empty() {
                sql.push_str(" INNER JOIN file_tags ft ON f.id = ft.file_id");
            }
        }

        conditions.push("f.deleted_at IS NULL".to_string());

        if let Some(query) = filter.query.as_ref() {
            if !query.is_empty() {
                conditions.push("f.name LIKE ?".to_string());
                params_vec.push(Box::new(format!("%{}%", query)));
            }
        }

        if let Some(folder_id) = filter.folder_id {
            conditions.push("f.folder_id = ?".to_string());
            params_vec.push(Box::new(folder_id));
        }

        if let Some(file_types) = filter.file_types.as_ref() {
            if !file_types.is_empty() {
                let ext_conditions: Vec<String> = file_types
                    .iter()
                    .map(|ft| {
                        let extensions: Vec<&str> = match ft.as_str() {
                            "image" => vec![
                                "jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico", "tiff",
                                "tif", "psd", "ai", "eps", "raw", "cr2", "nef", "arw", "dng",
                                "heic", "heif",
                            ],
                            "video" => vec![
                                "mp4", "avi", "mov", "mkv", "wmv", "flv", "webm", "m4v", "3gp",
                            ],
                            "document" => vec![
                                "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf",
                                "odt", "ods",
                            ],
                            _ => vec![],
                        };
                        let ext_list: Vec<String> = extensions
                            .iter()
                            .map(|e| format!("'{}'", e.to_lowercase()))
                            .collect();
                        format!("LOWER(f.ext) IN ({})", ext_list.join(", "))
                    })
                    .collect();
                if !ext_conditions.is_empty() {
                    conditions.push(format!("({})", ext_conditions.join(" OR ")));
                }
            }
        }

        if let Some(date_start) = filter.date_start.as_ref() {
            if !date_start.is_empty() {
                conditions.push("f.imported_at >= ?".to_string());
                params_vec.push(Box::new(date_start.clone()));
            }
        }

        if let Some(date_end) = filter.date_end.as_ref() {
            if !date_end.is_empty() {
                conditions.push("f.imported_at <= ?".to_string());
                params_vec.push(Box::new(date_end.clone()));
            }
        }

        if let Some(size_min) = filter.size_min {
            conditions.push("f.size >= ?".to_string());
            params_vec.push(Box::new(size_min));
        }

        if let Some(size_max) = filter.size_max {
            conditions.push("f.size <= ?".to_string());
            params_vec.push(Box::new(size_max));
        }

        if let Some(min_rating) = filter.min_rating {
            if min_rating > 0 {
                conditions.push("f.rating >= ?".to_string());
                params_vec.push(Box::new(min_rating));
            }
        }

        if filter.favorites_only.unwrap_or(false) {
            conditions.push("f.rating > 0".to_string());
        }

        if let Some(tag_ids) = filter.tag_ids.as_ref() {
            if !tag_ids.is_empty() {
                let placeholders: Vec<String> = tag_ids.iter().map(|_| "?".to_string()).collect();
                conditions.push(format!("ft.tag_id IN ({})", placeholders.join(", ")));
                for tag_id in tag_ids {
                    params_vec.push(Box::new(*tag_id));
                }
            }
        }

        let has_color_filter = filter
            .dominant_color
            .as_ref()
            .map(|color| !color.is_empty())
            .unwrap_or(false);
        if has_color_filter {
            conditions.push("f.dominant_color != ''".to_string());
        }

        if !conditions.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&conditions.join(" AND "));
        }

        has_color_filter
    }

    /// Filter files based on various criteria
    pub fn filter_files(
        &self,
        filter: crate::commands::FileFilter,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<FileWithTags>> {
        let mut sql = String::from(
            "SELECT DISTINCT f.id, f.path, f.name, f.ext, f.size, f.width, f.height, f.folder_id, f.created_at, f.modified_at, f.imported_at, f.rating, f.description, f.source_url, f.dominant_color, f.color_distribution, f.deleted_at FROM files f"
        );
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        let has_color_filter = Self::append_file_filter_sql(&mut sql, &filter, &mut params_vec);

        sql.push_str(" ORDER BY f.imported_at DESC, f.id ASC");

        // Add LIMIT and OFFSET if provided
        if let (Some(l), Some(o)) = (limit, offset) {
            sql.push_str(&format!(" LIMIT {} OFFSET {}", l, o));
        } else if let Some(l) = limit {
            sql.push_str(&format!(" LIMIT {}", l));
        }

        // Prepare and execute the query
        let mut stmt = self.conn.prepare(&sql)?;

        let params_refs: Vec<&dyn rusqlite::ToSql> =
            params_vec.iter().map(|p| p.as_ref()).collect();

        let files: Vec<(FileRecord, Option<String>)> = stmt
            .query_map(params_refs.as_slice(), |row| {
                Ok((
                    FileRecord {
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
                    },
                    row.get(16)?,
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();

        let color_threshold = 85.0;
        let target_color = filter
            .dominant_color
            .as_ref()
            .filter(|color| !color.is_empty());
        let files: Vec<(FileRecord, Option<String>)> = if has_color_filter {
            let target_color =
                target_color.expect("color filter presence should match SQL conditions");
            files
                .into_iter()
                .filter(|(file, _)| {
                    colors_are_similar(&file.dominant_color, target_color, color_threshold)
                })
                .collect()
        } else {
            files
        };

        let file_ids: Vec<i64> = files.iter().map(|(file, _)| file.id).collect();
        let tags_map = self.get_tags_for_files(&file_ids)?;

        let result: Vec<FileWithTags> = files
            .into_iter()
            .map(|(file, deleted_at)| {
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
                    deleted_at,
                }
            })
            .collect();

        Ok(result)
    }

    /// Get count of filtered files
    pub fn filter_files_count(&self, filter: &crate::commands::FileFilter) -> Result<i64> {
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        let target_color = filter
            .dominant_color
            .as_ref()
            .filter(|color| !color.is_empty());

        if let Some(target_color) = target_color {
            let mut sql = String::from("SELECT DISTINCT f.id, f.dominant_color FROM files f");
            Self::append_file_filter_sql(&mut sql, filter, &mut params_vec);

            let mut stmt = self.conn.prepare(&sql)?;
            let params_refs: Vec<&dyn rusqlite::ToSql> =
                params_vec.iter().map(|p| p.as_ref()).collect();
            let colors: Vec<String> = stmt
                .query_map(params_refs.as_slice(), |row| row.get(1))?
                .filter_map(|r| r.ok())
                .collect();

            let count = colors
                .into_iter()
                .filter(|color| colors_are_similar(color, target_color, 85.0))
                .count() as i64;
            return Ok(count);
        }

        let mut sql = String::from("SELECT COUNT(DISTINCT f.id) FROM files f");
        Self::append_file_filter_sql(&mut sql, filter, &mut params_vec);

        let mut stmt = self.conn.prepare(&sql)?;
        let params_refs: Vec<&dyn rusqlite::ToSql> =
            params_vec.iter().map(|p| p.as_ref()).collect();

        stmt.query_row(params_refs.as_slice(), |row| row.get(0))
    }
}
