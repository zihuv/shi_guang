use super::*;

mod v1;
mod v2;
mod v3;
mod v4;
mod v5;
mod v6;
mod v7;
mod v8;
mod v9;
mod v10;

pub(super) fn run_migrations(db: &Database) -> Result<()> {
    let current_version: i32 = db
        .conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))?;

    if current_version < 1 {
        v1::apply(db)?;
    }

    if current_version < 2 {
        v2::apply(db)?;
    }

    if current_version < 3 {
        v3::apply(db)?;
    }

    if current_version < 4 {
        v4::apply(db)?;
    }

    if (1..5).contains(&current_version) {
        v5::apply(db)?;
    }

    if current_version < 6 {
        v6::apply(db)?;
    }

    if current_version < 7 {
        v7::apply(db)?;
    }

    if current_version < 8 {
        v8::apply(db)?;
    }

    if current_version < 9 {
        v9::apply(db)?;
    }

    if current_version < 10 {
        v10::apply(db)?;
    }

    db.conn
        .execute_batch(&format!("PRAGMA user_version = {};", DB_SCHEMA_VERSION))?;
    Ok(())
}

pub(super) fn migrate_files_table(db: &Database) -> Result<()> {
    db.conn.execute_batch(
        "
        BEGIN IMMEDIATE;
        PRAGMA foreign_keys = OFF;

        DROP TRIGGER IF EXISTS update_files_modified_at;
        DROP TRIGGER IF EXISTS update_files_updated_at;
        DROP TRIGGER IF EXISTS update_file_tags_file_updated_at_insert;
        DROP TRIGGER IF EXISTS update_file_tags_file_updated_at_delete;
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
            deleted_at TEXT DEFAULT NULL,
            sync_id TEXT NOT NULL UNIQUE,
            content_hash TEXT,
            fs_modified_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        INSERT INTO files_new (
            id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at,
            rating, description, source_url, dominant_color, dominant_r, dominant_g, dominant_b, color_distribution, deleted_at,
            sync_id, content_hash, fs_modified_at, updated_at
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
            dominant_r,
            dominant_g,
            dominant_b,
            CASE
                WHEN color_distribution IS NULL OR trim(color_distribution) = '' THEN '[]'
                ELSE color_distribution
            END,
            deleted_at,
            CASE
                WHEN sync_id IS NULL OR trim(sync_id) = '' THEN 'file_' || lower(hex(randomblob(16)))
                ELSE sync_id
            END,
            content_hash,
            COALESCE(
                NULLIF(fs_modified_at, ''),
                NULLIF(modified_at, ''),
                NULLIF(created_at, ''),
                NULLIF(imported_at, ''),
                datetime('now', 'localtime')
            ),
            COALESCE(
                NULLIF(updated_at, ''),
                NULLIF(imported_at, ''),
                NULLIF(modified_at, ''),
                NULLIF(created_at, ''),
                datetime('now', 'localtime')
            )
        FROM files;

        DROP TABLE files;
        ALTER TABLE files_new RENAME TO files;

        PRAGMA foreign_keys = ON;
        COMMIT;
        ",
    )?;

    Ok(())
}

pub(super) fn normalize_existing_data(db: &Database) -> Result<()> {
    db.conn.execute_batch(
        "
        UPDATE files
        SET imported_at = COALESCE(NULLIF(imported_at, ''), modified_at, created_at, datetime('now', 'localtime'))
        WHERE imported_at IS NULL OR imported_at = '';

        UPDATE files
        SET description = COALESCE(description, ''),
            source_url = COALESCE(source_url, ''),
            dominant_color = COALESCE(dominant_color, ''),
            fs_modified_at = COALESCE(NULLIF(fs_modified_at, ''), modified_at, created_at, imported_at, datetime('now', 'localtime')),
            updated_at = COALESCE(NULLIF(updated_at, ''), imported_at, modified_at, created_at, datetime('now', 'localtime')),
            color_distribution = CASE
                WHEN color_distribution IS NULL OR trim(color_distribution) = '' THEN '[]'
                ELSE color_distribution
            END,
            rating = COALESCE(rating, 0);

        UPDATE files
        SET folder_id = NULL
        WHERE folder_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM folders WHERE folders.id = files.folder_id);

        UPDATE folders
        SET sync_id = COALESCE(NULLIF(sync_id, ''), 'folder_' || lower(hex(randomblob(16)))),
            updated_at = COALESCE(NULLIF(updated_at, ''), created_at, datetime('now', 'localtime'));

        UPDATE tags
        SET sync_id = COALESCE(NULLIF(sync_id, ''), 'tag_' || lower(hex(randomblob(16)))),
            updated_at = COALESCE(NULLIF(updated_at, ''), datetime('now', 'localtime'));
        ",
    )?;

    Ok(())
}

pub(super) fn backfill_dominant_color_channels(db: &Database) -> Result<()> {
    let mut stmt = db
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

        db.conn.execute(
            "UPDATE files SET dominant_r = ?1, dominant_g = ?2, dominant_b = ?3 WHERE id = ?4",
            params![r, g, b, id],
        )?;
    }

    Ok(())
}

pub(super) fn normalize_browser_collection_folder(db: &Database) -> Result<()> {
    db.conn.execute(
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

pub(super) fn normalize_relative_paths(db: &Database) -> Result<()> {
    let Some(index_path) = db.get_index_paths()?.into_iter().next() else {
        return Ok(());
    };

    let mut folder_stmt = db.conn.prepare("SELECT id, path FROM folders")?;
    let folders: Vec<(i64, String)> = folder_stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .filter_map(|row| row.ok())
        .collect();

    for (id, path) in folders {
        if !Path::new(&path).is_absolute() {
            let normalized = join_path(&index_path, &path);
            db.conn.execute(
                "UPDATE folders SET path = ?1 WHERE id = ?2",
                params![normalized, id],
            )?;
        }
    }

    let mut file_stmt = db.conn.prepare("SELECT id, path FROM files")?;
    let files: Vec<(i64, String)> = file_stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .filter_map(|row| row.ok())
        .collect();

    for (id, path) in files {
        if !Path::new(&path).is_absolute() {
            let normalized = join_path(&index_path, &path);
            db.conn.execute(
                "UPDATE files SET path = ?1 WHERE id = ?2",
                params![normalized, id],
            )?;
        }
    }

    Ok(())
}
