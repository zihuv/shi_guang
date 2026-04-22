import { describe, expect, it } from "vitest";
import {
  classifyExistingPathSync,
  shouldMarkMissing,
  shouldUseMoveCandidate,
} from "../library-sync-logic";

describe("library sync decisions", () => {
  it("does not resurrect files that are in the app trash", () => {
    expect(classifyExistingPathSync({ deletedAt: "2026-04-22 10:00:00" }, false)).toBe("skipped");
  });

  it("keeps unchanged active files quiet and restores missing files as additions", () => {
    expect(classifyExistingPathSync({ deletedAt: null, missingAt: null }, true)).toBe("skipped");
    expect(classifyExistingPathSync({ deletedAt: null, missingAt: null }, false)).toBe("updated");
    expect(
      classifyExistingPathSync({ deletedAt: null, missingAt: "2026-04-22 10:00:00" }, true),
    ).toBe("added");
  });

  it("only reuses move candidates when the old path is missing or gone", () => {
    expect(
      shouldUseMoveCandidate(
        { path: "/library/old.png", missingAt: "2026-04-22 10:00:00" },
        "/library/new.png",
        true,
      ),
    ).toBe(true);
    expect(
      shouldUseMoveCandidate(
        { path: "/library/old.png", missingAt: null },
        "/library/new.png",
        false,
      ),
    ).toBe(true);
    expect(
      shouldUseMoveCandidate(
        { path: "/library/old.png", missingAt: null },
        "/library/new.png",
        true,
      ),
    ).toBe(false);
    expect(
      shouldUseMoveCandidate(
        { path: "/library/old.png", missingAt: null },
        "/library/old.png",
        false,
      ),
    ).toBe(false);
  });

  it("marks only active missing records as missing", () => {
    expect(
      shouldMarkMissing({
        hasRecord: true,
        deletedAt: null,
        missingAt: null,
        existsOnDisk: false,
      }),
    ).toBe(true);
    expect(
      shouldMarkMissing({
        hasRecord: true,
        deletedAt: "2026-04-22 10:00:00",
        missingAt: null,
        existsOnDisk: false,
      }),
    ).toBe(false);
    expect(
      shouldMarkMissing({
        hasRecord: true,
        deletedAt: null,
        missingAt: null,
        existsOnDisk: true,
      }),
    ).toBe(false);
  });
});
