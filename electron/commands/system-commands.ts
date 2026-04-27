import { app, nativeImage, shell } from "electron";
import fssync from "node:fs";
import path from "node:path";
import { writeFilesToClipboard } from "../clipboard-file-references";
import { getFileById, getFolderById, touchFileLastAccessed } from "../database";
import { checkForUpdates } from "../app/updater";
import type { AppState, FileRecord } from "../types";
import { type CommandHandler, numberArg, numberArrayArg } from "./common";

function getDragIcon() {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, "assets", "app-icon.png")]
    : [
        path.join(process.cwd(), "assets", "app-icon.png"),
        path.join(process.cwd(), "src", "assets", "app-icon.png"),
      ];

  const iconPath = candidates.find((candidate) => fssync.existsSync(candidate));
  const fallbackIconPath = path.join(process.cwd(), "assets", "image.png");
  const sourceIconPath = iconPath ?? fallbackIconPath;
  const dragIcon = nativeImage.createFromPath(sourceIconPath);

  if (!dragIcon.isEmpty()) {
    return dragIcon.resize({
      width: 48,
      height: 48,
      quality: "best",
    });
  }

  return sourceIconPath;
}

export function createSystemCommands(state: AppState): Record<string, CommandHandler> {
  return {
    get_app_version: () => app.getVersion(),
    check_for_updates: () => checkForUpdates({ manual: true }),
    copy_files_to_clipboard: (args) => {
      const files = numberArrayArg(args, "fileIds", "file_ids")
        .map((fileId) => getFileById(state.db, fileId))
        .filter((item): item is FileRecord => Boolean(item));
      return writeFilesToClipboard(files);
    },
    start_drag_files: (args, window) => {
      const paths = numberArrayArg(args, "fileIds", "file_ids")
        .map((fileId) => getFileById(state.db, fileId)?.path)
        .filter((item): item is string => Boolean(item));
      if (!paths.length || !window) throw new Error("No files selected");
      window.webContents.startDrag({
        file: paths[0],
        icon: getDragIcon(),
      });
    },
    open_file: async (args) => {
      const fileId = numberArg(args, "fileId", "file_id");
      const file = getFileById(state.db, fileId);
      if (!file) throw new Error("File not found");
      touchFileLastAccessed(state.db, fileId);
      const result = await shell.openPath(file.path);
      if (result) throw new Error(result);
    },
    show_in_explorer: (args) => {
      const file = getFileById(state.db, numberArg(args, "fileId", "file_id"));
      if (!file) throw new Error("File not found");
      shell.showItemInFolder(file.path);
    },
    show_folder_in_explorer: async (args) => {
      const folder = getFolderById(state.db, numberArg(args, "folderId", "folder_id"));
      if (!folder) throw new Error("Folder not found");
      const result = await shell.openPath(folder.path);
      if (result) throw new Error(result);
    },
    show_current_library_in_explorer: async () => {
      const result = await shell.openPath(state.indexPath);
      if (result) throw new Error(result);
    },
  };
}
