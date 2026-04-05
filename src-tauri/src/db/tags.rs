use super::*;

impl Database {
    pub fn get_all_tags(&self) -> Result<Vec<Tag>> {
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.name, t.color, COUNT(f.id) as count, t.parent_id, t.sort_order
             FROM tags t
             LEFT JOIN file_tags ft ON t.id = ft.tag_id
             LEFT JOIN files f ON f.id = ft.file_id AND f.deleted_at IS NULL
             GROUP BY t.id
             ORDER BY COALESCE(t.parent_id, t.id), t.sort_order ASC, t.name ASC",
        )?;
        let tags = stmt
            .query_map([], |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    count: row.get(3)?,
                    parent_id: row.get(4)?,
                    sort_order: row.get(5)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(tags)
    }

    pub fn create_tag(&self, name: &str, color: &str, parent_id: Option<i64>) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO tags (name, color, parent_id, sync_id, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                name,
                color,
                parent_id,
                generate_sync_id("tag"),
                current_timestamp()
            ],
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
            "SELECT ft.file_id, t.id, t.name, t.color, t.parent_id, t.sort_order FROM tags t
             INNER JOIN file_tags ft ON t.id = ft.tag_id
             WHERE ft.file_id IN ({})
             ORDER BY ft.file_id ASC, ft.rowid ASC",
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
                    parent_id: row.get(4)?,
                    sort_order: row.get(5)?,
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
            "SELECT t.id, t.name, t.color, t.parent_id, t.sort_order FROM tags t
             INNER JOIN file_tags ft ON t.id = ft.tag_id
             WHERE ft.file_id = ?1
             ORDER BY ft.rowid ASC",
        )?;
        let tags = stmt
            .query_map([file_id], |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    count: 1,
                    parent_id: row.get(3)?,
                    sort_order: row.get(4)?,
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn setup_db() -> (Database, PathBuf) {
        let path =
            std::env::temp_dir().join(format!("shiguang-tags-test-{}.db", generate_sync_id("db")));
        let db = Database::new(&path).unwrap();
        (db, path)
    }

    #[test]
    fn file_tags_follow_attachment_order() {
        let (db, path) = setup_db();
        let now = current_timestamp();

        db.conn
            .execute(
                "INSERT INTO files (
                    path, name, ext, size, width, height, folder_id, created_at, modified_at,
                    imported_at, rating, description, source_url, dominant_color, color_distribution,
                    sync_id, fs_modified_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
                params![
                    "/tmp/demo.png",
                    "demo.png",
                    "png",
                    1_i64,
                    1_i32,
                    1_i32,
                    Option::<i64>::None,
                    &now,
                    &now,
                    &now,
                    0_i32,
                    "",
                    "",
                    "",
                    "[]",
                    generate_sync_id("file"),
                    &now,
                    &now,
                ],
            )
            .unwrap();
        let file_id = db.conn.last_insert_rowid();

        let first_tag_id = db
            .create_tag("z-last-added-first", "#111111", None)
            .unwrap();
        let second_tag_id = db
            .create_tag("a-last-added-second", "#222222", None)
            .unwrap();

        db.add_tag_to_file(file_id, first_tag_id).unwrap();
        db.add_tag_to_file(file_id, second_tag_id).unwrap();

        let tags = db.get_file_tags(file_id).unwrap();

        assert_eq!(
            tags.iter().map(|tag| tag.name.as_str()).collect::<Vec<_>>(),
            vec!["z-last-added-first", "a-last-added-second"]
        );

        drop(db);
        let _ = std::fs::remove_file(path);
    }
}
