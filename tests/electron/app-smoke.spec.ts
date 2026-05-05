import { expect, test } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";
import electronPath from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type ShiguangSmokeApiResult = {
  hasInvoke: boolean;
  hasDialog: boolean;
  hasWindowApi: boolean;
  indexPaths: string[];
  isFullscreen: boolean;
};

type ShiguangDesktopApi = {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  dialog: {
    open(options: Record<string, unknown>): Promise<string | string[] | null>;
  };
  window: {
    setFullscreen(enabled: boolean): Promise<boolean>;
    isFullscreen(): Promise<boolean>;
  };
};

test.describe("Electron app smoke", () => {
  let app: ElectronApplication | null = null;
  let tempDir = "";

  test.afterEach(async () => {
    await app?.close();
    app = null;
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  test("boots with isolated storage and exposes the preload API", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "shiguang-electron-smoke-"));
    const userDataDir = path.join(tempDir, "user-data");
    const libraryDir = path.join(tempDir, "library");
    const mainEntry = path.resolve("out/main/main.cjs");

    app = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: [mainEntry],
      cwd: path.resolve("."),
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
        NO_PROXY: "127.0.0.1,localhost",
        SHIGUANG_INDEX_PATH: libraryDir,
        SHIGUANG_USER_DATA_DIR: userDataDir,
      },
    });

    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForFunction(() => {
      const shiguang = (window as Window & { shiguang?: unknown }).shiguang;
      return Boolean(
        shiguang &&
        typeof shiguang === "object" &&
        "invoke" in shiguang &&
        typeof shiguang.invoke === "function",
      );
    });

    await expect(page).toHaveTitle(/拾光/u);
    await expect(page.locator(".app-shell, [aria-label='加载中']")).toHaveCount(1);

    const api = await page.evaluate(async (): Promise<ShiguangSmokeApiResult> => {
      const shiguang = (window as Window & { shiguang: ShiguangDesktopApi }).shiguang;
      const indexPaths = (await shiguang.invoke("get_index_paths")) as string[];
      const isFullscreen = (await shiguang.window.isFullscreen()) as boolean;

      return {
        hasInvoke: typeof shiguang.invoke === "function",
        hasDialog: typeof shiguang.dialog.open === "function",
        hasWindowApi: typeof shiguang.window.setFullscreen === "function",
        indexPaths,
        isFullscreen,
      };
    });

    expect(api).toMatchObject({
      hasInvoke: true,
      hasDialog: true,
      hasWindowApi: true,
      indexPaths: [libraryDir],
      isFullscreen: false,
    });
    await expect(fs.access(path.join(userDataDir, "library-state.json"))).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(libraryDir, ".shiguang/db/shiguang.db")),
    ).resolves.toBeUndefined();
  });
});
