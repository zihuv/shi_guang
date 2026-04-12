# Shiguang Tauri App Memory Analysis

## Purpose

This document consolidates the current memory-usage analysis for the Tauri desktop app so follow-up work can proceed from one place.

Scope of this round:

- Analyze runtime memory behavior without changing business logic.
- Identify the main memory owners and the most likely high-impact code paths.
- Audit where `base64`, `data:` URLs, and `blob:` URLs are produced and retained.
- Leave a concrete, prioritized follow-up plan.

Non-goals of this round:

- No behavior changes.
- No memory optimizations implemented yet.
- No claims that every issue is proven root cause; some are high-confidence hypotheses backed by runtime data and code inspection.

## Environment And Test Context

- Repo: `D:\code\shiguang\shiguang`
- Date: `2026-04-12`
- OS: Windows
- App mode: `pnpm tauri dev`
- Frontend URL: `http://localhost:1420/`
- Tauri bridge port observed during run: `9223`
- App process: `shiguang.exe`
- Frontend runtime process family: `msedgewebview2.exe`

Important context:

- Memory observed in `shiguang.exe` alone underestimates total app memory.
- A large portion of runtime memory is held by WebView2 child processes, especially renderer/GPU-related processes.

## Reproduction Flow Used

The following flow was used during analysis:

1. Launch the app with `pnpm tauri dev`.
2. Record a baseline on the small `test` folder.
3. Switch to `全部文件`.
4. Record the first page memory state.
5. Scroll down several screens to trigger lazy loading and thumbnail cache growth.
6. Open image preview by double-clicking an item.
7. Navigate forward several images inside preview.
8. Exit preview and observe whether memory falls back.
9. Wait idle and manually trigger `window.gc()` to distinguish JS heap from native/image memory retention.

## Process Topology

Observed process tree during runtime:

- `shiguang.exe`
- parent `msedgewebview2.exe`
- child `msedgewebview2.exe` renderer
- child `msedgewebview2.exe` GPU process
- child `msedgewebview2.exe` network/storage utility processes

Practical implication:

- UI image-heavy flows should be treated as WebView memory problems first.
- Rust-side memory still matters, but current browsing/preview spikes are dominated by the frontend/WebView path.

## Measured Snapshots

Numbers below were taken from the running process set: `shiguang.exe` plus related `msedgewebview2.exe` processes.

### Snapshot A: Small Folder Baseline (`test`, 7 files)

- Total working set: about `539.61 MB`
- Total private memory: about `324.36 MB`
- `shiguang.exe` private memory: about `19.11 MB`
- Frontend `usedJSHeapSize`: about `19.53 MB`
- DOM images observed: `8`
- `data:` images observed: `7`
- `blob:` images observed: `0`

### Snapshot B: `全部文件`, first page (`100` files loaded in store)

- Total private memory: about `343.95 MB`
- `shiguang.exe` private memory: about `29.64 MB`
- Frontend `usedJSHeapSize`: about `27.62 MB`
- DOM images observed: `20`
- `blob:` images observed: `10`
- `data:` images observed: `9`

### Snapshot C: After scrolling 4 screens in `全部文件`

- Total private memory: about `434.02 MB`
- `shiguang.exe` private memory: about `34.57 MB`
- Frontend `usedJSHeapSize`: about `61.02 MB`
- Frontend `totalJSHeapSize`: about `103.68 MB`
- DOM images observed: `29`
- `data:` images observed: `28`
- `blob:` images observed: `0`

Interpretation:

- This is the clearest memory growth event in the list view.
- DOM image count increased modestly, but JS heap increased much more.
- That pattern fits retained strings, decoded images, and cache growth better than “DOM count only”.

### Snapshot D: Enter image preview

- `previewMode`: `true`
- `previewFiles`: `100`
- `previewIndex`: `85`
- Total private memory: about `439.47 MB`
- `shiguang.exe` private memory: about `51.49 MB`
- DOM images observed: `103`
- `blob:` images observed: `101`
- `data:` images observed: `1`
- Frontend `usedJSHeapSize`: about `22.50 MB`

