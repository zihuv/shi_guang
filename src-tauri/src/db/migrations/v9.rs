use super::*;

pub(super) fn apply(db: &Database) -> Result<()> {
    let has_source_content_hash: i32 = db.conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('file_visual_embeddings') WHERE name = 'source_content_hash'",
        [],
        |row| row.get(0),
    )?;

    if has_source_content_hash == 0 {
        db.conn.execute(
            "ALTER TABLE file_visual_embeddings ADD COLUMN source_content_hash TEXT",
            [],
        )?;
    }

    Ok(())
}
