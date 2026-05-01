import { describe, expect, it } from "vitest";
import { fuzzySearchItems } from "@/shared/fuzzySearch";

describe("fuzzySearch", () => {
  const items = [
    { name: "Music Player" },
    { name: "Design Pattern" },
    { name: "Media Browser" },
    { name: "Darkroom Preset" },
  ];

  it("matches acronym and ordered character queries", () => {
    expect(fuzzySearchItems(items, "mpy", { keys: [(item) => item.name] })[0]?.name).toBe(
      "Music Player",
    );
    expect(
      fuzzySearchItems(items, "mer", { keys: [(item) => item.name] }).map((item) => item.name),
    ).toContain("Music Player");
    expect(fuzzySearchItems(items, "dpn", { keys: [(item) => item.name] })[0]?.name).toBe(
      "Design Pattern",
    );
    expect(fuzzySearchItems(items, "desip", { keys: [(item) => item.name] })[0]?.name).toBe(
      "Design Pattern",
    );
  });
});
