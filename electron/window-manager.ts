import { app, BrowserWindow, Menu, nativeImage, shell, Tray } from "electron";
import path from "node:path";
import { suspendVisualIndexing } from "./commands/visual-ai-service.js";
import { getAppIconPath, setDockVisibility } from "./app-icon";
import {
  setVisualIndexUtilitySuspended,
  stopVisualIndexUtility,
} from "./visual-index-utility-service.js";
import { releaseVisualSearchRuntime } from "./visual-search/index.js";
import type { AppState } from "./types";

type WindowManagerOptions = {
  getAppState: () => AppState | null;
  onMainWindowFocus: (state: AppState, getMainWindow: () => BrowserWindow | null) => void;
};

export type WindowManager = ReturnType<typeof createWindowManager>;

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

function createTrayIcon() {
  const icon = nativeImage.createFromPath(getAppIconPath());
  if (icon.isEmpty()) {
    return icon;
  }

  const size = process.platform === "darwin" ? 18 : 16;
  return icon.resize({ width: size, height: size });
}

function isExternalHttpUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function releaseBackgroundRuntimes(reason: string): void {
  setVisualIndexUtilitySuspended(true);
  stopVisualIndexUtility();
  void releaseVisualSearchRuntime(reason);
}

export function createWindowManager(options: WindowManagerOptions) {
  let mainWindow: BrowserWindow | null = null;
  let tray: Tray | null = null;
  let isQuitting = false;

  function getMainWindow(): BrowserWindow | null {
    return mainWindow;
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
    const state = options.getAppState();
    if (state) {
      suspendVisualIndexing(state, window);
    }
    releaseBackgroundRuntimes("应用已转入后台，视觉搜索运行时已释放。");
    ensureTray();
    setDockVisibility(false);
    window.setSkipTaskbar(true);
    window.destroy();
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
      const state = options.getAppState();
      if (state) {
        options.onMainWindowFocus(state, getMainWindow);
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

  async function showMainWindow(): Promise<BrowserWindow> {
    setVisualIndexUtilitySuspended(false);
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

  function prepareForQuit(): void {
    isQuitting = true;
    releaseBackgroundRuntimes("应用退出时已释放视觉搜索运行时。");
  }

  function quitApplication(): void {
    isQuitting = true;
    tray?.destroy();
    tray = null;
    app.quit();
  }

  return {
    createMainWindow,
    getMainWindow,
    prepareForQuit,
    showMainWindow,
  };
}
