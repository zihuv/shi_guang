# Repo Hotspots

## Frontend Or WebView Hotspots

Inspect these first when list or preview memory rises:

- `src/utils/index.ts`
  `getFileSrc` reads full file bytes and creates `blob:`
  `getThumbnailImageSrc` builds `data:` thumbnails from base64
- `src/components/file-grid/fileGridCards.tsx`
  global image source cache and `IMAGE_SRC_CACHE_LIMIT`
- `src/components/image-preview/PreviewHelpers.tsx`
  preview strip thumbnail loading and blob URL cleanup
- `src/components/ImagePreview.tsx`
  main preview image cleanup
- `src/stores/previewStore.ts`
  preview state lifetime and retained file lists

Default suspicion order:

1. `data:` thumbnails
2. unreleased `blob:` URLs
3. oversized image source cache
4. preview state retaining more than the current item needs

## Model Trigger Paths

Text-session trigger:

- `src-tauri/src/commands/files.rs`
  `filter_files` -> `model.encode_text(...)`

Image-session triggers:

- `src-tauri/src/commands/ai.rs`
  `reindex_visual_candidate` -> `model.encode_image_path(...)` or `model.encode_image_bytes(...)`
- `src-tauri/src/commands/ai.rs`
  `start_visual_index_task`
- `src-tauri/src/commands/post_import.rs`
  auto-vectorize on import

Runtime lifetime anchors:

- `src-tauri/src/ml/mod.rs`
  `VisualModelRuntime::get_or_load`
  `VisualModelRuntime::clear`
- `src-tauri/src/ml/fgclip2.rs`
  `ensure_text_session`
  `ensure_image_session`
  `with_intra_threads(4)`
- `src-tauri/src/ml/model_manager.rs`
  split-text enforcement and model path resolution

## Local Networking And Startup Dependencies

These paths all depend on local sockets working:

- `src-tauri/src/http_server.rs`
  app-local HTTP server on `127.0.0.1:7845`
- `src-tauri/src/lib.rs`
  debug-only MCP bridge plugin
- Vite dev server in `tauri.conf.json`

If Winsock or provider setup is broken, these symptoms can appear together:

- Vite fails to bind
- MCP driver session never connects
- app logs MCP WebSocket bind errors
- local HTTP server bind fails

Treat that as an environment blocker, not a product-memory conclusion.

## Documentation Target

Always write outcomes back to:

- `docs/memory-analysis.md`

Each update should include:

- reproduction path
- measured numbers
- owner layer: WebView, Rust or model, or environment
- proven findings
- inferred findings
- next actions in priority order
