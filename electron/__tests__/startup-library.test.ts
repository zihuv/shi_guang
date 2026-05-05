import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockApp, mockDialog, mockFs, mockStorage } = vi.hoisted(() => ({
  mockApp: {
    getPath: vi.fn((name: string) => (name === "home" ? "/Users/test" : "")),
  },
  mockDialog: {
    showOpenDialog: vi.fn(),
    showMessageBox: vi.fn(),
  },
  mockFs: {
    mkdir: vi.fn(),
    statSync: vi.fn(),
  },
  mockStorage: {
    ensureStorageDirs: vi.fn(),
    persistIndexPath: vi.fn(),
    readCurrentIndexPath: vi.fn(),
    rememberRecentIndexPaths: vi.fn(),
  },
}));

vi.mock("electron", () => ({
  app: mockApp,
  dialog: mockDialog,
}));

vi.mock("node:fs", () => ({
  default: {
    statSync: mockFs.statSync,
  },
}));

vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: mockFs.mkdir,
  },
}));

vi.mock("../storage", () => mockStorage);

const { resolveStartupIndexPath } = await import("../app/startup-library");

beforeEach(() => {
  vi.unstubAllEnvs();
  mockDialog.showOpenDialog.mockReset();
  mockDialog.showMessageBox.mockReset();
  mockFs.mkdir.mockReset();
  mockFs.statSync.mockReset();
  mockStorage.ensureStorageDirs.mockReset();
  mockStorage.persistIndexPath.mockReset();
  mockStorage.readCurrentIndexPath.mockReset();
  mockStorage.rememberRecentIndexPaths.mockReset();
});

describe("startup library path resolution", () => {
  it("uses explicit index path overrides without opening the startup picker", async () => {
    vi.stubEnv("SHIGUANG_INDEX_PATH", "/tmp/shiguang-smoke/library");

    await expect(resolveStartupIndexPath("/tmp/shiguang-smoke/user-data")).resolves.toBe(
      "/tmp/shiguang-smoke/library",
    );

    expect(mockFs.mkdir).toHaveBeenCalledWith("/tmp/shiguang-smoke/library", {
      recursive: true,
    });
    expect(mockStorage.ensureStorageDirs).toHaveBeenCalledWith("/tmp/shiguang-smoke/library");
    expect(mockStorage.persistIndexPath).toHaveBeenCalledWith(
      "/tmp/shiguang-smoke/user-data",
      "/tmp/shiguang-smoke/library",
    );
    expect(mockStorage.rememberRecentIndexPaths).toHaveBeenCalledWith(
      "/tmp/shiguang-smoke/user-data",
      ["/tmp/shiguang-smoke/library"],
    );
    expect(mockStorage.readCurrentIndexPath).not.toHaveBeenCalled();
    expect(mockDialog.showOpenDialog).not.toHaveBeenCalled();
  });
});