Interpretation:

- Entering preview causes the page to hold a large number of image elements and blob-backed sources.
- The preview store also holds the entire current file set, not just the current file id/index.

### Snapshot E: Navigate 5 images forward inside preview

- `previewMode`: `true`
- `previewFiles`: `100`
- `previewIndex`: `90`
- Total private memory: about `410.57 MB` to `439.47 MB` range depending on process timing
- DOM images observed: still about `103`
- `blob:` images observed: still about `101`

Interpretation:

- Navigation did not reduce the retained blob-backed image count.
- That suggests preview is not a “single current image” model; the surrounding strip/state keeps many image objects alive.

### Snapshot F: Exit preview

- `previewMode`: `false`
- `previewFiles`: `0`
- Total private memory: about `449.29 MB`
- DOM images observed: `21`
- `blob:` images observed: `10`
- `data:` images observed: `10`
- Frontend `usedJSHeapSize`: about `30.15 MB`

Interpretation:

- Memory did not return close to the earlier first-page state.
- Some image-related resources were released, but not enough to restore the prior steady state.

### Snapshot G: Idle after preview exit

- Total private memory after ~10s idle: about `438.66 MB`
- Still materially above Snapshot B.

### Snapshot H: Manual `window.gc()`

- Before GC `usedJSHeapSize`: about `30.51 MB`
- After GC `usedJSHeapSize`: about `30.51 MB`

Interpretation:

- The retained memory is not explained by “JS garbage not collected yet”.
- High-confidence possibilities:
  - still-referenced JS objects
  - still-live `blob:` URLs
  - decoded/native image memory held by WebView2

## Main Findings

### 1. The biggest current memory consumer is the WebView path, not `shiguang.exe`

Evidence:

- `shiguang.exe` private memory remained relatively modest.
- WebView2 renderer/GPU processes accounted for the largest memory slices during image-heavy interactions.

Implication:

- The highest-value optimization targets are image source strategy, preview lifetime, thumbnail transport format, and frontend cache policy.

### 2. List scrolling causes a large heap increase

Evidence:

- `usedJSHeapSize` rose from about `27.6 MB` to about `61.0 MB` after several scroll steps.

Implication:

- Lazy-loading currently reduces initial load cost, but memory still accumulates during browsing.
- The list path likely holds onto image payloads too aggressively.

### 3. Preview mode materially increases retained image objects

Evidence:

- Entering preview produced about `103` image elements and about `101` blob-backed sources.
- Exiting preview did not return the app to the earlier first-page memory level.

Implication:

- Preview is a likely top-priority optimization area.

### 4. The app currently mixes `blob:` and `data:` display sources

Observed during runtime:

- Small-folder baseline was mostly `data:`
- Full-list first page mixed `blob:` and `data:`
- Scrolling skewed strongly toward `data:`
- Preview skewed strongly toward `blob:`

Implication:

- Mixed transport/display strategies increase debugging complexity and likely increase memory overhead.
- For display paths, `data:` is usually the more memory-expensive choice because it creates large base64 strings in JS/DOM.

### 5. `base64` is not the long-term storage format for clipboard import

This concern was checked directly in code.

Frontend clipboard path:

- [src/hooks/useClipboardImport.ts](../src/hooks/useClipboardImport.ts) reads pasted image blobs via `FileReader.readAsDataURL`, strips the prefix, and sends only the base64 payload.

Relevant lines:

- `reader.readAsDataURL(blob)` in `src/hooks/useClipboardImport.ts:33`
- `resolve((reader.result as string).split(\",\")[1])` in `src/hooks/useClipboardImport.ts:31`

Frontend drag/drop fallback path:

- When dropped items do not provide filesystem paths, the app also falls back to base64 transport.
- See `fileToBase64` in `src/App.tsx:341` and `importImagesFromBase64` usage in `src/App.tsx:416`.

