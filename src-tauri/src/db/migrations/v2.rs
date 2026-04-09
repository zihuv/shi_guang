use super::*;

pub(super) fn apply(db: &Database) -> Result<()> {
    super::normalize_existing_data(db)
}
