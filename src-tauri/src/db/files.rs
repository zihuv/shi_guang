use super::query::files_filter::{append_file_filter_sql, build_file_order_sql};
use super::*;

impl Database {
    pub fn get_all_files(
        &self,
        limit: Option<i64>,
        offset: Option<i64>,
        sort_by: Option<&str>,
        sort_direction: Option<&str>,
    ) -> Result<Vec<FileWithTags>> {
        let order_sql = build_file_order_sql(sort_by, sort_direction, "");
        let sql = if limit.is_some() && offset.is_some() {
            format!(
                "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution, deleted_at FROM files WHERE deleted_at IS NULL ORDER BY {order_sql} LIMIT ?1 OFFSET ?2"
            )
        } else if limit.is_some() {
            format!(
                "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution, deleted_at FROM files WHERE deleted_at IS NULL ORDER BY {order_sql} LIMIT ?1"
            )
        } else {
            format!(
                "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution, deleted_at FROM files WHERE deleted_at IS NULL ORDER BY {order_sql}"
            )
        };

        let mut stmt = self.conn.prepare(&sql)?;

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
        sort_by: Option<&str>,
        sort_direction: Option<&str>,
    ) -> Result<Vec<FileWithTags>> {
        let search_pattern = format!("%{}%", query);
        let order_sql = build_file_order_sql(sort_by, sort_direction, "");
        let sql = if limit.is_some() && offset.is_some() {
            format!(
                "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution
             FROM files
             WHERE name LIKE ?1 AND deleted_at IS NULL
             ORDER BY {order_sql} LIMIT ?2 OFFSET ?3"
            )
        } else if limit.is_some() {
            format!(
                "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution
             FROM files
             WHERE name LIKE ?1 AND deleted_at IS NULL
             ORDER BY {order_sql} LIMIT ?2"
            )
        } else {
            format!(
                "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution
             FROM files
             WHERE name LIKE ?1 AND deleted_at IS NULL
             ORDER BY {order_sql}"
            )
        };

        let mut stmt = self.conn.prepare(&sql)?;

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
        sort_by: Option<&str>,
        sort_direction: Option<&str>,
    ) -> Result<Vec<FileWithTags>> {
        let order_sql = build_file_order_sql(sort_by, sort_direction, "");
        let sql = if folder_id.is_some() {
            if limit.is_some() && offset.is_some() {
                format!(
                    "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution
                 FROM files
                 WHERE folder_id = ?1 AND deleted_at IS NULL
                 ORDER BY {order_sql} LIMIT ?2 OFFSET ?3"
                )
            } else if limit.is_some() {
                format!(
                    "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution
                 FROM files
                 WHERE folder_id = ?1 AND deleted_at IS NULL
                 ORDER BY {order_sql} LIMIT ?2"
                )
            } else {
                format!(
                    "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution
                 FROM files
                 WHERE folder_id = ?1 AND deleted_at IS NULL
                 ORDER BY {order_sql}"
                )
            }
        } else {
            if limit.is_some() && offset.is_some() {
                format!(
                    "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution
                 FROM files
                 WHERE folder_id IS NULL AND deleted_at IS NULL
                 ORDER BY {order_sql} LIMIT ?1 OFFSET ?2"
                )
            } else if limit.is_some() {
                format!(
                    "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution
                 FROM files
                 WHERE folder_id IS NULL AND deleted_at IS NULL
                 ORDER BY {order_sql} LIMIT ?1"
                )
            } else {
                format!(
                    "SELECT id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution
                 FROM files
                 WHERE folder_id IS NULL AND deleted_at IS NULL
                 ORDER BY {order_sql}"
                )
            }
        };

        let mut stmt = self.conn.prepare(&sql)?;

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
        let (dominant_r, dominant_g, dominant_b) = match parse_hex_color(&dominant_color) {
            Some((r, g, b)) => (Some(r as i64), Some(g as i64), Some(b as i64)),
            None => (None, None, None),
        };
        let sync_id = generate_sync_id("file");
        let updated_at = current_timestamp();

        self.conn.execute(
            "INSERT INTO files (
                path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at,
                rating, description, source_url, dominant_color, dominant_r, dominant_g, dominant_b, color_distribution,
                sync_id, content_hash, fs_modified_at, updated_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18,
                COALESCE((SELECT sync_id FROM files WHERE path = ?1), ?19),
                (SELECT content_hash FROM files WHERE path = ?1),
                ?20,
                ?21
            )
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
                dominant_r = excluded.dominant_r,
                dominant_g = excluded.dominant_g,
                dominant_b = excluded.dominant_b,
                color_distribution = excluded.color_distribution,
                content_hash = excluded.content_hash,
                fs_modified_at = excluded.fs_modified_at,
                deleted_at = NULL",
            params![
                file.path,
                file.name,
                file.ext,
                file.size,
                file.width,
                file.height,
                file.folder_id,
                file.created_at,
                file.modified_at,
                imported_at,
                rating,
                description,
                source_url,
                dominant_color,
                dominant_r,
                dominant_g,
                dominant_b,
                color_distribution,
                sync_id,
                file.modified_at,
                updated_at
            ],
        )?;
        self.conn.query_row(
            "SELECT id FROM files WHERE path = ?1",
            [file.path.as_str()],
            |row| row.get(0),
        )
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

    pub fn update_file_dimensions(&self, file_id: i64, width: i32, height: i32) -> Result<()> {
        self.conn.execute(
            "UPDATE files SET width = ?1, height = ?2 WHERE id = ?3",
            params![width, height, file_id],
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
        append_file_filter_sql(&mut sql, &filter, &mut params_vec);

        let order_sql = build_file_order_sql(
            filter.sort_by.as_deref(),
            filter.sort_direction.as_deref(),
            "f.",
        );
        sql.push_str(" ORDER BY ");
        sql.push_str(&order_sql);

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
        let mut sql = String::from("SELECT COUNT(DISTINCT f.id) FROM files f");
        append_file_filter_sql(&mut sql, filter, &mut params_vec);

        let mut stmt = self.conn.prepare(&sql)?;
        let params_refs: Vec<&dyn rusqlite::ToSql> =
            params_vec.iter().map(|p| p.as_ref()).collect();

        stmt.query_row(params_refs.as_slice(), |row| row.get(0))
    }
}
