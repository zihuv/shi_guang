use super::*;

impl Database {
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
        let mut stmt = self
            .conn
            .prepare("SELECT path FROM index_paths ORDER BY id ASC LIMIT 1")?;
        let paths = stmt
            .query_map([], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(paths)
    }

    pub fn add_index_path(&self, path: &str) -> Result<()> {
        if let Some(current_path) = self.get_index_paths()?.into_iter().next() {
            if current_path == path {
                return Ok(());
            }

            return Err(rusqlite::Error::InvalidParameterName(
                "Only one index path is supported".to_string(),
            ));
        }

        self.conn.execute(
            "INSERT OR IGNORE INTO index_paths (path) VALUES (?1)",
            [path],
        )?;
        Ok(())
    }

    pub fn set_index_path(&self, path: &str) -> Result<()> {
        self.conn.execute("DELETE FROM index_paths", [])?;
        self.conn
            .execute("INSERT INTO index_paths (path) VALUES (?1)", [path])?;
        Ok(())
    }

    pub fn remove_index_path(&self, path: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM index_paths WHERE path = ?1", [path])?;
        Ok(())
    }

    // Folder operations
}
