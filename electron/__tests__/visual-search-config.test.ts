import { describe, expect, it } from "vitest";

import {
  getVisualSearchEmbeddingConfigKey,
  isVisualSearchEmbeddingConfigChanged,
  resolveVisualSearchConfig,
} from "../visual-search/config";

function visualSearchSetting(value: Record<string, unknown>): string {
  return JSON.stringify({
    enabled: true,
    modelPath: "/models/a",
    runtime: {
      device: "cpu",
      providerPolicy: "interactive",
      intraThreads: 4,
      fgclipMaxPatches: 256,
    },
    ...value,
  });
}

describe("visual search embedding config", () => {
  it("changes when the model path or embedding-affecting runtime changes", () => {
    expect(
      isVisualSearchEmbeddingConfigChanged(
        visualSearchSetting({ modelPath: "/models/a" }),
        visualSearchSetting({ modelPath: "/models/b" }),
      ),
    ).toBe(true);

    expect(
      isVisualSearchEmbeddingConfigChanged(
        visualSearchSetting({ runtime: { fgclipMaxPatches: 256 } }),
        visualSearchSetting({ runtime: { fgclipMaxPatches: 512 } }),
      ),
    ).toBe(true);
  });

  it("ignores runtime choices that do not change embedding semantics", () => {
    expect(
      isVisualSearchEmbeddingConfigChanged(
        visualSearchSetting({
          runtime: {
            device: "cpu",
            providerPolicy: "interactive",
            intraThreads: 4,
            fgclipMaxPatches: 256,
          },
        }),
        visualSearchSetting({
          runtime: {
            device: "gpu",
            providerPolicy: "service",
            intraThreads: 8,
            fgclipMaxPatches: 256,
          },
        }),
      ),
    ).toBe(false);
  });

  it("normalizes equivalent model path spelling", () => {
    expect(
      getVisualSearchEmbeddingConfigKey(resolveVisualSearchConfig(visualSearchSetting({}))),
    ).toBe(
      getVisualSearchEmbeddingConfigKey(
        resolveVisualSearchConfig(visualSearchSetting({ modelPath: '"/models/a"' })),
      ),
    );
  });
});
