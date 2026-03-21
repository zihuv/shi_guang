# CLAUDE.md

## Rules

- **Never commit code yourself** - Only generate fixes
- **Prefer third-party libraries** - Use shadcn/ui components
- **Always self-test** - Run `pnpm tauri dev` and verify UI interaction works, not just compilation
- **Third-party CLI failure** - Fix config first before creating custom alternatives

## Key Files

```
src/
├── stores/{fileStore,tagStore,folderStore,filterStore,settingsStore}.ts
├── components/{Header,FileGrid,FolderTree,DetailPanel,TagPanel,SidePanel,SettingsModal,ImagePreview,FilterPanel}.tsx
src-tauri/src/
├── lib.rs          # Tauri commands (register here!)
├── commands.rs     # Command handlers
├── db.rs           # SQLite
└── indexer.rs      # File scanner
```

## Tauri Commands

Frontend → Rust via `invoke()`.

**File**: `get_all_files`, `search_files`, `filter_files`, `get_files_in_folder`, `delete_file`, `delete_files`, `move_file`, `add_tag_to_file`, `remove_tag_from_file`

**Tag**: `get_all_tags`, `create_tag`, `update_tag`, `delete_tag`

**Folder**: `get_folder_tree`, `create_folder`, `rename_folder`, `delete_folder`

**Settings**: `get_setting`, `set_setting`, `get_index_paths`, `add_index_path`, `remove_index_path`, `reindex_all`, `scan_folders`

## Important

1. **New commands must be registered in `lib.rs`** in `invoke_handler` match block
2. **Windows paths** - Use `PathBuf` in Rust; normalize `\` and `/` when storing to DB
3. **Filter panel** - "全部文件" is a virtual system folder (cannot delete)

## Debugging

- `/shiguang-debug` - Check Rust logs, inspect webview
- `/shadcn` - Add shadcn/ui components
- Context7: `@context7/mcp` or `mcp__context7__*` tools
