# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Important Rules

- **Never commit code yourself** - Only generate fixes, let the user commit themselves
- **Prefer third-party libraries** - Use mature, well-tested libraries (like shadcn/ui) to simplify development

## Project Overview

拾光 (shiguang) is a desktop material/asset management tool similar to PixCall or BillFish. It indexes design files from user-selected folders and provides browsing, tagging, and search functionality.

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite + TailwindCSS + Zustand
- **Backend**: Tauri 2 (Rust) + SQLite (rusqlite)
- **UI**: Shadcn/ui (built on Radix UI)
- **Package Manager**: pnpm

## Common Commands

```bash
pnpm dev           # Start Vite dev server (localhost:1420)
pnpm tauri dev     # Run full Tauri app (starts both frontend + backend)
pnpm build         # Build frontend
pnpm tauri build   # Build Tauri app (release)
```

## Project Structure

```
src/
├── App.tsx                    # Main app component
├── stores/                    # Zustand state management
│   ├── fileStore.ts           # File list, search, tagging
│   ├── tagStore.ts            # Tag management
│   ├── folderStore.ts         # Folder tree management
│   └── settingsStore.ts       # Theme, index paths
├── components/
│   ├── Header.tsx             # Top navigation with search
│   ├── FileGrid.tsx           # Grid view of files
│   ├── FolderTree.tsx         # Folder tree navigation
│   ├── DetailPanel.tsx        # File/folder detail panel
│   ├── TagPanel.tsx           # Tag management panel
│   ├── SidePanel.tsx          # Collapsible side container
│   ├── SettingsModal.tsx      # Settings dialog
│   ├── ImagePreview.tsx       # Image preview component
│   └── ui/                    # Shadcn/ui components
src-tauri/src/
├── lib.rs                     # Tauri app entry
├── commands.rs                # Command handlers
├── db.rs                      # SQLite operations
└── indexer.rs                # File system scanner
```

## Skills

Use these tools for specific tasks:
- `/shiguang-debug` - Debug issues (check logs, inspect UI, verify functionality)
- `/shadcn` - Add or modify shadcn/ui components
- **Context7** - Query documentation for libraries (use "use context7" in prompts)

## Tauri IPC

Frontend calls Rust via `invoke()`. Key commands:

### File
- `get_all_files`, `search_files`, `get_files_in_folder`
- `import_file`, `import_image_from_base64`
- `delete_file`, `delete_files`, `move_file`
- `add_tag_to_file`, `remove_tag_from_file`
- `update_file_name`, `update_file_metadata`
- `extract_color`, `export_file`

### Tag
- `get_all_tags`, `create_tag`, `update_tag`, `delete_tag`

### Folder
- `get_folder_tree`, `create_folder`, `rename_folder`, `delete_folder`
- `init_default_folder`, `init_browser_collection_folder`, `get_browser_collection_folder`

### Settings
- `get_setting`, `set_setting`
- `get_index_paths`, `add_index_path`, `remove_index_path`
- `reindex_all`, `scan_folders`

## UI Components

All UI components are in `src/components/ui/`. Import using `@/components/ui/ComponentName`.

## Path Aliases

Use `@/` alias for `src/`. Example: `import { Button } from '@/components/ui/Button'`

## Debugging Tips

- Use `console.log` to check state values before debugging UI
- For React issues, check component render logic and state flow first
- For Tauri issues, use `shiguang-debug` skill to check logs and inspect the app
