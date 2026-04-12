use super::super::*;

impl Database {
    pub fn insert_file(&self, file: &FileRecord) -> Result<i64> {
        let existing = self.get_file_by_path(&file.path).ok().flatten();

        let rating = existing.as_ref().map(|entry| entry.rating).unwrap_or(file.rating);
        let description = existing
            .as_ref()
            .map(|entry| entry.description.as_str())
            .unwrap_or(&file.description)
            .to_string();
        let source_url = existing
            .as_ref()
            .map(|entry| entry.source_url.as_str())
            .unwrap_or(&file.source_url)
            .to_string();
        let dominant_color = existing
            .as_ref()
            .map(|entry| entry.dominant_color.as_str())
            .unwrap_or(&file.dominant_color)
            .to_string();
        let color_distribution = existing
            .as_ref()
            .map(|entry| entry.color_distribution.as_str())
            .unwrap_or(&file.color_distribution)
            .to_string();
        let imported_at = existing
            .as_ref()
            .map(|entry| entry.imported_at.as_str())
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

    pub fn update_file_color_data(
        &self,
        file_id: i64,
        dominant_color: &str,
        color_distribution: &str,
    ) -> Result<()> {
        let (dominant_r, dominant_g, dominant_b) = match parse_hex_color(dominant_color) {
            Some((r, g, b)) => (Some(r as i64), Some(g as i64), Some(b as i64)),
            None => (None, None, None),
        };

        self.conn.execute(
            "UPDATE files
             SET dominant_color = ?1,
                 dominant_r = ?2,
                 dominant_g = ?3,
                 dominant_b = ?4,
                 color_distribution = ?5
             WHERE id = ?6",
            params![
                dominant_color,
                dominant_r,
                dominant_g,
                dominant_b,
                color_distribution,
                file_id
            ],
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

    pub fn update_file_content_hash(
        &self,
        file_id: i64,
        content_hash: Option<&str>,
    ) -> Result<()> {
        self.conn.execute(
            "UPDATE files SET content_hash = ?1 WHERE id = ?2",
            params![content_hash, file_id],
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

    pub fn soft_delete_file(&self, file_id: i64) -> Result<()> {
        let now = current_timestamp();
        self.conn.execute(
            "UPDATE files SET deleted_at = ?1 WHERE id = ?2",
            params![now, file_id],
        )?;
        Ok(())
    }

    pub fn restore_file(&self, file_id: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE files SET deleted_at = NULL WHERE id = ?1",
            params![file_id],
        )?;
        Ok(())
    }

    pub fn permanent_delete_file(&self, file_id: i64) -> Result<()> {
        self.conn
            .execute("DELETE FROM files WHERE id = ?1", params![file_id])?;
        Ok(())
    }

    pub fn set_delete_mode(&self, use_trash: bool) -> Result<()> {
        let value = if use_trash { "true" } else { "false" };
        self.conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('use_trash', ?1)",
            params![value],
        )?;
        Ok(())
    }
}