Backend import path:

- [src-tauri/src/commands/imports.rs](../src-tauri/src/commands/imports.rs) decodes base64 immediately into raw bytes.
- It then passes those bytes into the normal file import path and writes a real file.

Relevant lines:

- `bytes: engine.decode(base64_data)...` in `src-tauri/src/commands/imports.rs:223`
- `import_bytes_with_database(...)` in `src-tauri/src/commands/imports.rs:220`
- `save_and_prepare_imported_file(&request.bytes, &dest_path, ...)` in `src-tauri/src/commands/imports.rs:140`

Conclusion:

- Clipboard import and drag/drop fallback use base64 only as a transient transport format between frontend and backend.
- Imported images are persisted as normal files, not stored as base64 blobs in the database.

This matches the desired architecture:

- Temporary transfer format: acceptable
- Long-term persisted representation: should be normal binary files

## Code Path Audit

### A. General file image source generation

File: [src/utils/index.ts](../src/utils/index.ts)

Relevant lines:

- `getFileSrc` at `290-303`

Behavior:

- Reads the file into memory with `readFile(path)`.
- Creates a `Blob`.
- Returns `URL.createObjectURL(blob)`.

Implication:

- Any caller of `getFileSrc` is reading the full file payload into frontend memory.
- This is expensive for image display when a lighter path could be used.

### B. Thumbnail transport to frontend

File: [src/utils/index.ts](../src/utils/index.ts)

Relevant lines:

- `getThumbnailImageSrc` at `537-557`

Behavior:

- Calls backend `getThumbnailDataBase64`.
- Converts the returned base64 into a `data:image/jpeg;base64,...` string.

Backend file: [src-tauri/src/storage.rs](../src-tauri/src/storage.rs)

Relevant lines:

- `get_or_create_thumbnail_base64` at `213-226`

Behavior:

- Reads the generated thumbnail file from disk.
- Base64-encodes it.
- Returns the encoded string to the frontend.

Implication:

- Thumbnail display currently pays a base64 string cost that is avoidable.
- This is a likely direct contributor to list-view JS heap growth.

### C. File grid image cache

File: [src/components/file-grid/fileGridCards.tsx](../src/components/file-grid/fileGridCards.tsx)

Relevant lines:

- `IMAGE_SRC_CACHE_LIMIT = 300` at `32`
- global `imageSrcCache` at `67`
- cache cleanup at `80-103`

Behavior:

- Keeps up to `300` cached image sources alive.
- Revokes old `blob:` URLs only when they are evicted from the cache.

Implication:

- Large cache size increases steady-state memory after browsing.
- If many entries are `data:` strings, eviction does not benefit from `URL.revokeObjectURL` anyway.

### D. Preview store lifetime

File: [src/stores/previewStore.ts](../src/stores/previewStore.ts)

Relevant lines:

- `previewFiles: FileItem[]` at `7`
- `openPreview(..., files)` at `23-28`

Behavior:

- Stores the whole current file list in Zustand.

Implication:

- Preview state is heavier than necessary.
- It is good for navigation convenience, but it increases retained app state and makes image strip behavior easier to over-retain.

### E. Main preview image cleanup

File: [src/components/ImagePreview.tsx](../src/components/ImagePreview.tsx)

Relevant lines:

- `getFileSrc(currentFile.path)` at `186`
- cleanup with `URL.revokeObjectURL(imageSrc)` at `201-207`

Behavior:

- The main preview image does attempt to revoke its `blob:` URL on source change/unmount.

Implication:

- The main preview image itself is not the strongest leak suspect.
- The more likely issue is the thumbnail strip and surrounding retained image set.

### F. Preview thumbnail strip image loading

File: [src/components/image-preview/PreviewHelpers.tsx](../src/components/image-preview/PreviewHelpers.tsx)

Relevant lines:

- `getFileSrc(file.path)` / `getVideoThumbnailSrc(file.path)` at `20`
- no explicit `URL.revokeObjectURL` cleanup for `src`

