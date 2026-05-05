import { app } from "electron";
import fssync from "node:fs";
import path from "node:path";

const PRODUCTION_DEFAULT_LIBRARY_DIR_NAME = "shiguang";
const DEVELOPMENT_DEFAULT_LIBRARY_DIR_NAME = "shiguang-dev";
const DEVELOPMENT_USER_DATA_DIR_NAME = "拾光 Dev";
const USER_DATA_DIR_OVERRIDE_ENV = "SHIGUANG_USER_DATA_DIR";

export function isDevelopmentRuntime(): boolean {
  return !app.isPackaged;
}

export function configureEnvironmentUserDataPath(): void {
  const userDataOverride = process.env[USER_DATA_DIR_OVERRIDE_ENV]?.trim();
  if (userDataOverride) {
    const userDataPath = path.resolve(userDataOverride);
    fssync.mkdirSync(userDataPath, { recursive: true });
    app.setPath("userData", userDataPath);
    return;
  }

  if (!isDevelopmentRuntime()) {
    return;
  }

  const userDataPath = getDevelopmentUserDataPath();
  fssync.mkdirSync(userDataPath, { recursive: true });
  app.setPath("userData", userDataPath);
}

export function getDevelopmentUserDataPath(): string {
  return path.join(app.getPath("appData"), DEVELOPMENT_USER_DATA_DIR_NAME);
}

export function getDefaultLibraryDirName(): string {
  return isDevelopmentRuntime()
    ? DEVELOPMENT_DEFAULT_LIBRARY_DIR_NAME
    : PRODUCTION_DEFAULT_LIBRARY_DIR_NAME;
}
