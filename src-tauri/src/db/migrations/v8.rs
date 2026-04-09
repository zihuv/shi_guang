use super::*;

pub(super) fn apply(db: &Database) -> Result<()> {
    db.conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS file_visual_embeddings (
            file_id INTEGER PRIMARY KEY,
            model_id TEXT NOT NULL,
            dimensions INTEGER NOT NULL,
            embedding BLOB,
            source_size INTEGER NOT NULL,
            source_modified_at TEXT NOT NULL,
            indexed_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            last_error TEXT NOT NULL DEFAULT '',
            FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_file_visual_embeddings_model_status
            ON file_visual_embeddings(model_id, status);
        ",
    )?;

    Ok(())
}
