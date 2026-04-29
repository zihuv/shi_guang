import { describe, expect, it, vi } from "vitest";
import {
  AutoAiMetadataScheduler,
  type AutoAiMetadataSchedulerDependencies,
} from "../commands/auto-ai-metadata-scheduler";
import type { AppState, FileRecord } from "../types";

function file(id: number, ext = "jpg"): FileRecord {
  return {
    id,
    path: `/tmp/${id}.${ext}`,
    name: `${id}.${ext}`,
    ext,
    size: 1,
    width: 1,
    height: 1,
    folderId: null,
    createdAt: "",
    modifiedAt: "",
    importedAt: "",
    lastAccessedAt: null,
    rating: 0,
    description: "",
    sourceUrl: "",
    dominantColor: "",
    colorDistribution: "[]",
    thumbHash: "",
    contentHash: null,
    tags: [],
    deletedAt: null,
    missingAt: null,
  };
}

function createScheduler(overrides: Partial<AutoAiMetadataSchedulerDependencies> = {}) {
  let pendingCallback: (() => void) | null = null;
  const startTask = vi.fn();
  const clearTimeoutMock = vi.fn();
  const deps = {
    debounceMs: 10,
    setTimeout: (callback: () => void) => {
      pendingCallback = callback;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: clearTimeoutMock,
    canAnalyzeFile: (candidate: FileRecord) => candidate.ext === "jpg",
    shouldStart: () => true,
    startTask,
    logWarn: vi.fn(),
    ...overrides,
  };
  const scheduler = new AutoAiMetadataScheduler(deps);

  return {
    clearTimeoutMock,
    flushTimer: () => pendingCallback?.(),
    scheduler,
    startTask: deps.startTask,
    state: {} as AppState,
  };
}

describe("AutoAiMetadataScheduler", () => {
  it("batches analyzable imports and debounces timer resets", () => {
    const { clearTimeoutMock, flushTimer, scheduler, startTask, state } = createScheduler();

    scheduler.schedule(state, null, file(1), { source: "import_task" });
    scheduler.schedule(state, null, file(2), { source: "collector" });
    flushTimer();

    expect(clearTimeoutMock).toHaveBeenCalledOnce();
    expect(startTask).toHaveBeenCalledWith(state, null, [1, 2]);
  });

  it("skips unsupported files and non-import analysis contexts", () => {
    const { flushTimer, scheduler, startTask, state } = createScheduler();

    scheduler.schedule(state, null, file(1, "psd"), { source: "import_task" });
    scheduler.schedule(state, null, file(2), { source: "library_sync" });
    scheduler.schedule(state, null, file(3), { source: "restore" });
    flushTimer();

    expect(startTask).not.toHaveBeenCalled();
  });

  it("keeps queued file ids when starting the task throws", () => {
    let shouldThrow = true;
    const logWarn = vi.fn();
    const { flushTimer, scheduler, startTask, state } = createScheduler({
      logWarn,
      startTask: vi.fn(() => {
        if (shouldThrow) {
          throw new Error("boom");
        }
      }),
    });

    scheduler.schedule(state, null, file(1), { source: "collector" });
    flushTimer();
    shouldThrow = false;
    scheduler.schedule(state, null, file(2), { source: "collector" });
    flushTimer();

    expect(logWarn).toHaveBeenCalledOnce();
    expect(startTask).toHaveBeenLastCalledWith(state, null, [1, 2]);
  });
});
