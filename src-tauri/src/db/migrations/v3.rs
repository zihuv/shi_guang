use super::*;

pub(super) fn apply(db: &Database) -> Result<()> {
    super::backfill_dominant_color_channels(db)
}
