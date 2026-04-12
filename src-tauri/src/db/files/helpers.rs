use super::super::*;
use rusqlite::{Params, Row, Statement};

pub(super) const FILE_COLUMNS: &str =
    "id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution";
pub(super) const FILE_COLUMNS_WITH_DELETED_AT: &str =
    "id, path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at, rating, description, source_url, dominant_color, color_distribution, deleted_at";

pub(super) fn map_file_record(row: &Row<'_>) -> Result<FileRecord> {
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
}

pub(super) fn map_file_record_with_deleted_at(
    row: &Row<'_>,
) -> Result<(FileRecord, Option<String>)> {
    Ok((map_file_record(row)?, row.get(16)?))
}

pub(super) fn collect_file_records<P>(stmt: &mut Statement<'_>, params: P) -> Result<Vec<FileRecord>>
where
    P: Params,
{
    Ok(stmt
        .query_map(params, map_file_record)?
        .filter_map(|row| row.ok())
        .collect())
}

pub(super) fn collect_file_records_with_deleted_at<P>(
    stmt: &mut Statement<'_>,
    params: P,
) -> Result<Vec<(FileRecord, Option<String>)>>
where
    P: Params,
{
    Ok(stmt
        .query_map(params, map_file_record_with_deleted_at)?
        .filter_map(|row| row.ok())
        .collect())
}

pub(super) fn file_with_tags(
    db: &Database,
    file: FileRecord,
    deleted_at: Option<String>,
) -> Result<FileWithTags> {
    let tags = db.get_file_tags(file.id)?;
    Ok(FileWithTags {
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
    })
}

pub(super) fn active_files_with_tags(
    db: &Database,
    files: Vec<FileRecord>,
) -> Result<Vec<FileWithTags>> {
    files_with_tags(
        db,
        files.into_iter().map(|file| (file, None)).collect(),
    )
}

pub(super) fn files_with_tags(
    db: &Database,
    files: Vec<(FileRecord, Option<String>)>,
) -> Result<Vec<FileWithTags>> {
    let file_ids: Vec<i64> = files.iter().map(|(file, _)| file.id).collect();
    let tags_map = db.get_tags_for_files(&file_ids)?;

    Ok(files
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
        .collect())
}
