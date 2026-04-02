# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the React + TypeScript desktop UI, with feature components in `src/components/`, Zustand stores in `src/stores/`, and shared helpers in `src/lib/` and `src/utils/`. `src-tauri/` contains the Rust backend, Tauri config, database and indexing logic. `extensions/shiguang-collector/` holds the browser extension used for image collection. `website/` contains the Rspress documentation site. Generated or build output such as `dist/`, `src-tauri/target/`, and `website/doc_build/` should not be committed.

## Build, Test, and Development Commands
Use `pnpm` because the repo is checked in with `pnpm-lock.yaml`.

- `pnpm dev`: start the Vite frontend for UI work.
- `pnpm tauri dev`: run the full desktop app with the Rust backend.
- `pnpm build`: type-check and build the frontend into `dist/`.
- `pnpm docs:dev`: serve the docs site from `website/`.
- `pnpm docs:build`: build the docs site for deployment.

For Rust-only validation, run `cargo test` or `cargo check` from `src-tauri/`.

## Coding Style & Naming Conventions
Follow the existing code style in each layer: TypeScript files generally use 2-space indentation and double quotes in newer files; Rust uses `rustfmt` defaults with 4 spaces. Keep React components and Zustand stores in PascalCase file names such as `FileGrid.tsx` and `fileStore.ts`. Prefer descriptive function names and keep Tauri command logic in `src-tauri/src/commands.rs` or adjacent backend modules. Use Tailwind utility classes in JSX and keep shared class composition in helpers like `src/lib/utils.ts`.

## Testing Guidelines
There is no dedicated frontend test runner configured yet. Before opening a PR, at minimum run `pnpm build` and validate the affected flow manually in `pnpm tauri dev`. For backend changes, add Rust unit tests where practical and run `cargo test` in `src-tauri/`. Name new Rust tests after the behavior they verify, for example `imports_images_from_drop_event`.

For desktop UI or interaction changes, do not stop at static analysis or build success. After implementing the change, verify the affected flow yourself through the Tauri MCP bridge: open the app, navigate to the changed screen, and confirm the actual rendered result with MCP inspection such as screenshot/DOM checks. If MCP verification is blocked, call that out explicitly before finishing.

## Commit & Pull Request Guidelines
Recent history uses short, imperative commit subjects in Chinese, for example `筛选` or `修改db存储路径`. Keep commit messages brief, focused, and scoped to one change. PRs should include a clear summary, manual verification steps, linked issues when applicable, and screenshots or short recordings for UI changes. If a change affects packaging, release behavior, or docs, mention that explicitly.
