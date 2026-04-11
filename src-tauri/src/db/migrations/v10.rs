use super::*;

pub(super) fn apply(db: &Database) -> Result<()> {
    db.conn.execute_batch(
        "
        DROP INDEX IF EXISTS idx_file_embeddings_model_status;
        DROP TABLE IF EXISTS file_embeddings;
        ",
    )?;

    Ok(())
}