Behavior:

- Thumbnail items create image sources.
- The effect cleanup only flips `mounted = false`; it does not revoke blob URLs for image thumbnails.

Implication:

- This is a high-confidence hotspot.
- It aligns with runtime observation that preview mode holds about `101` blob-backed images.

## Why `data:` And `blob:` Mixing Is A Problem

This project currently uses both:

- `blob:` for full file/object URL display
- `data:` for thumbnail display and some browser-decoded image paths

Why this is problematic:

- `data:` creates large JS strings and inflates payload size.
- `blob:` requires explicit lifecycle management.
- Mixed strategies make cache policy harder to reason about.
- Mixed strategies make it harder to interpret heap snapshots and process memory changes.

Recommended target principle:

- For UI display paths, avoid `data:` when a file path or `blob:` URL can be used.
- Use `data:` only when a downstream API specifically requires it, such as AI requests or short-lived transport.

## Prioritized Follow-Up Plan

This section is intended to be executable as a work queue.

### Priority 0: Keep runtime measurement comparable

Before changing behavior:

1. Re-run the same scenario in this document and record the same metrics.
2. Continue measuring both:
   - total app process set memory
   - frontend `performance.memory`

### Priority 1: Remove `data:` thumbnails from display path

Goal:

- Replace thumbnail display transport that currently uses base64 strings.

Best first options to evaluate:

1. Use an on-disk thumbnail path returned from backend.
2. Or return a file URL / object URL without round-tripping through base64 strings.

Why first:

- This should directly reduce JS heap pressure in list browsing.

Code areas:

- `src/utils/index.ts:537-557`
- `src/services/tauri/indexing.ts:35-40`
- `src-tauri/src/storage.rs:213-226`

### Priority 2: Fix preview thumbnail strip object URL lifecycle

Goal:

- Ensure every `blob:` created for preview-strip thumbnails is revoked when it is no longer needed.

Why first:

- Runtime data strongly suggests preview retains many blob URLs.

Code area:

- `src/components/image-preview/PreviewHelpers.tsx:20-30`

### Priority 3: Reduce or redesign file-grid image cache

Goal:

- Lower steady-state memory after browsing.

Options:

1. Reduce `IMAGE_SRC_CACHE_LIMIT`.
2. Cache only lightweight thumbnail paths instead of loaded payload-backed sources.
3. Separate cache policy for list mode and preview mode.

Code area:

- `src/components/file-grid/fileGridCards.tsx:32`
- `src/components/file-grid/fileGridCards.tsx:67-103`

### Priority 4: Slim preview state

Goal:

- Avoid storing the full `FileItem[]` in preview state if only ids/indexes are needed.

Options:

1. Store only current file id plus a lightweight ordered id list.
2. Resolve metadata lazily from the main library store.

Code area:

- `src/stores/previewStore.ts:4-35`

### Priority 5: Avoid reading full file bytes for ordinary image display

Goal:

- Stop using `readFile -> Blob -> object URL` for cases where the UI only needs a display source.

Why:

- This path moves file payloads into frontend memory unnecessarily.

Code area:

- `src/utils/index.ts:290-303`

### Priority 6: Audit special `data:` producers

These should remain temporary-only unless there is a hard requirement:

- clipboard import
- drag/drop fallback import
- AI image data URL preparation
- browser-decoded canvas conversion

Code areas:

- `src/hooks/useClipboardImport.ts`
- `src/App.tsx:341-355`
- `src-tauri/src/commands/ai.rs:284-309`
- `src/utils/index.ts:463-527`

## Validation Checklist For Future Optimization Work

For each optimization attempt, repeat this exact checklist:

1. Baseline on `test` folder.
2. Switch to `全部文件`.
3. Measure first page.
4. Scroll 4 screens.
5. Open preview.
6. Navigate 5 images.
7. Exit preview.
8. Wait idle 10 seconds.
9. Compare:
   - total private memory of app + WebView processes
   - `performance.memory.usedJSHeapSize`
   - count of `blob:` image sources
   - count of `data:` image sources

