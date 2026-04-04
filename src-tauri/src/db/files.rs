use super::*;

impl Database {
    fn qualify_sort_column(prefix: &str, column: &str) -> String {
        if prefix.is_empty() {
            column.to_string()
        } else {
            format!("{prefix}{column}")
        }
    }

    fn build_file_order_sql(
        sort_by: Option<&str>,
        sort_direction: Option<&str>,
        prefix: &str,
    ) -> String {
        let direction = if matches!(sort_direction, Some("asc")) {
            "ASC"
        } else {
            "DESC"
        };
        let imported_at = Self::qualify_sort_column(prefix, "imported_at");
        let modified_at = Self::qualify_sort_column(prefix, "modified_at");
        let created_at = Self::qualify_sort_column(prefix, "created_at");
        let name = Self::qualify_sort_column(prefix, "name");
        let ext = Self::qualify_sort_column(prefix, "ext");
        let size = Self::qualify_sort_column(prefix, "size");
        let id = Self::qualify_sort_column(prefix, "id");

        match sort_by.unwrap_or("imported_at") {
            "modified_at" => format!("{modified_at} {direction}, {imported_at} DESC, {id} ASC"),
            "created_at" => format!("{created_at} {direction}, {imported_at} DESC, {id} ASC"),
            "name" => format!("LOWER({name}) {direction}, {imported_at} DESC, {id} ASC"),
            "ext" => {
                format!("LOWER({ext}) {direction}, LOWER({name}) ASC, {imported_at} DESC, {id} ASC")
            }
            "size" => format!("{size} {direction}, {imported_at} DESC, {id} ASC"),
            _ => format!("{imported_at} {direction}, {id} ASC"),
        }
    }

    pub fn get_all_files(
        &self,
        limit: Option<i64>,
        offset: Option<i64>,
        sort_by: Option<&str>,
        sort_direction: Option<&str>,
    ) -> Result<Vec<FileWithTags>> {
        let order_sql = Self::build_file_order_sql(sort_by, sort_direction, "");
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
        let order_sql = Self::build_file_order_sql(sort_by, sort_direction, "");
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
        let order_sql = Self::build_file_order_sql(sort_by, sort_direction, "");
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

    fn append_file_filter_sql(
        sql: &mut String,
        filter: &crate::commands::FileFilter,
        params_vec: &mut Vec<Box<dyn rusqlite::ToSql>>,
    ) {
        let mut conditions: Vec<String> = Vec::new();

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
                conditions.push(format!(
                    "EXISTS (SELECT 1 FROM file_tags ft WHERE ft.file_id = f.id AND ft.tag_id IN ({}))",
                    placeholders.join(", ")
                ));
                for tag_id in tag_ids {
                    params_vec.push(Box::new(*tag_id));
                }
            }
        }

        if let Some(target_color) = filter
            .dominant_color
            .as_ref()
            .filter(|color| !color.is_empty())
        {
            if let Some((r, g, b)) = parse_hex_color(target_color) {
                let threshold_squared = 85i64 * 85i64;
                let r = r as i64;
                let g = g as i64;
                let b = b as i64;
                conditions.push(
                    "f.dominant_r IS NOT NULL AND f.dominant_g IS NOT NULL AND f.dominant_b IS NOT NULL AND (((f.dominant_r - ?) * (f.dominant_r - ?)) + ((f.dominant_g - ?) * (f.dominant_g - ?)) + ((f.dominant_b - ?) * (f.dominant_b - ?))) <= ?".to_string(),
                );
                params_vec.push(Box::new(r));
                params_vec.push(Box::new(r));
                params_vec.push(Box::new(g));
                params_vec.push(Box::new(g));
                params_vec.push(Box::new(b));
                params_vec.push(Box::new(b));
                params_vec.push(Box::new(threshold_squared));
            } else {
                conditions.push("1 = 0".to_string());
            }
        }

        if !conditions.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&conditions.join(" AND "));
        }
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
        Self::append_file_filter_sql(&mut sql, &filter, &mut params_vec);

        let order_sql = Self::build_file_order_sql(
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
        Self::append_file_filter_sql(&mut sql, filter, &mut params_vec);

        let mut stmt = self.conn.prepare(&sql)?;
        let params_refs: Vec<&dyn rusqlite::ToSql> =
            params_vec.iter().map(|p| p.as_ref()).collect();

        stmt.query_row(params_refs.as_slice(), |row| row.get(0))
    }
}
