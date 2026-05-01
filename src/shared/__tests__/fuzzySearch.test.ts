import { describe, expect, it } from "vitest";
import { fuzzySearchItems, fuzzyMatches, filterFuzzyTree } from "@/shared/fuzzySearch";

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

describe("pinyinSearch", () => {
  const items = [
    { name: "网页设计" },
    { name: "文档管理" },
    { name: "我的文件" },
    { name: "图片素材" },
    { name: "视频教程" },
    { name: "Music Player" },
  ];

  const keys = [(item: { name: string }) => item.name];

  describe("full pinyin match", () => {
    it("matches full pinyin", () => {
      const results = fuzzySearchItems(items, "wangye", { keys });
      expect(results.map((r) => r.name)).toContain("网页设计");
    });

    it("matches full pinyin for multiple characters", () => {
      const results = fuzzySearchItems(items, "wendang", { keys });
      expect(results.map((r) => r.name)).toContain("文档管理");
    });

    it("matches partial full pinyin", () => {
      const results = fuzzySearchItems(items, "wang", { keys });
      expect(results.map((r) => r.name)).toContain("网页设计");
    });

    it("matches full pinyin for video", () => {
      const results = fuzzySearchItems(items, "shipin", { keys });
      expect(results.map((r) => r.name)).toContain("视频教程");
    });
  });

  describe("first-letter abbreviation match", () => {
    it("matches first-letter abbreviation", () => {
      const results = fuzzySearchItems(items, "wy", { keys });
      expect(results.map((r) => r.name)).toContain("网页设计");
    });

    it("matches first-letter abbreviation for doc", () => {
      const results = fuzzySearchItems(items, "wd", { keys });
      expect(results.map((r) => r.name)).toContain("文档管理");
    });

    it("matches first-letter abbreviation for image", () => {
      const results = fuzzySearchItems(items, "tp", { keys });
      expect(results.map((r) => r.name)).toContain("图片素材");
    });

    it("matches first-letter for video", () => {
      const results = fuzzySearchItems(items, "sp", { keys });
      expect(results.map((r) => r.name)).toContain("视频教程");
    });
  });

  describe("Chinese direct match still works", () => {
    it("matches Chinese substring directly", () => {
      const results = fuzzySearchItems(items, "网页", { keys });
      expect(results[0]?.name).toBe("网页设计");
    });

    it("matches single Chinese character", () => {
      const results = fuzzySearchItems(items, "图", { keys });
      expect(results.map((r) => r.name)).toContain("图片素材");
    });
  });

  describe("English items still work with pinyin query", () => {
    it("English items remain searchable with English query", () => {
      const results = fuzzySearchItems(items, "music", { keys });
      expect(results[0]?.name).toBe("Music Player");
    });

    it("pinyin query does not incorrectly match English items", () => {
      const results = fuzzySearchItems(items, "wangye", { keys });
      expect(results.map((r) => r.name)).not.toContain("Music Player");
    });
  });

  describe("match-sorter results come before pinyin results", () => {
    it("Chinese substring match ranks higher than pinyin match", () => {
      const mixedItems = [{ name: "网页" }, { name: "网页设计" }, { name: "旺业大厦" }];
      const results = fuzzySearchItems(mixedItems, "网页", { keys });
      expect(results[0]?.name).toBe("网页");
    });
  });

  describe("no match returns empty", () => {
    it("returns empty for non-matching pinyin", () => {
      const results = fuzzySearchItems(items, "zzzzz", { keys });
      expect(results).toHaveLength(0);
    });
  });

  describe("empty query returns all items", () => {
    it("returns all items for empty query", () => {
      const results = fuzzySearchItems(items, "", { keys });
      expect(results).toHaveLength(items.length);
    });

    it("returns all items for whitespace-only query", () => {
      const results = fuzzySearchItems(items, "   ", { keys });
      expect(results).toHaveLength(items.length);
    });
  });

  describe("multi-tone character support", () => {
    it("matches multi-tone character with correct pinyin", () => {
      const toneItems = [{ name: "长大成人" }, { name: "长度测量" }];
      const results = fuzzySearchItems(toneItems, "chang", { keys });
      expect(results.map((r) => r.name)).toContain("长度测量");
    });
  });
});

describe("fuzzyMatches with pinyin", () => {
  it("returns true for pinyin match", () => {
    expect(fuzzyMatches({ name: "网页设计" }, "wangye", { keys: [(i) => i.name] })).toBe(true);
  });

  it("returns true for abbreviation match", () => {
    expect(fuzzyMatches({ name: "网页设计" }, "wy", { keys: [(i) => i.name] })).toBe(true);
  });

  it("returns false for non-matching pinyin", () => {
    expect(fuzzyMatches({ name: "网页设计" }, "zzz", { keys: [(i) => i.name] })).toBe(false);
  });

  it("returns true for Chinese direct match", () => {
    expect(fuzzyMatches({ name: "网页设计" }, "网页", { keys: [(i) => i.name] })).toBe(true);
  });
});

describe("filterFuzzyTree with pinyin", () => {
  type TreeNode = { name: string; children: TreeNode[] };

  const tree: TreeNode[] = [
    {
      name: "素材库",
      children: [
        { name: "网页设计", children: [] },
        { name: "文档管理", children: [] },
      ],
    },
    {
      name: "教程",
      children: [{ name: "视频教程", children: [] }],
    },
  ];

  const opts = {
    keys: [(item: TreeNode) => item.name],
    getChildren: (item: TreeNode) => item.children,
    setChildren: (item: TreeNode, children: TreeNode[]) => ({ ...item, children }),
  };

  it("matches parent node by pinyin", () => {
    const results = filterFuzzyTree(tree, "sucai", opts);
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("素材库");
  });

  it("matches child node by pinyin and keeps parent", () => {
    const results = filterFuzzyTree(tree, "wangye", opts);
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("素材库");
    expect(results[0]?.children).toHaveLength(1);
    expect(results[0]?.children[0]?.name).toBe("网页设计");
  });

  it("matches child by abbreviation and keeps parent", () => {
    const results = filterFuzzyTree(tree, "sp", opts);
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("教程");
    expect(results[0]?.children[0]?.name).toBe("视频教程");
  });

  it("returns empty when no pinyin match in tree", () => {
    const results = filterFuzzyTree(tree, "zzzzz", opts);
    expect(results).toHaveLength(0);
  });
});
