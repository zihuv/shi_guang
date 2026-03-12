# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important Rules

- **Never commit code yourself** - Only generate fixes, let the user commit themselves

## Project Overview

拾光 (shiguang) is a desktop material/asset management tool similar to PixCall or BillFish. It indexes design files (images, PSD, AI, etc.) from user-selected folders and provides browsing, tagging, and search functionality.

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
  - `fileStore.ts` - File list,  - `tagStore.ts` - - `settingsStore search, tagging
 Tag management
 .ts` - Theme, index paths
  - `folderStore.ts` - Folder tree management
- `components/` - React components
  - `Header.tsx` - Top navigation with search
  - `FileGrid.tsx` - Grid view of files (supports drag select)
  - `FolderTree.tsx` - Folder tree navigation
  - `DetailPanel.tsx` - File/folder detail panel (right sidebar)
  - `TagPanel.tsx` - Side panel for tag management
  - `SidePanel.tsx` - Collapsible side container
  - `SettingsModal.tsx` - Settings dialog
- `components/ui/` - Shadcn/ui components

### Backend (`src-tauri/`)

- `src/lib.rs` - Tauri app entry, command registration
- `src/commands.rs` - Tauri command handlers
- `src/db.rs` - SQLite database operations (files, tags, settings, index_paths, folders)
- `src/indexer.rs` - File system scanner for indexing supported formats

### Data Model

- Files are stored in original locations (not copied to DB)
- SQLite stores metadata: id, path, name, ext, size, width, height, created_at, modified_at, folder_id
- Folders: hierarchical structure with parent_id
- Tags with color support, many-to-many relationship with files
- Settings stored as key-value pairs

### Supported File Formats

`jpg`, `jpeg`, `png`, `gif`, `svg`, `webp`, `bmp`, `ico`, `tiff`, `tif`, `psd`, `ai`, `eps`, `raw`, `cr2`, `nef`, `arw`, `dng`, `heic`, `heif`

## MCP Tools

- **Context7**: Available for this project. Use `use context7` in prompts to get relevant documentation for libraries/frameworks.

## Tauri IPC

Frontend calls Rust via `invoke()`:

### File Commands
- `import_file` - Import single file
- `import_image_from_base64` - Import base64 image
- `get_all_files` - Get all files
- `search_files` - Search files by query
- `get_files_in_folder` - Get files in specific folder
- `delete_file` - Delete single file
- `delete_files` - Delete multiple files
- `move_file` - Move file to folder
- `add_tag_to_file` - Add tag to file
- `remove_tag_from_file` - Remove tag from file

### Tag Commands
- `get_all_tags` - Get all tags
- `create_tag` - Create new tag
- `update_tag` - Update tag name/color
- `delete_tag` - Delete tag

### Folder Commands
- `get_folder_tree` - Get folder tree structure
- `create_folder` - Create new folder
- `rename_folder` - Rename folder
- `delete_folder` - Delete folder
- `init_default_folder` - Initialize default folder

### Settings Commands
- `get_setting` - Get setting value
- `set_setting` - Set setting value
- `get_index_paths` - Get indexed paths
- `add_index_path` - Add path to index
- `remove_index_path` - Remove path from index
- `reindex_all` - Reindex all files
- `scan_folders` - Scan folders for new files

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
The project uses `@/` as an alias for `src/`. Use `@/stores/xxx` instead of `../stores/xxx` or `./folderStore` for imports.

**Rule**: Always prefer `@/` alias over any relative paths (`../`, `./`) for imports. This makes code more maintainable and easier to refactor.

## Debugging Tips

### 调试技巧
- 用 `console.log` 检查状态值，而不是反复尝试点击 UI
- React 问题优先检查组件渲染逻辑和状态流
- 排查问题时优先检查数据流、状态更新、条件判断，再考虑 UI 交互问题

### 常见问题
- 修改代码时，确保相关依赖完整导入
- 多个状态同时存在时，明确优先级逻辑（如 DetailPanel 中文件和文件夹的显示优先级）
- 切换视图时确保相关联的状态保持一致（如切换文件夹时清除文件选中状态）
