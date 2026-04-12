# Measurement Playbooks

## UI Or WebView Flow

Use this when the symptom is scrolling, preview, thumbnail loading, or memory that appears in WebView2 processes.

Preconditions:

- local sockets are healthy
- the app can start normally
- MCP can connect if UI automation is needed

Collect all of these together:

- total private memory across `shiguang.exe` and related `msedgewebview2.exe`
- `performance.memory.usedJSHeapSize`
- count of `blob:` image sources
- count of `data:` image sources

Run this fixed flow:

1. baseline on `test`
2. switch to `全部文件`
3. measure the first page
4. scroll 4 screens
5. open preview
6. navigate 5 images
7. exit preview
8. wait idle 10 seconds

Success signals after a fix:

- lower peak private memory during scroll
- lower retained memory after exiting preview
- fewer retained `blob:` sources
- little or no `data:` in normal display paths

## Model Runtime Flow

Use this when the symptom follows natural-language search, visual index rebuild, or auto-vectorize on import.

Probe the standalone verifier first:

- repo: `D:\code\vl-embedding-test`
- binary: `rust-onnx-verify\target\release\fgclip2-onnx-verify.exe`

Reference commands:

```powershell
.\rust-onnx-verify\target\release\fgclip2-onnx-verify.exe run-text "山"
.\rust-onnx-verify\target\release\fgclip2-onnx-verify.exe run-batch 1024 .\images\browser_20260409_124726_272943500.jpg
.\rust-onnx-verify\target\release\fgclip2-onnx-verify.exe run .\images\browser_20260409_124726_272943500.jpg "山" 1024
```

Current machine baselines already observed in this repo:

- split-text text-only: about `356 MiB` private
- baseline full-text text-only: about `1913 MiB` private
- fp32 image-only `1024` patches: about `552 MiB` private
- split-text + fp32 image end-to-end: about `548 MiB` private

Cold-start timings already observed:

- split-text text session load: about `444-458 ms`
- fp32 image session load: about `511-540 ms`
- baseline full-text text load: about `1.65 s`

Interpretation:

- keep `split-text`
- keep the image runtime on the current fp32 path
- use these timings to justify a `60` second idle unload starting point

## Idle Unload Heuristic

Initial implementation target:

1. record `last_used_at` on `encode_text`, `encode_image_path`, and `encode_image_bytes`
2. record whether visual indexing or import-side vectorization is active
3. run a sweeper every `15` seconds
4. if no relevant work is active and the runtime has been idle for `60` seconds, call `VisualModelRuntime::clear()`

Use app-side measurement after the environment is healthy to validate:

- memory drops after the timeout
- next search cold start is acceptable
- next index task cold start is acceptable

## Environment Blocker Checklist

Stop app-level conclusions if you see any of these:

- `WinError 10106`
- `listen UNKNOWN`
- MCP bridge WebSocket bind failure
- any failure to create a local socket in Node, Python, or .NET

In this repo those failures block all of:

- Vite dev server
- MCP bridge on the Tauri app
- the local HTTP server inside the app

When this happens, switch to:

- code inspection
- standalone model probing
- documenting the blocker in `docs/memory-analysis.md`
