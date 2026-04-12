---
name: tauri-memory-analysis
description: Diagnose memory growth in this Tauri app. Use for WebView2 image retention, FG-CLIP2 model memory, and MCP or socket startup failures.
---

# Tauri Memory Analysis

## Overview

Use this skill to separate frontend or WebView memory, Rust or model memory, and environment blockers before proposing fixes. Keep the analysis concrete: reproduce one flow, measure one layer at a time, and update `docs/memory-analysis.md`.

## Quick Start

1. Classify the symptom.
2. Stop early on environment blockers.
3. Run the matching playbook.
4. Update `docs/memory-analysis.md` with measurements, ownership, and next actions.

## Decision Tree

Sort the issue into one bucket before changing code:

- frontend or WebView2 growth: list scrolling, preview mode, image thumbnails, blob URLs, data URLs, JS heap
- Rust or model growth: natural-language search, visual index rebuild, auto-vectorize on import, ONNX session lifetime
- environment blocker: Vite does not bind, MCP bridge does not start, local HTTP server fails, socket creation returns `10106`

Do not mix buckets in one conclusion.

## Rules

### Stop on broken local networking

If any of these appear, do not claim app-level memory conclusions from broken runs:

- `WinError 10106`
- `listen UNKNOWN`
- MCP bridge WebSocket startup failure
- local HTTP bind failure on `127.0.0.1`

These break `vite`, MCP, and the app's own local HTTP server in this repo. Report the blocker and switch to code inspection or standalone model probing until the environment is healthy again.

### Measure total app memory, not just Rust memory

For app-level image flows, treat total memory as:

- `shiguang.exe`
- related `msedgewebview2.exe` processes

Do not look at `shiguang.exe` alone.

### Keep model recommendations narrow

Current product stance in this repo:

- keep `split-text`
- keep the image runtime on the current fp32 path
- use model work to justify `VisualModelRuntime` idle unload, not new runtime options

## Playbooks

### UI or WebView playbook

When the UI is available, gather:

- total private memory across app and WebView2 processes
- `performance.memory.usedJSHeapSize`
- count of `blob:` image sources
- count of `data:` image sources

Use the fixed flow from `references/measurement-playbooks.md`.

Read `references/repo-hotspots.md` before blaming components. The current highest-value frontend suspects are thumbnail transport, blob URL cleanup, image source caching, and preview-state retention.

### Rust or model playbook

Probe the standalone verifier in `D:\code\vl-embedding-test` before blaming the app runtime.

Current recommendation:

- keep split-text mandatory
- compare against full-text only to show why it must stay disabled
- focus app changes on session lifetime and unload policy

Use the baselines and commands in `references/measurement-playbooks.md`.

### Environment playbook

If sockets fail, verify that the problem is not app-specific. In this repo, broken local sockets also break:

- Vite dev server
- MCP bridge
- the app's local HTTP server
- any MCP-driven interaction workflow

Read `references/measurement-playbooks.md` for the blocker checklist.

## Repo Anchors

Load `references/repo-hotspots.md` when you need code anchors for:

- frontend image hotspots
- FG-CLIP2 trigger paths
- runtime lifetime functions
- local networking and startup dependencies

## Output Standard

Update `docs/memory-analysis.md` with:

- exact reproduction path
- measured numbers
- which layer owns the memory
- file and function anchors
- what is proven vs inferred
- next actions ordered by likely yield

Keep low-signal advice out of the document. Prefer repo-specific conclusions over generic optimization lists.
