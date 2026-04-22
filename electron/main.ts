import { app, BrowserWindow, Menu, net, protocol } from "electron";
import log from "electron-log/main";
import crypto from "node:crypto";
import fssync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openDatabase } from "./database";
import {
  registerIpcHandlers,
  requestLibrarySyncScan,
  startCollectorServer,
  startLibrarySyncService,
} from "./commands";
import { getDbPath, isPathAllowedForRead, resolveInitialIndexPath } from "./storage";
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
const tokenToPath = new Map<string, string>();
const pathToToken = new Map<string, string>();

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

async function createMainWindow(): Promise<void> {
  const preload = path.join(__dirname, "../preload/preload.cjs");
  mainWindow = new BrowserWindow({
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

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  if (!app.isPackaged) {
    mainWindow.webContents.on("before-input-event", (event, input) => {
      if (!isDevToolsToggleShortcut(input)) {
        return;
      }

      event.preventDefault();
      mainWindow?.webContents.toggleDevTools();
    });
  }

  mainWindow.removeMenu();
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.on("focus", () => {
    if (appState) {
      requestLibrarySyncScan(appState, getMainWindow, "focus");
    }
  });
}

async function bootstrap(): Promise<void> {
  const appDataDir = app.getPath("userData");
  const indexPath = await resolveInitialIndexPath(appDataDir);
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

Menu.setApplicationMenu(null);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createMainWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
