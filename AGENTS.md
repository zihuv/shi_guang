# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the React + TypeScript desktop UI, with feature components in `src/components/`, Zustand stores in `src/stores/`, and shared helpers in `src/lib/` and `src/utils/`. `electron/` contains the Electron main/preload process, IPC handlers, SQLite schema, indexing, import, thumbnail, collector, and AI metadata logic. `extensions/shiguang-collector/` holds the browser extension used for image collection. `website/` contains the Rspress documentation site. Generated or build output such as `out/`, `dist/`, `release/`, and `website/doc_build/` should not be committed.

## Build, Test, and Development Commands
Use npm because the Electron migration uses `package-lock.json` and native Electron dependencies.

- `npm run dev`: run electron-vite, start Vite on `127.0.0.1:1420`, and launch Electron.
- `npm run renderer:dev`: start only the Vite renderer dev server.
- `npm run build`: type-check and build renderer, main, and preload into `out/`.
- `npm run dist`: package the Electron app with electron-builder.
- `npm run lint`: run Oxlint for frontend and Electron code.
- `npm run lint:fix`: auto-fix issues supported by Oxlint.
- `npm run fmt`: format frontend and Electron files with oxfmt.
- `npm run fmt:check`: check formatting with oxfmt.
- `npm run docs:dev`: serve the docs site from `website/`.
- `npm run docs:build`: build the docs site for deployment.

After `npm install`, run `npx electron-builder install-app-deps` when Electron native modules such as `better-sqlite3` need to be rebuilt for the Electron ABI.

Keep the dev server on `127.0.0.1`; do not switch it back to `localhost`. Before restarting dev mode, check whether `127.0.0.1:1420` is already owned by this repo's Vite process and reuse it when possible. Stop stale repo-scoped Electron and Vite processes before relaunching.

## Coding Style & Naming Conventions
Follow the existing code style in each layer: TypeScript files generally use 2-space indentation and double quotes in newer files. Keep React components and Zustand stores in PascalCase file names such as `FileGrid.tsx` and `fileStore.ts`. Keep Electron IPC and desktop business logic in `electron/`, with preload exposing only whitelisted APIs. Use Tailwind utility classes in JSX and keep shared class composition in helpers like `src/lib/utils.ts`. If a file grows too large, refactor it into smaller modules where appropriate.

## Engineering Principles
Prefer systematic thinking. Focus on the root cause of a problem rather than only addressing surface symptoms.

## Testing Guidelines
There is no dedicated frontend test runner configured yet. Before opening a PR, at minimum run `npm run lint` and `npm run build`, then validate the affected flow manually in `npm run dev`. For backend changes, add focused TypeScript tests if a test harness is introduced; otherwise validate through the Electron app and document the manual path.

For desktop UI or interaction changes, do not stop at static analysis or build success. After implementing the change, open the Electron app, navigate to the changed screen, and confirm the actual rendered result. If direct desktop inspection is blocked, call that out explicitly before finishing.
For UI interaction bugs, do not rely only on MCP or other synthetic clicks. Verify the real user event path as early as possible, and when needed add targeted logs around low-level events such as `pointerdown`, `click`, and menu selection to confirm where the interaction stops.

## Commit & Pull Request Guidelines
Recent history uses short, imperative commit subjects in Chinese, for example `筛选` or `修改db存储路径`. Keep commit messages brief, focused, and scoped to one change. PRs should include a clear summary, manual verification steps, linked issues when applicable, and screenshots or short recordings for UI changes. If a change affects packaging, release behavior, or docs, mention that explicitly.
