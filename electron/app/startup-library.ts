import { app, dialog } from "electron";
import fssync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  ensureStorageDirs,
  persistIndexPath,
  readCurrentIndexPath,
  rememberRecentIndexPaths,
} from "../storage";

const INDEX_PATH_OVERRIDE_ENV = "SHIGUANG_INDEX_PATH";

function isExistingDirectory(targetPath: string): boolean {
  try {
    return fssync.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

async function promptForLibraryPath(
  appDataDir: string,
  options?: { missingPreviousPath?: string | null },
): Promise<string | null> {
  let missingPreviousPath = options?.missingPreviousPath ?? null;
  let selectionError: string | null = null;

  while (true) {
    const detail = selectionError
      ? `${selectionError}\n\n请选择其它文件夹，或修复权限后重试。`
      : missingPreviousPath
        ? `未找到上次使用的素材库：\n${missingPreviousPath}\n\n请选择已有素材库文件夹，或选择一个目录在其中创建新的拾光素材库。`
        : "请选择已有素材库文件夹，或选择一个目录在其中创建新的拾光素材库。";

    const selection = await dialog.showOpenDialog({
      title: "选择素材库文件夹",
      buttonLabel: "选择文件夹",
      properties: ["openDirectory", "createDirectory"],
      message: "必须先选择素材库文件夹才能使用拾光",
      defaultPath: app.getPath("home"),
    });

    if (!selection.canceled) {
      const selectedPath = selection.filePaths[0];
      if (selectedPath) {
        const resolvedPath = path.resolve(selectedPath);
        try {
          await fs.mkdir(resolvedPath, { recursive: true });
          await ensureStorageDirs(resolvedPath);
          await persistIndexPath(appDataDir, resolvedPath);
          await rememberRecentIndexPaths(appDataDir, [resolvedPath]);
          return resolvedPath;
        } catch (error) {
          selectionError = `无法在以下位置初始化素材库：\n${resolvedPath}\n\n${String(error)}`;
          missingPreviousPath = null;
          continue;
        }
      }
    }

    const result = await dialog.showMessageBox({
      type: "question",
      buttons: ["继续选择", "退出应用"],
      defaultId: 0,
      cancelId: 0,
      message: "必须先选择素材库文件夹才能进入应用",
      detail,
      noLink: true,
    });

    if (result.response === 1) {
      return null;
    }

    missingPreviousPath = null;
  }
}

async function resolveIndexPathOverride(appDataDir: string): Promise<string | null> {
  const override = process.env[INDEX_PATH_OVERRIDE_ENV]?.trim();
  if (!override) {
    return null;
  }

  const indexPath = path.resolve(override);
  await fs.mkdir(indexPath, { recursive: true });
  await ensureStorageDirs(indexPath);
  await persistIndexPath(appDataDir, indexPath);
  await rememberRecentIndexPaths(appDataDir, [indexPath]);
  return indexPath;
}

export async function resolveStartupIndexPath(appDataDir: string): Promise<string | null> {
  const override = await resolveIndexPathOverride(appDataDir);
  if (override) {
    return override;
  }

  const persistedPath = await readCurrentIndexPath(appDataDir);
  if (persistedPath && isExistingDirectory(persistedPath)) {
    try {
      await ensureStorageDirs(persistedPath);
      await rememberRecentIndexPaths(appDataDir, [persistedPath]);
      return persistedPath;
    } catch {
      return promptForLibraryPath(appDataDir, {
        missingPreviousPath: persistedPath,
      });
    }
  }

  return promptForLibraryPath(appDataDir, {
    missingPreviousPath: persistedPath,
  });
}