Success criteria should be:

- lower peak private memory during list scroll
- lower retained memory after exiting preview
- fewer retained `blob:` image sources in preview/list
- little or no `data:` usage in normal display paths

## Short Answers To Questions Raised During Analysis

### Is clipboard import probably the source of base64?

Yes, clipboard paste is one source of base64 transport.

### Is drag/drop also a source of base64?

Yes, when dropped items do not yield filesystem paths, the fallback path also converts to base64 before sending to backend.

### Should clipboard-imported base64 be converted to normal image data rather than stored as base64?

Yes, and the current backend already does that.

The important distinction is:

- temporary transport as base64: acceptable
- persistent storage as base64: not desirable

Current implementation already decodes to bytes and persists a normal file.

### Should display paths become more consistent?

Yes.

The preferred consistency target is:

- UI display paths should avoid base64 strings
- `data:` URLs should be limited to short-lived API transport or transformation steps

## Model Loading Analysis

This section separates model-runtime memory from the frontend/WebView image-memory problem.

Reason for separating them:

- the list/preview spikes measured earlier are dominated by WebView2
- the FG-CLIP2 runtime still adds meaningful Rust-side memory when text search or visual indexing loads an ONNX session
- these two problems need different fixes

### What Was Measured

Model-runtime probing was done against the export repo:

- Repo: `D:\code\vl-embedding-test`
- Binary: `rust-onnx-verify\target\release\fgclip2-onnx-verify.exe`
- Image sample: `images/browser_20260409_124726_272943500.jpg`
- Machine: same Windows machine as the app analysis

The verifier was used because it runs the same FG-CLIP2 runtime artifacts without frontend noise.

Important alignment with the app:

- the application currently requires split-text models and rejects full-text wrappers
- default application model layout is split-text text ONNX + external token embedding + fp32 image ONNX
- the application does not currently expose `FGCLIP2_RUNTIME_VARIANT`; it uses explicit model paths and env overrides instead
- this document intentionally excludes the `lowmem` path because it is not a desired product configuration

Relevant code:

- `src-tauri/src/ml/model_manager.rs`
- `src-tauri/src/ml/mod.rs`
- `src-tauri/src/ml/fgclip2.rs`

### Current Machine Probe Results

| Probe | Variant | Peak Working Set | Peak Private Memory | Main Timing Notes |
| --- | --- | ---: | ---: | --- |
| text-only | split-text | `368.9 MiB` | `356.4 MiB` | ONNX load `443.94 ms`, text inference `42.66 ms` |
| text-only | baseline full-text | `1209.7 MiB` | `1913.4 MiB` | ONNX load `1.65 s`, text inference `39.02 ms` |
| image-only `1024` patches | fp32 image | `525.0 MiB` | `551.7 MiB` | ONNX load `540.09 ms`, image inference `657.23 ms` |
| end-to-end text + image `1024` | split-text + fp32 image | `521.5 MiB` | `548.2 MiB` | text load `458.48 ms`, image load `511.45 ms`, image inference `653.48 ms` |

Interpretation:

- split-text is not a minor improvement; on this machine it cuts text-only private memory from about `1913 MiB` to about `356 MiB`
- once full-text is removed, the dominant model-side resident cost becomes the image session, not the text path

Practical conclusion:

- if the application is already on split-text, the next model-side work should focus on session lifetime and runtime behavior instead of adding new runtime variants
- if the application ever regresses to full-text, memory will jump by a very large amount

### What The Application Already Does Correctly

The current Rust runtime already avoids the worst-case “text + image sessions both resident all the time” design:

- `VisualModelRuntime` stores one `FgClip2Model` instance and reloads only when the model root changes
- `ensure_text_session()` clears `image_session` before loading text
- `ensure_image_session()` clears `text_session` before loading image
- `model_manager.rs` requires split-text text ONNX via `require_split_text_model_file`

