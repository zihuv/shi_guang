# Repository Guidelines

## Project Structure

- `src/`: React + TypeScript desktop UI. Components live in `src/components/`, Zustand stores in `src/stores/`, helpers in `src/lib/` and `src/utils/`.
- `electron/`: Electron main/preload, IPC, SQLite, indexing, import, thumbnails, collector, and AI metadata logic.
- `extensions/shiguang-collector/`: browser extension for image collection.
- `website/`: Rspress documentation site.
- Do not commit generated output: `out/`, `dist/`, `release/`, `website/doc_build/`.

## Commands

Use npm; this Electron app relies on `package-lock.json` and native dependencies.

- `npm run dev`: start electron-vite, Vite on `127.0.0.1:1420`, and Electron.
- `npm run renderer:dev`: start only the renderer dev server.
- `npm run build`: type-check and build renderer, main, and preload into `out/`.
- `npm run dist`: package with electron-builder.
- `npm run lint` / `npm run lint:fix`: run or fix Oxlint.
- `npm run fmt` / `npm run fmt:check`: run or check oxfmt.
- `npm run docs:dev` / `npm run docs:build`: serve or build `website/`.

After `npm install`, run `npx electron-builder install-app-deps` if native Electron modules such as `better-sqlite3` need rebuilding.

## Electron Development

- Keep dev services on `127.0.0.1`; never switch them back to `localhost`.
- Before restarting dev mode, reuse an existing repo-owned `127.0.0.1:1420` Vite process when possible, and stop stale repo-scoped Electron/Vite processes before relaunching.
- Electron exposes Chrome DevTools Protocol on `127.0.0.1:9222`; Chrome MCP must target `http://127.0.0.1:9222`.
- Do not open or use standalone Chrome for Electron desktop UI verification. `127.0.0.1:1420` is only the renderer URL inside Electron; normal Chrome lacks preload, IPC, native window behavior, menus, dialogs, and drag-and-drop.
- If Chrome MCP shows `about:blank`, a normal Chrome tab, or cannot see the Electron renderer, treat MCP as misconfigured. Fix `browserUrl`/proxy setup or inspect the actual Electron window; do not navigate Chrome to `127.0.0.1:1420` as a workaround.
- If proxy env vars are present, local CDP traffic must bypass them with `NO_PROXY=127.0.0.1,localhost` or equivalent MCP-server env.

## Coding Style

- Follow local style: TypeScript, 2-space indentation, and double quotes in newer files.
- Use PascalCase for React component files. Use existing lower camelCase patterns for stores, hooks, helpers, and service modules.
- Keep Electron business logic in `electron/`; expose only whitelisted preload APIs.
- Use Tailwind utilities in JSX and shared class helpers such as `src/lib/utils.ts`.
- Refactor large files only when it helps the requested change.

## Engineering Principles

- Think from first principles: clarify the underlying user need, runtime constraints, and data flow before choosing an implementation.
- Prefer systematic root-cause fixes over surface patches.
- Respect existing architecture and local helper APIs before adding new abstractions.
- Keep changes scoped; do not rewrite unrelated code or generated files.

## Database Migrations

- Keep SQLite migrations in `electron/database/migrations/`.
- Use `PRAGMA user_version` and focused steps such as `v4-to-v5.ts`.
- Keep `electron/database.ts` thin.
- Before changing existing user databases, create a backup and run migrations in a transaction.
- Add or update migration tests when a test harness exists; for Electron ABI/native behavior, verify through Electron rather than plain Node.

## Testing

- Before PRs, run at least `npm run lint` and `npm run build`.
- For desktop UI or interaction changes, also verify the changed screen in the actual Electron app.
- For UI interaction bugs, test the real user event path early; add targeted logs around `pointerdown`, `click`, or menu selection when needed.
- Final verification must say which path was used: Electron CDP, actual Electron window, or blocked. A standalone Chrome load of `127.0.0.1:1420` never counts as desktop UI verification.

## Commits and PRs

- Use short, imperative Chinese commit subjects, matching recent history such as `筛选` or `修改db存储路径`.
- Keep commits focused.
- PRs should include summary, verification steps, linked issues when relevant, and screenshots or recordings for UI changes.
- Mention packaging, release, or docs impact explicitly when applicable.
