use super::*;

pub(super) fn apply(db: &Database) -> Result<()> {
    super::migrate_files_table(db)
}

