use super::*;

pub(super) fn apply(db: &Database) -> Result<()> {
    super::normalize_relative_paths(db)
}
