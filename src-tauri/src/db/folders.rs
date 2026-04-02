use super::*;

impl Database {
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
        self.create_folder_with_sort_order(path, name, parent_id, is_system, 0)
    }

    pub fn create_folder_with_sort_order(
        &self,
        path: &str,
        name: &str,
        parent_id: Option<i64>,
        is_system: bool,
        sort_order: i32,
    ) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO folders (path, name, parent_id, created_at, is_system, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                path,
                name,
                parent_id,
                chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                is_system as i32,
                sort_order
            ],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn update_folder_sort_order(&self, id: i64, sort_order: i32) -> Result<()> {
        self.conn.execute(
            "UPDATE folders SET sort_order = ?1 WHERE id = ?2",
            params![sort_order, id],
        )?;
        Ok(())
    }

    pub fn ensure_browser_collection_folder(&self) -> Result<Folder> {
        if let Some(mut folder) = self.get_browser_collection_folder()? {
            if folder.sort_order != BROWSER_COLLECTION_FOLDER_SORT_ORDER {
                self.conn.execute(
                    "UPDATE folders SET sort_order = ?1 WHERE id = ?2",
                    params![BROWSER_COLLECTION_FOLDER_SORT_ORDER, folder.id],
                )?;
                folder.sort_order = BROWSER_COLLECTION_FOLDER_SORT_ORDER;
            }
            return Ok(folder);
        }

        let index_path = self.get_index_paths()?.into_iter().next().ok_or_else(|| {
            rusqlite::Error::InvalidParameterName("No index path configured".to_string())
        })?;
        let folder_path = join_path(&index_path, BROWSER_COLLECTION_FOLDER_NAME);
        let path = std::path::Path::new(&folder_path);

        if !path.exists() {
            std::fs::create_dir_all(path)
                .map_err(|e| rusqlite::Error::InvalidParameterName(e.to_string()))?;
        }

        if let Some(mut folder) = self.get_folder_by_path(&folder_path)? {
            self.conn.execute(
                "UPDATE folders SET is_system = 1, parent_id = NULL, sort_order = ?1 WHERE id = ?2",
                params![BROWSER_COLLECTION_FOLDER_SORT_ORDER, folder.id],
            )?;
            folder.is_system = true;
            folder.parent_id = None;
            folder.sort_order = BROWSER_COLLECTION_FOLDER_SORT_ORDER;
            return Ok(folder);
        }

        let id = self.create_folder_with_sort_order(
            &folder_path,
            BROWSER_COLLECTION_FOLDER_NAME,
            None,
            true,
            BROWSER_COLLECTION_FOLDER_SORT_ORDER,
        )?;

        Ok(Folder {
            id,
            path: folder_path,
            name: BROWSER_COLLECTION_FOLDER_NAME.to_string(),
            parent_id: None,
            created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            is_system: true,
            sort_order: BROWSER_COLLECTION_FOLDER_SORT_ORDER,
        })
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
            "SELECT id, path, name, parent_id, created_at, is_system, sort_order
             FROM folders
             WHERE is_system = 1 AND name = ?1
             ORDER BY sort_order ASC, created_at ASC
             LIMIT 1",
        )?;
        let mut rows = stmt.query([BROWSER_COLLECTION_FOLDER_NAME])?;
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
    pub fn reorder_tags(&self, tag_ids: &[i64], parent_id: Option<i64>) -> Result<()> {
        for (index, tag_id) in tag_ids.iter().enumerate() {
            self.conn.execute(
                "UPDATE tags SET sort_order = ?1, parent_id = ?2 WHERE id = ?3",
                params![index as i64, parent_id, tag_id],
            )?;
        }
        Ok(())
    }

    pub fn move_tag(&self, tag_id: i64, new_parent_id: Option<i64>, sort_order: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE tags SET parent_id = ?1, sort_order = ?2 WHERE id = ?3",
            params![new_parent_id, sort_order, tag_id],
        )?;
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
}