Relevant code anchors:

- `src-tauri/src/ml/mod.rs:16`
- `src-tauri/src/ml/mod.rs:36`
- `src-tauri/src/ml/fgclip2.rs:153`
- `src-tauri/src/ml/fgclip2.rs:164`
- `src-tauri/src/ml/model_manager.rs:337`
- `src-tauri/src/ml/model_manager.rs:407`
- `src-tauri/src/ml/model_manager.rs:502`

This means:

- the application is already protected from the most obvious 1.6-1.9 GiB mistake
- the remaining problem is session lifetime and runtime profile choice, not “both models always loaded together”

### What The Application Still Lacks

#### 1. No idle unload policy

Once a session is loaded, it stays resident until:

- the other session type is needed
- the model root changes
- the process exits

So:

- one natural-language search can keep the text session warm for the rest of the app lifetime
- one visual-index task can keep the image session warm after the task has already completed

#### 2. Model loading can be triggered by ordinary user actions

Text-session load trigger:

- natural-language file filtering calls `model.encode_text(...)`

Image-session load triggers:

- visual index rebuild
- single-file reindex
- auto-vectorize on import when enabled

Relevant code anchors:

- `src-tauri/src/commands/files.rs:285`
- `src-tauri/src/commands/files.rs:330`
- `src-tauri/src/commands/ai.rs:689`
- `src-tauri/src/commands/ai.rs:704`
- `src-tauri/src/commands/ai.rs:706`
- `src-tauri/src/commands/ai.rs:1186`
- `src-tauri/src/commands/post_import.rs:58`

This is why the user can perceive “just loaded the model and memory went up” even when the frontend is idle.

## Model-Layer Follow-Up

These are changes to the exported model/runtime packaging, not to the UI.

### Priority M1: Keep split-text mandatory

Do not relax the current application rule that rejects full-text text ONNX for production use.

Reason:

- current-machine probe: `~356 MiB` private for split-text text-only
- current-machine probe: `~1913 MiB` private for baseline full-text text-only

### Priority M2: Benchmark ORT thread count for memory-sensitive machines

Current app code hardcodes:

- `with_intra_threads(4)`

This is a throughput-oriented default, not a memory-aware one.

Action:

- benchmark `1`, `2`, and `4` threads on the target machines
- record whether lower thread counts reduce peak private memory or allocator overhead enough to matter

Relevant code anchor:

- `src-tauri/src/ml/fgclip2.rs:181`

## App-Layer Follow-Up For Model Memory

These are application/runtime-lifecycle tasks, separate from frontend image cleanup.

### Priority A1: Add idle unload after search/index inactivity

Recommended behavior:

- keep text session warm only briefly after a search
- keep image session warm only while import/index work is active
- use `60` seconds as the initial idle timeout for both text and image sessions
- sweep on a coarse interval such as every `10-15` seconds instead of on every request
- call `VisualModelRuntime::clear()` only when there is no active visual-index/import work and the last-use timestamp is older than the timeout

Reason:

- without this, model memory becomes sticky even after the triggering workflow has ended
- current-machine cold-start cost is low enough that a `60` second timeout is a practical starting point:
  - split-text text session load was about `444-458 ms`
  - fp32 image session load was about `511-540 ms`
  - baseline full-text text load was about `1.65 s`, which is another reason not to regress from split-text

Suggested first implementation:

1. record `last_used_at` on every `encode_text`, `encode_image_path`, and `encode_image_bytes`
2. record whether a visual-index task is currently active
3. run a background sweeper every `15` seconds
4. if no task is active and `now - last_used_at >= 60s`, call `VisualModelRuntime::clear()`
5. optionally preload the text session on search-box focus later if the first-query cold start still feels visible

### Priority A2: Keep image indexing isolated from heavy UI memory states

When image indexing is active:

- avoid overlapping it with the heaviest preview/list browsing paths during benchmarks
- keep indexing batch size at `1` on CPU unless local throughput data proves a higher batch is worth the extra memory

