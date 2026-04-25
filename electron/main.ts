import { app, Menu } from "electron";
import log from "electron-log/main";
import { setDockIcon } from "./app/app-icon";
import { buildApplicationMenu } from "./app/application-menu";
import {
  ensureDeletedFolderHoldingDir,
  registerIpcHandlers,
  requestLibrarySyncScan,
  startCollectorServer,
  startLibrarySyncService,
  wakeAutoVisualIndexing,
} from "./commands";
import { openDatabase } from "./database";
import { getSetting } from "./database";
import {
  assetToUrl,
  registerFileProtocol,
  registerFileProtocolPrivileges,
} from "./app/file-protocol";
import { resolveStartupIndexPath } from "./app/startup-library";
import { getDbPath } from "./storage";
import type { AppState } from "./types";
import {
  AUTO_CHECK_UPDATES_SETTING_KEY,
  configureUpdater,
  scheduleStartupUpdateCheck,
} from "./app/updater";
import { createWindowManager } from "./app/window-manager";

registerFileProtocolPrivileges();

log.initialize();
app.setAppUserModelId("com.zihuv.shiguang");

if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
  app.commandLine.appendSwitch("remote-debugging-port", "9222");
}

let appState: AppState | null = null;

const windowManager = createWindowManager({
  getAppState: () => appState,
  onMainWindowFocus: (state, getMainWindow) => {
    requestLibrarySyncScan(state, getMainWindow, "focus");
    wakeAutoVisualIndexing(state, getMainWindow());
  },
});

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
  Menu.setApplicationMenu(buildApplicationMenu(app.name));
  registerFileProtocol(() => appState);
  registerIpcHandlers(appState, windowManager.getMainWindow, assetToUrl);
  configureUpdater({ getWindow: windowManager.getMainWindow });
  await windowManager.createMainWindow();
  wakeAutoVisualIndexing(appState, windowManager.getMainWindow());
  scheduleStartupUpdateCheck(getSetting(db, AUTO_CHECK_UPDATES_SETTING_KEY) === "true");
  startLibrarySyncService(appState, windowManager.getMainWindow);
  await startCollectorServer(appState, windowManager.getMainWindow).catch((error) => {
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
  windowManager.prepareForQuit();
});

app.on("activate", () => {
  void windowManager.showMainWindow().catch((error) => {
    log.error("Failed to show main window", error);
  });
});

app.on("window-all-closed", () => {});
