use super::super::query::files_filter::{append_file_filter_sql, build_file_order_sql};
use super::super::*;
use super::helpers::{
    active_files_with_tags, collect_file_records, collect_file_records_with_deleted_at,
    file_with_tags, files_with_tags, map_file_record_with_deleted_at, FILE_COLUMNS,
    FILE_COLUMNS_WITH_DELETED_AT,
};

fn append_limit_offset(
    base_sql: String,
    limit: Option<i64>,
    offset: Option<i64>,
    limit_placeholder: &str,
    offset_placeholder: &str,
) -> String {
    match (limit, offset) {
        (Some(_), Some(_)) => {
            format!("{base_sql} LIMIT {limit_placeholder} OFFSET {offset_placeholder}")
        }
        (Some(_), None) => format!("{base_sql} LIMIT {limit_placeholder}"),
        _ => base_sql,
    }
}

impl Database {
    pub fn get_all_files(
        &self,
        limit: Option<i64>,
        offset: Option<i64>,
        sort_by: Option<&str>,
        sort_direction: Option<&str>,
    ) -> Result<Vec<FileWithTags>> {
        let order_sql = build_file_order_sql(sort_by, sort_direction, "");
        let sql = append_limit_offset(
            format!(
                "SELECT {FILE_COLUMNS} FROM files WHERE deleted_at IS NULL ORDER BY {order_sql}"
            ),
            limit,
            offset,
            "?1",
            "?2",
        );

        let mut stmt = self.conn.prepare(&sql)?;
        let files = match (limit, offset) {
            (Some(l), Some(o)) => collect_file_records(&mut stmt, params![l, o])?,
            (Some(l), None) => collect_file_records(&mut stmt, params![l])?,
            _ => collect_file_records(&mut stmt, [])?,
        };

        active_files_with_tags(self, files)
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
        let sql = append_limit_offset(
            format!(
                "SELECT {FILE_COLUMNS} FROM files WHERE name LIKE ?1 AND deleted_at IS NULL ORDER BY {order_sql}"
            ),
            limit,
            offset,
            "?2",
            "?3",
        );

        let mut stmt = self.conn.prepare(&sql)?;
        let files = match (limit, offset) {
            (Some(l), Some(o)) => collect_file_records(&mut stmt, params![&search_pattern, l, o])?,
            (Some(l), None) => collect_file_records(&mut stmt, params![&search_pattern, l])?,
            _ => collect_file_records(&mut stmt, [&search_pattern])?,
        };

        active_files_with_tags(self, files)
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
            append_limit_offset(
                format!(
                    "SELECT {FILE_COLUMNS} FROM files WHERE folder_id = ?1 AND deleted_at IS NULL ORDER BY {order_sql}"
                ),
                limit,
                offset,
                "?2",
                "?3",
            )
        } else {
            append_limit_offset(
                format!(
                    "SELECT {FILE_COLUMNS} FROM files WHERE folder_id IS NULL AND deleted_at IS NULL ORDER BY {order_sql}"
                ),
                limit,
                offset,
                "?1",
                "?2",
            )
        };

        let mut stmt = self.conn.prepare(&sql)?;
        let files = match (folder_id, limit, offset) {
            (Some(fid), Some(l), Some(o)) => collect_file_records(&mut stmt, params![fid, l, o])?,
            (Some(fid), Some(l), None) => collect_file_records(&mut stmt, params![fid, l])?,
            (Some(fid), None, _) => collect_file_records(&mut stmt, [fid])?,
            (None, Some(l), Some(o)) => collect_file_records(&mut stmt, params![l, o])?,
            (None, Some(l), None) => collect_file_records(&mut stmt, params![l])?,
            (None, None, _) => collect_file_records(&mut stmt, [])?,
        };

        active_files_with_tags(self, files)
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
        let sql = format!("SELECT {FILE_COLUMNS_WITH_DELETED_AT} FROM files WHERE id = ?1");
        let mut stmt = self.conn.prepare(&sql)?;

        match stmt.query_row([id], map_file_record_with_deleted_at) {
            Ok((file, deleted_at)) => Ok(Some(file_with_tags(self, file, deleted_at)?)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(error),
        }
    }

    pub fn get_file_by_path(&self, path: &str) -> Result<Option<FileWithTags>> {
        let sql = format!("SELECT {FILE_COLUMNS_WITH_DELETED_AT} FROM files WHERE path = ?1");
        let mut stmt = self.conn.prepare(&sql)?;

        match stmt.query_row([path], map_file_record_with_deleted_at) {
            Ok((file, deleted_at)) => Ok(Some(file_with_tags(self, file, deleted_at)?)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(error),
        }
    }

    pub fn get_trash_files(&self) -> Result<Vec<FileWithTags>> {
        let sql = format!(
            "SELECT {FILE_COLUMNS_WITH_DELETED_AT} FROM files WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, id ASC"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let files = collect_file_records_with_deleted_at(&mut stmt, [])?;
        files_with_tags(self, files)
    }

    pub fn get_delete_mode(&self) -> Result<bool> {
        let mut stmt = self
            .conn
            .prepare("SELECT value FROM settings WHERE key = 'use_trash'")?;
        let mut rows = stmt.query([])?;
        if let Some(row) = rows.next()? {
            let value: String = row.get(0)?;
            Ok(value == "true")
        } else {
            Ok(true)
        }
    }

    pub fn filter_files(
        &self,
        filter: crate::commands::FileFilter,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<FileWithTags>> {
        let mut sql = format!("SELECT DISTINCT f.{FILE_COLUMNS_WITH_DELETED_AT} FROM files f");
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        append_file_filter_sql(&mut sql, &filter, &mut params_vec);

        let order_sql = build_file_order_sql(
            filter.sort_by.as_deref(),
            filter.sort_direction.as_deref(),
            "f.",
        );
        sql.push_str(" ORDER BY ");
        sql.push_str(&order_sql);

        if let (Some(l), Some(o)) = (limit, offset) {
            sql.push_str(&format!(" LIMIT {} OFFSET {}", l, o));
        } else if let Some(l) = limit {
            sql.push_str(&format!(" LIMIT {}", l));
        }

        let mut stmt = self.conn.prepare(&sql)?;
        let params_refs: Vec<&dyn rusqlite::ToSql> =
            params_vec.iter().map(|param| param.as_ref()).collect();
        let files = collect_file_records_with_deleted_at(&mut stmt, params_refs.as_slice())?;

        files_with_tags(self, files)
    }

    pub fn filter_files_count(&self, filter: &crate::commands::FileFilter) -> Result<i64> {
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        let mut sql = String::from("SELECT COUNT(DISTINCT f.id) FROM files f");
        append_file_filter_sql(&mut sql, filter, &mut params_vec);

        let mut stmt = self.conn.prepare(&sql)?;
        let params_refs: Vec<&dyn rusqlite::ToSql> =
            params_vec.iter().map(|param| param.as_ref()).collect();

        stmt.query_row(params_refs.as_slice(), |row| row.get(0))
    }
}
