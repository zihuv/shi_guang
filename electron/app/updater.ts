import { app, dialog, shell, type BrowserWindow, type MessageBoxOptions } from "electron";
import { autoUpdater, type UpdateInfo } from "electron-updater";
import log from "electron-log/main";

export const AUTO_CHECK_UPDATES_SETTING_KEY = "autoCheckUpdates";

const DOWNLOAD_PAGE_URL = "https://github.com/zihuv/shiguang/releases/latest";
const LATEST_RELEASE_API_URL = "https://api.github.com/repos/zihuv/shiguang/releases/latest";
const STARTUP_CHECK_DELAY_MS = 8000;

type UpdateStatus =
  | "disabled"
  | "checking"
  | "available"
  | "not-available"
  | "downloaded"
  | "error";

export interface UpdateCheckResult {
  status: UpdateStatus;
  message: string;
  version?: string;
  downloadUrl?: string;
}

let getMainWindow: (() => BrowserWindow | null) | null = null;
let isChecking = false;
let hasRegisteredAutoUpdaterEvents = false;
let hasPromptedDownloadedUpdate = false;

function releaseDownloadUrl(version: string): string {
  return `https://github.com/zihuv/shiguang/releases/tag/${version}`;
}

function normalizeVersion(version: string): number[] {
  return version
    .trim()
    .replace(/^v/i, "")
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function isNewerVersion(candidate: string, current: string): boolean {
  const nextParts = normalizeVersion(candidate);
  const currentParts = normalizeVersion(current);
  const length = Math.max(nextParts.length, currentParts.length);

  for (let index = 0; index < length; index += 1) {
    const nextPart = nextParts[index] ?? 0;
    const currentPart = currentParts[index] ?? 0;
    if (nextPart > currentPart) return true;
    if (nextPart < currentPart) return false;
  }

  return false;
}

function shouldUseAutoUpdater(): boolean {
  if (!app.isPackaged) {
    return false;
  }

  if (process.platform === "darwin") {
    return false;
  }

  if (process.platform === "linux" && !process.env.APPIMAGE) {
    return false;
  }

  return process.platform === "win32" || process.platform === "linux";
}

function emitUpdateStatus(result: UpdateCheckResult): void {
  const window = getMainWindow?.();
  if (!window || window.isDestroyed()) {
    return;
  }

  window.webContents.send("update-status", result);
}

async function promptDownloadedUpdate(info: UpdateInfo): Promise<void> {
  if (hasPromptedDownloadedUpdate) {
    return;
  }

  hasPromptedDownloadedUpdate = true;
  const window = getMainWindow?.();
  const options: MessageBoxOptions = {
    type: "info",
    buttons: ["立即重启安装", "稍后"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    message: `拾光 ${info.version} 已下载完成`,
    detail: "重启应用后将安装新版本。",
  };
  const result =
    window && !window.isDestroyed()
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options);

  if (result.response === 0) {
    autoUpdater.quitAndInstall();
  }
}

function registerAutoUpdaterEvents(): void {
  if (hasRegisteredAutoUpdaterEvents) {
    return;
  }

  hasRegisteredAutoUpdaterEvents = true;
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    emitUpdateStatus({
      status: "checking",
      message: "正在检查更新...",
    });
  });

  autoUpdater.on("update-available", (info) => {
    emitUpdateStatus({
      status: "available",
      version: info.version,
      downloadUrl: releaseDownloadUrl(info.version),
      message: `发现新版本 ${info.version}，正在后台下载。`,
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    emitUpdateStatus({
      status: "not-available",
      version: info.version,
      message: "当前已是最新版本。",
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    emitUpdateStatus({
      status: "downloaded",
      version: info.version,
      message: `新版本 ${info.version} 已下载完成。`,
    });
    void promptDownloadedUpdate(info);
  });

  autoUpdater.on("error", (error) => {
    log.warn("Update check failed", error);
    emitUpdateStatus({
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  });
}

async function fetchLatestRelease(): Promise<{ version: string; url: string } | null> {
  const response = await fetch(LATEST_RELEASE_API_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `shiguang/${app.getVersion()}`,
    },
  });

  if (!response.ok) {
    throw new Error(`无法获取最新版本信息：${response.status}`);
  }

  const release = (await response.json()) as {
    tag_name?: string;
    html_url?: string;
    draft?: boolean;
    prerelease?: boolean;
  };
  const version = release.tag_name?.trim();
  if (!version || release.draft || release.prerelease) {
    return null;
  }

  return {
    version,
    url: release.html_url || releaseDownloadUrl(version),
  };
}

async function promptManualDownload(version: string, url = DOWNLOAD_PAGE_URL): Promise<void> {
  const window = getMainWindow?.();
  const options: MessageBoxOptions = {
    type: "info",
    buttons: ["去下载", "稍后"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    message: `发现拾光 ${version}`,
    detail:
      process.platform === "darwin"
        ? "macOS 版本需要前往下载页手动下载安装包。"
        : "当前安装方式需要前往下载页手动下载安装包。",
  };
  const result =
    window && !window.isDestroyed()
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options);

  if (result.response === 0) {
    await shell.openExternal(url);
  }
}

async function checkReleasePageForUpdates(manual: boolean): Promise<UpdateCheckResult> {
  if (!app.isPackaged && !manual) {
    return {
      status: "disabled",
      message: "开发环境不会自动检查更新。",
    };
  }

  const release = await fetchLatestRelease();
  if (!release) {
    return {
      status: "not-available",
      message: "当前已是最新版本。",
    };
  }

  const currentVersion = app.getVersion();
  if (!isNewerVersion(release.version, currentVersion)) {
    return {
      status: "not-available",
      version: currentVersion,
      message: "当前已是最新版本。",
    };
  }

  if (manual || app.isPackaged) {
    await promptManualDownload(release.version);
  }

  return {
    status: "available",
    version: release.version,
    downloadUrl: DOWNLOAD_PAGE_URL,
    message: `发现新版本 ${release.version}。`,
  };
}

export function configureUpdater(input: { getWindow: () => BrowserWindow | null }): void {
  getMainWindow = input.getWindow;
  registerAutoUpdaterEvents();
}

export function scheduleStartupUpdateCheck(enabled: boolean): void {
  if (!enabled || !app.isPackaged) {
    return;
  }

  setTimeout(() => {
    void checkForUpdates({ manual: false }).catch((error) => {
      log.warn("Startup update check failed", error);
    });
  }, STARTUP_CHECK_DELAY_MS);
}

export async function checkForUpdates(options?: { manual?: boolean }): Promise<UpdateCheckResult> {
  const manual = options?.manual ?? false;

  if (!app.isPackaged && manual) {
    return {
      status: "disabled",
      message: "开发环境不会检查更新。",
    };
  }

  if (isChecking) {
    return {
      status: "checking",
      message: "正在检查更新...",
    };
  }

  isChecking = true;
  try {
    if (!shouldUseAutoUpdater()) {
      const result = await checkReleasePageForUpdates(manual);
      emitUpdateStatus(result);
      return result;
    }

    registerAutoUpdaterEvents();
    const result = await autoUpdater.checkForUpdates();
    const version = result?.updateInfo.version;

    if (version && isNewerVersion(version, app.getVersion())) {
      return {
        status: "available",
        version,
        downloadUrl: releaseDownloadUrl(version),
        message: `发现新版本 ${version}，正在后台下载。`,
      };
    }

    return {
      status: "not-available",
      version: app.getVersion(),
      message: "当前已是最新版本。",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result: UpdateCheckResult = {
      status: "error",
      message,
    };
    emitUpdateStatus(result);
    return result;
  } finally {
    isChecking = false;
  }
}
