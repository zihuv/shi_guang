import path from "node:path";

export const DELETED_FOLDER_HOLDING_DIR_NAME = "deleted-folders-pending";

export function getDeletedFolderHoldingDir(appDataDir: string): string {
  return path.join(appDataDir, DELETED_FOLDER_HOLDING_DIR_NAME);
}
