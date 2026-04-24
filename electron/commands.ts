import { BrowserWindow, dialog, ipcMain } from "electron";
import log from "electron-log/main";
import fs from "node:fs/promises";
import fssync from "node:fs";
import { z } from "zod";
import { getIndexPaths } from "./database";
import { isPathAllowedForRead } from "./storage";
import type { AppState } from "./types";
import { type GetWindow } from "./commands/common";
import { createCommandRegistry } from "./commands/registry";

export { startCollectorServer } from "./commands/collector-server";
export { requestLibrarySyncScan, startLibrarySyncService } from "./commands/library-sync-service";
export { ensureDeletedFolderHoldingDir } from "./commands/trash-file-service";

const rendererLogSchema = z.object({
  level: z.enum(["debug", "error", "info", "log", "trace", "warn"]).catch("info"),
  message: z.string().max(20_000),
});

export function registerIpcHandlers(
  state: AppState,
  getWindow: GetWindow,
  assetToUrl: (filePath: string) => string,
): void {
  const commands = createCommandRegistry(state, getWindow);

  ipcMain.handle(
    "shiguang:invoke",
    async (event, command: string, args: Record<string, unknown> = {}) => {
      const handler = commands[command];
      if (!handler) {
        throw new Error(`Unknown desktop command: ${command}`);
      }
      return handler(args, BrowserWindow.fromWebContents(event.sender));
    },
  );

  ipcMain.handle("shiguang:dialog:open", async (_event, options: Electron.OpenDialogOptions) => {
    const window = getWindow();
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    return result.canceled
      ? null
      : options.properties?.includes("multiSelections")
        ? result.filePaths
        : (result.filePaths[0] ?? null);
  });
  ipcMain.handle(
    "shiguang:fs:exists",
    (_event, filePath: string) =>
      fssync.existsSync(filePath) && isPathAllowedForRead(filePath, getIndexPaths(state.db)),
  );
  ipcMain.handle("shiguang:fs:readFile", async (_event, filePath: string) => {
    if (!isPathAllowedForRead(filePath, getIndexPaths(state.db)))
      throw new Error("Path is not allowed");
    return new Uint8Array(await fs.readFile(filePath));
  });
  ipcMain.handle("shiguang:fs:readTextFile", async (_event, filePath: string) => {
    if (!isPathAllowedForRead(filePath, getIndexPaths(state.db)))
      throw new Error("Path is not allowed");
    return fs.readFile(filePath, "utf8");
  });
  ipcMain.handle("shiguang:asset:toUrl", (_event, filePath: string) => assetToUrl(filePath));
  ipcMain.handle("shiguang:log", (_event, level: string, message: string) => {
    const payload = rendererLogSchema.parse({ level, message });
    const writer =
      payload.level === "error"
        ? log.error
        : payload.level === "warn"
          ? log.warn
          : payload.level === "debug"
            ? log.debug
            : log.info;
    writer(payload.message);
  });
}
