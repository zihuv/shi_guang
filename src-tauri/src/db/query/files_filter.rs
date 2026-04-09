use super::super::parse_hex_color;

fn qualify_sort_column(prefix: &str, column: &str) -> String {
    if prefix.is_empty() {
        column.to_string()
    } else {
        format!("{prefix}{column}")
    }
}

pub(crate) fn build_file_order_sql(
    sort_by: Option<&str>,
    sort_direction: Option<&str>,
    prefix: &str,
) -> String {
    let direction = if matches!(sort_direction, Some("asc")) {
        "ASC"
    } else {
        "DESC"
    };
    let imported_at = qualify_sort_column(prefix, "imported_at");
    let modified_at = qualify_sort_column(prefix, "modified_at");
    let created_at = qualify_sort_column(prefix, "created_at");
    let name = qualify_sort_column(prefix, "name");
    let ext = qualify_sort_column(prefix, "ext");
    let size = qualify_sort_column(prefix, "size");
    let id = qualify_sort_column(prefix, "id");

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

pub(crate) fn append_file_filter_sql(
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
                            "tif", "avif", "psd", "ai", "eps", "raw", "cr2", "nef", "arw", "dng",
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
