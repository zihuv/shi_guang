use super::*;

pub(super) fn apply(db: &Database) -> Result<()> {
    super::normalize_browser_collection_folder(db)
}

