use super::*;

pub(super) fn apply(db: &Database) -> Result<()> {
    db.conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS file_embeddings (
            file_id INTEGER PRIMARY KEY,
            model TEXT NOT NULL,
            dimensions INTEGER NOT NULL,
            embedding BLOB,
            search_text TEXT NOT NULL DEFAULT '',
            source_updated_at TEXT NOT NULL,
            indexed_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            last_error TEXT NOT NULL DEFAULT '',
            FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_file_embeddings_model_status
            ON file_embeddings(model, status);
        ",
    )?;

    Ok(())
}
