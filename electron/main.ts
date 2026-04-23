import { app, BrowserWindow, Menu, Tray, dialog, nativeImage, net, protocol, shell } from "electron";
import log from "electron-log/main";
import crypto from "node:crypto";
import fssync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openDatabase } from "./database";
import {
  ensureDeletedFolderHoldingDir,
  registerIpcHandlers,
  requestLibrarySyncScan,
  startCollectorServer,
  startLibrarySyncService,
} from "./commands";
import {
  ensureStorageDirs,
  getDbPath,
  isPathAllowedForRead,
  persistIndexPath,
  rememberRecentIndexPaths,
  readCurrentIndexPath,
} from "./storage";
import type { AppState } from "./types";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "shiguang-file",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
      stream: true,
    },
  },
]);

log.initialize();

if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
  app.commandLine.appendSwitch("remote-debugging-port", "9222");
}

let mainWindow: BrowserWindow | null = null;
let appState: AppState | null = null;
let tray: Tray | null = null;
let isQuitting = false;
const tokenToPath = new Map<string, string>();
const pathToToken = new Map<string, string>();

function buildApplicationMenu(): Menu {
  if (process.platform === "darwin") {
    return Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "编辑",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "pasteAndMatchStyle" },
          { role: "delete" },
          { role: "selectAll" },
        ],
      },
      {
        label: "视图",
        submenu: [
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      {
        label: "窗口",
        submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }],
      },
    ]);
  }

  return Menu.buildFromTemplate([
    {
      label: "文件",
      submenu: [{ role: "quit" }],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "delete" },
        { role: "selectAll" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "窗口",
      submenu: [{ role: "minimize" }, { role: "close" }],
    },
  ]);
}

function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

function isDevToolsToggleShortcut(input: {
  key: string;
  type: string;
  control: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}): boolean {
  if (input.type !== "keyDown") {
    return false;
  }

  const key = input.key.toLowerCase();
  if (key === "f12") {
    return true;
  }

  if (process.platform === "darwin") {
    return key === "i" && input.meta && input.alt;
  }

  return key === "i" && input.control && input.shift;
}

function getAppIconPath(): string {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, "assets", "app-icon.png")]
    : [
        path.join(process.cwd(), "assets", "app-icon.png"),
        path.join(process.cwd(), "src", "assets", "app-icon.png"),
      ];

  const iconPath = candidates.find((candidate) => fssync.existsSync(candidate));
  return iconPath ?? path.join(process.cwd(), "assets", "image.png");
}

function setDockIcon(): void {
  if (process.platform !== "darwin" || !app.dock) {
    return;
  }

  const icon = nativeImage.createFromPath(getAppIconPath());
  if (!icon.isEmpty()) {
    app.dock.setIcon(icon);
  }
}

function setDockVisibility(visible: boolean): void {
  if (process.platform !== "darwin" || !app.dock) {
    return;
  }

  if (visible) {
    app.dock.show();
    return;
  }

  app.dock.hide();
}

function createTrayIcon() {
  const icon = nativeImage.createFromPath(getAppIconPath());
  if (icon.isEmpty()) {
    return icon;
  }

  const size = process.platform === "darwin" ? 18 : 16;
  return icon.resize({ width: size, height: size });
}

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

async function resolveStartupIndexPath(appDataDir: string): Promise<string | null> {
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

async function showMainWindow(): Promise<BrowserWindow> {
  setDockVisibility(true);

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.setSkipTaskbar(false);
    mainWindow.show();
    mainWindow.focus();
    updateTrayMenu();
    return mainWindow;
  }

  const window = await createMainWindow();
  updateTrayMenu();
  return window;
}

function quitApplication(): void {
  isQuitting = true;
  tray?.destroy();
  tray = null;
  app.quit();
}

function updateTrayMenu(): void {
  if (!tray) {
    return;
  }

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: mainWindow && !mainWindow.isDestroyed() ? "显示主窗口" : "打开拾光",
        click: () => {
          void showMainWindow();
        },
      },
      {
        label: "退出拾光",
        click: () => {
          quitApplication();
        },
      },
    ]),
  );
}

