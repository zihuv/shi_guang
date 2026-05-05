import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectFilesFromDirectoryWithRel,
  normalizeImportExtension,
} from "../commands/import-core";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "shiguang-import-core-"));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("import core helpers", () => {
  it("collects supported files recursively with relative import folders", async () => {
    const root = makeTempDir();
    const nested = path.join(root, "参考", "网页");
    mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(root, "cover.jpg"), "");
    writeFileSync(path.join(nested, "mockup.png"), "");
    writeFileSync(path.join(nested, "raw.cr2"), "");
    writeFileSync(path.join(nested, ".DS_Store"), "");

    const collected = await collectFilesFromDirectoryWithRel(root);
    collected.sort((a, b) => a.abs.localeCompare(b.abs));

    expect(collected).toEqual([
      { abs: path.join(root, "cover.jpg"), relDir: "" },
      { abs: path.join(nested, "mockup.png"), relDir: path.join("参考", "网页") },
    ]);
  });

  it("normalizes imported extension fallbacks", () => {
    expect(normalizeImportExtension(".JPG")).toBe("jpg");
    expect(normalizeImportExtension("  png  ")).toBe("png");
    expect(normalizeImportExtension("")).toBe("bin");
    expect(normalizeImportExtension(null)).toBe("bin");
  });
});
