# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

时光 (shi-guang) is a desktop material/asset management tool similar to PixCall or BillFish. It indexes design files (images, PSD, AI, etc.) from user-selected folders and provides browsing, tagging, and search functionality.

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite + TailwindCSS + Zustand
- **Backend**: Tauri 2 (Rust) + SQLite (rusqlite)
- **Package Manager**: pnpm

## Common Commands

```bash
# Development
pnpm dev              # Start Vite dev server
pnpm tauri dev        # Run full Tauri app in dev mode

# Build
pnpm build            # Build frontend
pnpm tauri build      # Build Tauri app (release)
```

## Architecture

### Frontend (`src/`)
- `App.tsx` - Main app component with layout
- `stores/` - Zustand state management
  - `fileStore.ts` - File list, search, tagging
  - `tagStore.ts` - Tag management
  - `settingsStore.ts` - Theme, index paths
- `components/` - React components
  - `Header.tsx` - Top navigation with search
  - `FileGrid.tsx` - Grid view of files
  - `TagPanel.tsx` - Side panel for tag management
  - `SettingsModal.tsx` - Settings dialog

### Backend (`src-tauri/`)
- `src/lib.rs` - Tauri app entry, command registration
- `src/commands.rs` - Tauri command handlers
- `src/db.rs` - SQLite database operations (files, tags, settings, index_paths)
- `src/indexer.rs` - File system scanner for indexing supported formats

### Data Model
- Files are stored in original locations (not copied to DB)
- SQLite stores metadata: id, path, name, ext, size, width, height, created_at, modified_at
- Tags with color support, many-to-many relationship with files
- Settings stored as key-value pairs

### Supported File Formats
`jpg`, `jpeg`, `png`, `gif`, `svg`, `webp`, `bmp`, `ico`, `tiff`, `tif`, `psd`, `ai`, `eps`, `raw`, `cr2`, `nef`, `arw`, `dng`, `heic`, `heif`

## MCP Tools

- **Context7**: Available for this project. Use `use context7` in prompts to get relevant documentation for libraries/frameworks.

## Tauri IPC

Frontend calls Rust via `invoke()`:
- `get_all_files`, `search_files`
- `get_all_tags`, `create_tag`, `update_tag`, `delete_tag`
- `add_tag_to_file`, `remove_tag_from_file`
- `get_setting`, `set_setting`
- `get_index_paths`, `add_index_path`, `remove_index_path`
- `reindex_all`

## UI Components

The project uses [Shadcn/ui](https://ui.shadcn.com/) (built on Radix UI) for UI components. All UI components are located in `src/components/ui/`.

### Available Components
- `Button` - Button with variants (default, destructive, outline, secondary, ghost, link)
- `Input` - Text input field
- `Dialog` - Modal dialog
- `ContextMenu` - Right-click context menu
- `AlertDialog` - Confirmation dialog

### Using Components

```tsx
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'

// Button with variants
<Button variant="default">Default</Button>
<Button variant="destructive">Delete</Button>
<Button variant="outline">Cancel</Button>
<Button variant="ghost">Ghost</Button>
<Button size="sm">Small</Button>
<Button size="icon">Icon</Button>

// Input
<Input placeholder="Search..." />

// Dialog
<Dialog open={isOpen} onOpenChange={setOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Title</DialogTitle>
    </DialogHeader>
    {/* Content */}
  </DialogContent>
</Dialog>
```

### Path Aliases
The project uses `@/` as an alias for `src/`. Use `@/stores/xxx` instead of `../stores/xxx` for imports.

**Rule**: Always prefer `@/` alias over relative paths (`../`) for imports. This makes code more maintainable and easier to refactor.