function ensureTray(): Tray {
  if (tray) {
    updateTrayMenu();
    return tray;
  }

  const icon = createTrayIcon();
  tray = new Tray(icon.isEmpty() ? getAppIconPath() : icon);
  tray.setToolTip("拾光");
  tray.on("click", () => {
    void showMainWindow();
  });
  updateTrayMenu();
  return tray;
}

function moveWindowToBackground(window: BrowserWindow): void {
  ensureTray();
  setDockVisibility(false);
  window.setSkipTaskbar(true);
  window.destroy();
}

function assetToUrl(filePath: string): string {
  const normalized = path.resolve(filePath);
  let token = pathToToken.get(normalized);
  if (!token) {
    token = crypto.randomUUID();
    pathToToken.set(normalized, token);
    tokenToPath.set(token, normalized);
  }
  return `shiguang-file://asset/${token}`;
}

function contentTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".pdf": "application/pdf",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
  };
  return types[ext] ?? "application/octet-stream";
}

function isExternalHttpUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function registerFileProtocol(): void {
  protocol.handle("shiguang-file", async (request) => {
    const state = appState;
    if (!state) {
      return new Response("App is not ready", { status: 503 });
    }

    const url = new URL(request.url);
    const token = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    const filePath = tokenToPath.get(token);
    if (
      !filePath ||
      !isPathAllowedForRead(
        filePath,
        state.db
          .prepare("SELECT path FROM index_paths")
          .all()
          .map((row) => (row as { path: string }).path),
      )
    ) {
      return new Response("Not found", { status: 404 });
    }

    try {
      await fs.access(filePath);
      const response = await net.fetch(pathToFileURL(filePath).toString());
      return new Response(response.body, {
        status: response.status,
        headers: {
          "content-type": contentTypeForPath(filePath),
          "cache-control": "public, max-age=31536000",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

async function createMainWindow(): Promise<BrowserWindow> {
  const preload = path.join(__dirname, "../preload/preload.cjs");
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "拾光",
    icon: getAppIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload,
    },
  });
  mainWindow = window;

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpUrl(url)) {
      void shell.openExternal(url);
      return { action: "deny" };
    }

    return { action: "allow" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (!isExternalHttpUrl(url)) {
      return;
    }

    event.preventDefault();
    void shell.openExternal(url);
  });

  window.on("close", (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    moveWindowToBackground(window);
  });
  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
    updateTrayMenu();
  });
  window.on("focus", () => {
    if (appState) {
      requestLibrarySyncScan(appState, getMainWindow, "focus");
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  if (!app.isPackaged) {
    window.webContents.on("before-input-event", (event, input) => {
      if (!isDevToolsToggleShortcut(input)) {
        return;
      }

      event.preventDefault();
      window.webContents.toggleDevTools();
    });
  }

  window.setSkipTaskbar(false);
  window.setMenuBarVisibility(false);
  updateTrayMenu();
  return window;
}

async function bootstrap(): Promise<void> {
  const appDataDir = app.getPath("userData");
  await ensureDeletedFolderHoldingDir(appDataDir);
  const indexPath = await resolveStartupIndexPath(appDataDir);
  if (!indexPath) {
    app.quit();
    return;
  }
  const dbPath = getDbPath(indexPath);
  const db = openDatabase(dbPath, indexPath);
  appState = {
    db,
    dbPath,
    appDataDir,
    indexPath,
    importTasks: new Map(),
    aiMetadataTasks: new Map(),
    visualIndexTasks: new Map(),
  };

  setDockIcon();
  Menu.setApplicationMenu(buildApplicationMenu());
  registerFileProtocol();
  registerIpcHandlers(appState, getMainWindow, assetToUrl);
  await createMainWindow();
  startLibrarySyncService(appState, getMainWindow);
  await startCollectorServer(appState, getMainWindow).catch((error) => {
    log.warn("Failed to start collector server", error);
  });
}

app.whenReady().then(() => {
  void bootstrap().catch((error) => {
    log.error("Failed to start app", error);
    app.quit();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("activate", () => {
  void showMainWindow().catch((error) => {
    log.error("Failed to show main window", error);
  });
});

app.on("window-all-closed", () => {
  if (isQuitting) {
    return;
  }
});
