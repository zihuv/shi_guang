import { app } from "electron";
import fs from "node:fs/promises";
import { addIndexPath, getIndexPaths, getSetting, removeIndexPath, setSetting } from "../database";
import {
  ensureStorageDirs,
  getDefaultIndexPath,
  persistIndexPath,
  readRecentIndexPaths,
  rememberRecentIndexPaths,
} from "../storage";
import type { AppState } from "../types";
import { type CommandHandler, stringArg, type GetWindow } from "./common";
import { scanIndexPath } from "./library-sync-service";

async function scanAllIndexPaths(state: AppState, window: Parameters<CommandHandler>[1]) {
  let total = 0;
  for (const indexPath of getIndexPaths(state.db)) {
    total += await scanIndexPath(state, indexPath, window);
  }
  return total;
}

export function createIndexingCommands(
  state: AppState,
  _getWindow: GetWindow,
): Record<string, CommandHandler> {
  return {
    get_setting: (args) => getSetting(state.db, stringArg(args, "key")),
    set_setting: (args) => setSetting(state.db, stringArg(args, "key"), stringArg(args, "value")),
    get_index_paths: () => getIndexPaths(state.db),
    get_recent_index_paths: async () => readRecentIndexPaths(state.appDataDir),
    get_default_index_path: async () => {
      const indexPath = getDefaultIndexPath();
      await fs.mkdir(indexPath, { recursive: true });
      await ensureStorageDirs(indexPath);
      return indexPath;
    },
    add_index_path: async (args) => {
      const indexPath = stringArg(args, "path");
      await fs.mkdir(indexPath, { recursive: true });
      await ensureStorageDirs(indexPath);
      addIndexPath(state.db, indexPath);
    },
    switch_index_path_and_restart: async (args) => {
      const indexPath = stringArg(args, "path");
      await fs.mkdir(indexPath, { recursive: true });
      await ensureStorageDirs(indexPath);
      await rememberRecentIndexPaths(state.appDataDir, [indexPath, state.indexPath]);
      await persistIndexPath(state.appDataDir, indexPath);
      app.relaunch();
      app.quit();
    },
    sync_index_path: (args, window) => scanIndexPath(state, stringArg(args, "path"), window),
    rebuild_library_index: (_args, window) => scanAllIndexPaths(state, window),
    remove_index_path: (args) => removeIndexPath(state.db, stringArg(args, "path")),
  };
}
