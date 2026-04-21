# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the React + TypeScript desktop UI, with feature components in `src/components/`, Zustand stores in `src/stores/`, and shared helpers in `src/lib/` and `src/utils/`. `src-tauri/` contains the Rust backend, Tauri config, database and indexing logic. `extensions/shiguang-collector/` holds the browser extension used for image collection. `website/` contains the Rspress documentation site. Generated or build output such as `dist/`, `src-tauri/target/`, and `website/doc_build/` should not be committed.

## Build, Test, and Development Commands
Use `pnpm` because the repo is checked in with `pnpm-lock.yaml`.

- `pnpm dev`: start the Vite frontend for UI work.
- `pnpm tauri dev`: run the full desktop app with the Rust backend.
- `pnpm build`: type-check and build the frontend into `dist/`.
- `pnpm lint`: run Oxlint for the frontend.
- `pnpm lint:fix`: auto-fix frontend issues supported by Oxlint.
- `pnpm fmt`: format frontend files with oxfmt.
- `pnpm fmt:check`: check frontend formatting with oxfmt.
- `pnpm docs:dev`: serve the docs site from `website/`.
- `pnpm docs:build`: build the docs site for deployment.

For Rust-only validation, run `cargo test` or `cargo check` from `src-tauri/`.

If Codex is launching Tauri on Windows, set these env vars first and prefer running `pnpm tauri dev` in the current shell:

```powershell
$env:APPDATA = Join-Path $env:USERPROFILE 'AppData\\Roaming'
$env:LOCALAPPDATA = Join-Path $env:USERPROFILE 'AppData\\Local'
$env:HOME = $env:USERPROFILE
$windowsDir = if ($env:windir) { $env:windir } elseif ($env:SystemRoot) { $env:SystemRoot } else { Join-Path $env:SystemDrive 'Windows' }
$env:SystemRoot = $windowsDir
$env:windir = $windowsDir
$env:ComSpec = Join-Path $windowsDir 'System32\\cmd.exe'
pnpm tauri dev
```

Keep the dev server on `127.0.0.1`; do not switch it back to `localhost`.

Before restarting anything, check `127.0.0.1:1420` and `:9223`:

- If `1420` is already owned by this repo's Vite process, reuse it and do not start `pnpm dev` again.
- If `9223` is already listening, try connecting MCP first.
- Restart only when needed, and stop stale repo-scoped `shiguang.exe`, `cargo`, `rustc`, and Vite processes before relaunching.

If a background launch is unavoidable, reuse the same env setup in the current shell and launch `pnpm.cmd` directly:

```powershell
Start-Process -FilePath (Get-Command 'pnpm.cmd').Source -ArgumentList 'tauri','dev' -WorkingDirectory (Get-Location).Path
```

Do not wrap the env setup inside another `powershell -Command "..."` string; that can break the `$env:` assignments before the child shell runs.

Treat startup as successful only when `127.0.0.1:1420` is listening, `shiguang.exe` is running for this repo, `9223` is listening, and Tauri MCP can report the `main` window.

## Coding Style & Naming Conventions
Follow the existing code style in each layer: TypeScript files generally use 2-space indentation and double quotes in newer files; Rust uses `rustfmt` defaults with 4 spaces. Keep React components and Zustand stores in PascalCase file names such as `FileGrid.tsx` and `fileStore.ts`. Prefer descriptive function names and keep Tauri command logic in `src-tauri/src/commands.rs` or adjacent backend modules. Use Tailwind utility classes in JSX and keep shared class composition in helpers like `src/lib/utils.ts`. If a file grows too large, refactor it into smaller modules where appropriate.

## Engineering Principles
Prefer systematic thinking. Focus on the root cause of a problem rather than only addressing surface symptoms.

## Testing Guidelines
There is no dedicated frontend test runner configured yet. Before opening a PR, at minimum run `pnpm build` and validate the affected flow manually in `pnpm tauri dev`. For backend changes, add Rust unit tests where practical and run `cargo test` in `src-tauri/`. Name new Rust tests after the behavior they verify, for example `imports_images_from_drop_event`.

For desktop UI or interaction changes, do not stop at static analysis or build success. After implementing the change, verify the affected flow yourself through the Tauri MCP bridge: open the app, navigate to the changed screen, and confirm the actual rendered result with MCP inspection such as screenshot/DOM checks. If MCP verification is blocked, call that out explicitly before finishing.
For UI interaction bugs, do not rely only on MCP or other synthetic clicks. Verify the real user event path as early as possible, and when needed add targeted logs around low-level events such as `pointerdown`, `click`, and menu selection to confirm where the interaction stops.

## Commit & Pull Request Guidelines
Recent history uses short, imperative commit subjects in Chinese, for example `筛选` or `修改db存储路径`. Keep commit messages brief, focused, and scoped to one change. PRs should include a clear summary, manual verification steps, linked issues when applicable, and screenshots or short recordings for UI changes. If a change affects packaging, release behavior, or docs, mention that explicitly.
