import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function removePath(
  targetPath: string,
  options: {
    force?: boolean;
    recursive?: boolean;
  } = {},
): Promise<void> {
  await fs.rm(targetPath, {
    force: options.force ?? true,
    recursive: options.recursive ?? false,
  });
}

export async function removePathQuietly(
  targetPath: string,
  options: {
    force?: boolean;
    recursive?: boolean;
  } = {},
): Promise<void> {
  await removePath(targetPath, options).catch(() => undefined);
}

export async function copyFileWithCloneFallback(
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  await ensureDir(path.dirname(targetPath));
  await fs.copyFile(sourcePath, targetPath, fssync.constants.COPYFILE_FICLONE);
}

export async function moveFileWithFallback(sourcePath: string, targetPath: string): Promise<void> {
  await ensureDir(path.dirname(targetPath));

  try {
    await fs.rename(sourcePath, targetPath);
    return;
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EXDEV") {
      throw error;
    }
  }

  await copyFileWithCloneFallback(sourcePath, targetPath);
  await removePath(sourcePath);
}

export async function moveDirectoryWithFallback(
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  await ensureDir(path.dirname(targetPath));

  try {
    await fs.rename(sourcePath, targetPath);
    return;
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EXDEV") {
      throw error;
    }
  }

  await fs.cp(sourcePath, targetPath, { recursive: true });
  await removePath(sourcePath, { recursive: true });
}
