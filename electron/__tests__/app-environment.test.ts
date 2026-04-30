import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockApp } = vi.hoisted(() => ({
  mockApp: {
    isPackaged: false,
    getPath: vi.fn((name: string) => {
      if (name === "appData") return "/Users/test/Library/Application Support";
      if (name === "pictures") return "/Users/test/Pictures";
      return "";
    }),
    setPath: vi.fn(),
  },
}));

vi.mock("electron", () => ({
  app: mockApp,
}));

vi.mock("node:fs", () => ({
  default: {
    mkdirSync: vi.fn(),
  },
}));

const fssync = (await import("node:fs")).default as unknown as {
  mkdirSync: ReturnType<typeof vi.fn>;
};
const { configureEnvironmentUserDataPath, getDefaultLibraryDirName, getDevelopmentUserDataPath } =
  await import("../app/environment");
const { getDefaultIndexPath } = await import("../storage");

beforeEach(() => {
  mockApp.isPackaged = false;
  mockApp.getPath.mockClear();
  mockApp.setPath.mockClear();
  fssync.mkdirSync.mockClear();
});

describe("app environment paths", () => {
  it("uses isolated development user data and default library paths", () => {
    expect(getDevelopmentUserDataPath()).toBe("/Users/test/Library/Application Support/拾光 Dev");
    expect(getDefaultLibraryDirName()).toBe("shiguang-dev");
    expect(getDefaultIndexPath()).toBe("/Users/test/Pictures/shiguang-dev");

    configureEnvironmentUserDataPath();

    expect(fssync.mkdirSync).toHaveBeenCalledWith(
      "/Users/test/Library/Application Support/拾光 Dev",
      { recursive: true },
    );
    expect(mockApp.setPath).toHaveBeenCalledWith(
      "userData",
      "/Users/test/Library/Application Support/拾光 Dev",
    );
  });

  it("keeps packaged builds on production paths", () => {
    mockApp.isPackaged = true;

    expect(getDefaultLibraryDirName()).toBe("shiguang");
    expect(getDefaultIndexPath()).toBe("/Users/test/Pictures/shiguang");

    configureEnvironmentUserDataPath();

    expect(fssync.mkdirSync).not.toHaveBeenCalled();
    expect(mockApp.setPath).not.toHaveBeenCalled();
  });
});