Reason:

- model-side image memory is already about `0.5 GiB`
- frontend list/preview memory can independently push WebView2 much higher

## Current Environment Blockers

These do not change the analysis above, but they matter for reproducing app-side interactive measurements in this exact environment.

Observed during this round:

- `pnpm` fails in non-interactive child-process launches with `TypeError [ERR_INVALID_ARG_TYPE]` inside `@pnpm/npm-conf`
- `vite` failed to bind `127.0.0.1:1420` and `0.0.0.0:1420` with `listen UNKNOWN`
- running the app with the added `memory-diagnostics` feature panicked because a global tracing subscriber had already been set
- direct `cargo run` also logged `tauri-plugin-mcp-bridge` WebSocket startup failure `os error 10106`, so MCP-driven interaction could not be used in this environment during this round

Implication:

- the model-runtime numbers above are solid because they were taken from the standalone verifier
- app-side interactive model-loading measurements should be retried after the local dev-tooling path is stable again

## Current Overall Assessment

The app has two distinct memory fronts:

1. frontend/WebView image-lifecycle pressure
2. Rust-side FG-CLIP2 runtime pressure when search or visual indexing loads a model session

Right now the larger and more persistent product problem is still the frontend/WebView path, but the model path is large enough to matter:

- split-text text search adds roughly `356 MiB` private on this machine
- fp32 image encoding adds roughly `552 MiB` private on this machine

If follow-up work starts tomorrow with no additional context, the most likely highest-yield first tasks are:

1. replace base64 thumbnail display path
2. fix preview thumbnail strip blob cleanup
3. reduce or redesign image source caching
4. add model-session idle unload

## Implemented Follow-Up On 2026-04-12

The highest-yield fixes from this document have now been implemented in the app codebase.

### Frontend and WebView

- thumbnail display now prefers asset-backed file URLs instead of `data:` payloads
- file-grid cards no longer fall back to the original full-resolution image when a thumbnail is missing
- file-grid image cache limit was reduced further to keep fewer decoded sources resident
- offscreen file cards clear their current image source instead of holding onto it while scrolled away
- adaptive mode now renders only visible items plus overscan instead of mounting the full page

Relevant code anchors:

- `src/utils/index.ts`
- `src/components/file-grid/fileGridCards.tsx`
- `src/components/file-grid/FileGridViewport.tsx`
- `src/components/FileGrid.tsx`

### Import pipeline

- imported backend-decodable images now generate thumbnails inside the existing post-import async pipeline
- when the async thumbnail task finishes, the backend emits `file-updated`
- frontend thumbnail consumers now subscribe to a lightweight per-file refresh signal so visible cards retry thumbnail loading after that event

Relevant code anchors:

- `src-tauri/src/commands/post_import.rs`
- `src/hooks/useTauriImportListeners.ts`
- `src/stores/thumbnailRefreshStore.ts`
- `src/components/file-grid/fileGridCards.tsx`

What is proven:

- adaptive mode previously rendered all cards and now virtualizes by visible range
- grid/adaptive/list cards previously retried with original images and now stop at thumbnails only
- import already had a unified async post-import entry point, and thumbnail generation now runs there

What is still inferred until runtime verification is restored:

- the exact reduction in total app private memory during `全部文件 -> 自适应` scrolling on this machine
- whether any remaining memory growth is dominated by WebView2 decode caches, other non-virtualized surfaces, or unrelated browser/runtime behavior

### Validation status

- `cargo test`: passed
- `node .\node_modules\typescript\bin\tsc`: passed

Interactive validation is still blocked in this environment:

- `tauri-mcp` CLI is not available on the current shell `PATH`
- MCP driver status currently reports `connected: false`
- `pnpm tauri dev` currently fails before app startup in this shell with `TypeError [ERR_INVALID_ARG_TYPE]` inside `@pnpm/npm-conf`

So the code changes above are verified by static/build checks, but not yet by a live MCP-driven UI pass on this machine.
