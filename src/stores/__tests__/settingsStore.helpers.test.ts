import { describe, expect, it } from "vitest";
import {
  clampAiBatchAnalyzeConcurrency,
  clampDetailPanelWidth,
  clampLibraryViewScale,
  clampPreviewTrackpadZoomSpeed,
  clampSidebarWidth,
  DEFAULT_AI_CONFIG,
  DEFAULT_LIBRARY_VISIBLE_FIELDS,
  DEFAULT_VISUAL_SEARCH_CONFIG,
  resolveAiConfig,
  resolveLibraryViewScales,
  resolveLibraryVisibleFields,
  resolveVisualSearchConfig,
} from "@/stores/settingsStore.helpers";

describe("settingsStore helpers", () => {
  it("clamps numeric settings into supported ranges", () => {
    expect(clampPreviewTrackpadZoomSpeed(Number.NaN)).toBe(1);
    expect(clampPreviewTrackpadZoomSpeed(0.26)).toBe(0.3);
    expect(clampPreviewTrackpadZoomSpeed(10)).toBe(3);

    expect(clampAiBatchAnalyzeConcurrency(-1)).toBe(1);
    expect(clampAiBatchAnalyzeConcurrency(3.4)).toBe(3);
    expect(clampAiBatchAnalyzeConcurrency(99)).toBe(5);

    expect(clampLibraryViewScale("grid", 0.37)).toBe(0.5);
    expect(clampLibraryViewScale("list", 0.8)).toBe(0.82);
    expect(clampLibraryViewScale("adaptive", 1.234)).toBe(1.24);

    expect(clampSidebarWidth(88)).toBe(120);
    expect(clampSidebarWidth(512)).toBe(420);
    expect(clampDetailPanelWidth(120)).toBe(160);
    expect(clampDetailPanelWidth(999)).toBe(560);
  });

  it("keeps grid and adaptive scales in sync when resolving view preferences", () => {
    expect(resolveLibraryViewScales()).toEqual({
      grid: 1,
      list: 1,
      adaptive: 1,
    });

    expect(
      resolveLibraryViewScales({
        grid: 1.33,
        adaptive: 0.75,
        list: 1.18,
      }),
    ).toEqual({
      grid: 1.34,
      list: 1.18,
      adaptive: 1.34,
    });

    expect(
      resolveLibraryViewScales({
        adaptive: 0.68,
        list: 9,
      }),
    ).toEqual({
      grid: 0.68,
      list: 1.8,
      adaptive: 0.68,
    });
  });

  it("backfills tags for legacy visible-field payloads but preserves current versions", () => {
    expect(resolveLibraryVisibleFields("invalid")).toEqual(DEFAULT_LIBRARY_VISIBLE_FIELDS);

    expect(resolveLibraryVisibleFields(["name", "size"], 1)).toEqual(["name", "size", "tags"]);
    expect(resolveLibraryVisibleFields(["name", "size"], 2)).toEqual(["name", "size"]);
  });

  it("normalizes legacy ai config payloads into the metadata target", () => {
    expect(resolveAiConfig(null)).toEqual(DEFAULT_AI_CONFIG);

    expect(
      resolveAiConfig({
        baseUrl: "https://legacy.example/v1",
        apiKey: "legacy-key",
        multimodalModel: "gpt-4.1-mini",
      }),
    ).toEqual({
      metadata: {
        baseUrl: "https://legacy.example/v1",
        apiKey: "legacy-key",
        model: "gpt-4.1-mini",
      },
    });

    expect(
      resolveAiConfig({
        metadata: {
          baseUrl: "https://service.example/v1",
          apiKey: "service-key",
          model: "gpt-5.4",
        },
        apiKey: "ignored-legacy-key",
      }),
    ).toEqual({
      metadata: {
        baseUrl: "https://service.example/v1",
        apiKey: "service-key",
        model: "gpt-5.4",
      },
    });
  });

  it("normalizes visual search config and rejects unsupported runtime values", () => {
    expect(resolveVisualSearchConfig(null)).toEqual(DEFAULT_VISUAL_SEARCH_CONFIG);

    expect(
      resolveVisualSearchConfig({
        enabled: true,
        modelPath: "/models/clip.onnx",
        autoVectorizeOnImport: true,
        processUnindexedOnly: false,
        runtime: {
          device: "gpu",
          providerPolicy: "service",
          intraThreads: "8",
          fgclipMaxPatches: 576,
        },
      }),
    ).toEqual({
      enabled: true,
      modelPath: "/models/clip.onnx",
      autoVectorizeOnImport: true,
      processUnindexedOnly: false,
      runtime: {
        device: "gpu",
        providerPolicy: "service",
        intraThreads: 8,
        fgclipMaxPatches: 576,
      },
    });

    expect(
      resolveVisualSearchConfig({
        runtime: {
          device: "tpu",
          providerPolicy: "background",
          intraThreads: 0,
          fgclipMaxPatches: 123,
        },
      }),
    ).toEqual({
      enabled: false,
      modelPath: "",
      autoVectorizeOnImport: false,
      processUnindexedOnly: true,
      runtime: {
        device: "cpu",
        providerPolicy: "interactive",
        intraThreads: 4,
        fgclipMaxPatches: 256,
      },
    });
  });

  it("preserves explicit fg-clip patch default opt-out", () => {
    expect(
      resolveVisualSearchConfig({
        runtime: {
          fgclipMaxPatches: null,
        },
      }),
    ).toEqual({
      enabled: false,
      modelPath: "",
      autoVectorizeOnImport: false,
      processUnindexedOnly: true,
      runtime: {
        device: "cpu",
        providerPolicy: "interactive",
        intraThreads: 4,
        fgclipMaxPatches: null,
      },
    });
  });
});
