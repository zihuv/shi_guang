# Shiguang UI Design Style

## Direction

This project should stay in a minimal desktop-tool direction, closer to Billfish and Eagle than to a generic web dashboard.

Core traits:

- Quiet, compact, and information-first
- Strong structure through spacing and borders, not through heavy decoration
- Consistent density across header, side panels, toolbar, cards, and detail panels
- Desktop-native feeling for Chinese and English mixed content

## Visual Rules

### Typography

- Use the system-oriented UI stack defined in [src/index.css](/D:/code/shiguang/shiguang/src/index.css).
- Prefer only 3 text tiers in the main shell:
  - `15px` for app title and important page titles
  - `13px` for normal UI text, list items, form fields, and buttons
  - `11px` for metadata, labels, counters, and helper text
- Avoid mixing `text-sm`, `text-xs`, and arbitrary sizes in the same area unless there is a clear hierarchy reason.

### Spacing

- Top app header height: `54px`
- Panel header height: `44px`
- Standard input/button height: `34px`
- Main content padding: prefer `12px`
- Micro gaps between toolbar actions: `6px`
- Standard card corner radius: `14px` to `16px`

### Color

- Keep backgrounds layered but quiet:
  - app canvas
  - panel surface
  - card surface
- Use accent color mainly for selection, progress, and primary action.
- Avoid large blocks of saturated color.
- Use red only for destructive actions.

### Surfaces

- Reuse the shared shell classes:
  - `.app-topbar`
  - `.app-panel`
  - `.app-panel-header`
  - `.app-card-surface`
- Reuse the shared UI class tokens in [src/lib/ui.ts](/D:/code/shiguang/shiguang/src/lib/ui.ts) for panel titles, metadata, tree rows, and small actions.

## Component Rules

### Header

- Keep only logo, global search, import action, and utility actions.
- Do not reserve empty space for transient status.
- Progress should appear as a compact inline pill only while active.

### Side Panels

- Folder tree and tag tree should share the same row height, font size, icon size, and counter style.
- Headers should look identical except for the title and actions.
- Selected state should be subtle and flat, not heavy.

### File Grid

- Cards should feel clean and lightweight.
- Name is primary, metadata secondary, tags tertiary.
- Hover motion should be minimal.
- Selection should rely on ring and soft shadow, not large background shifts.

### Detail Panel

- Keep the preview dominant.
- Metadata should use a simple two-column label/value rhythm.
- Labels stay at `11px`; values stay at `12px` to `13px`.
- Action buttons should stay compact and align with panel header height.

## Interaction Rules

- Prefer one clear primary action per area.
- Avoid stacking multiple bordered controls with different radii or heights.
- Menus and popovers should use the same rounded, soft-surface treatment.
- Empty states should be calm and compact; do not oversize icons and text.

## Implementation Notes

- When building new shell-level UI, start from the shared tokens in:
  - [src/index.css](/D:/code/shiguang/shiguang/src/index.css)
  - [src/lib/ui.ts](/D:/code/shiguang/shiguang/src/lib/ui.ts)
- If a new page needs a different look, treat that as an exception and document why.
- Before merging UI work, check:
  - header height is fixed and compact
  - text tiers stay within `15 / 13 / 11`
  - buttons and inputs share the same control height
  - side panels and detail panel follow the same header rhythm
