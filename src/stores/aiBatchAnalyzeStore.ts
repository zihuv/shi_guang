import { create } from "zustand";
import { toast } from "sonner";
import {
  cancelAiMetadataTask as cancelAiMetadataTaskCommand,
  getAiMetadataTask,
  startAiMetadataTask,
} from "@/services/desktop/files";
import {
  TERMINAL_AI_METADATA_TASK_STATUSES,
  type AiMetadataTaskSnapshot,
} from "@/stores/fileTypes";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { useTagStore } from "@/stores/tagStore";
import { listenDesktop } from "@/services/desktop/core";

interface AiBatchAnalyzeStore {
  aiMetadataTask: AiMetadataTaskSnapshot | null;
  setAiMetadataTask: (task: AiMetadataTaskSnapshot | null) => void;
  startBatchAnalyze: (fileIds: number[]) => Promise<AiMetadataTaskSnapshot | null>;
  cancelBatchAnalyze: () => Promise<void>;
}

async function waitForAiMetadataTask(
  taskId: string,
  onUpdate: (task: AiMetadataTaskSnapshot) => void,
) {
  let unlisten: (() => void) | null = null;
  let fallbackTimer: ReturnType<typeof setInterval> | null = null;
  let isSettled = false;
  let isRefreshing = false;
  let needsRefresh = false;

  return await new Promise<AiMetadataTaskSnapshot>((resolve, reject) => {
    const cleanup = () => {
      if (fallbackTimer) {
        clearInterval(fallbackTimer);
        fallbackTimer = null;
      }
      if (unlisten) {
        unlisten();
        unlisten = null;
      }
    };

    const finish = (snapshot: AiMetadataTaskSnapshot) => {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      resolve(snapshot);
    };

    const fail = (error: unknown) => {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      reject(error);
    };

    const refreshSnapshot = async () => {
      if (isSettled) return;
      if (isRefreshing) {
        needsRefresh = true;
        return;
      }

      isRefreshing = true;
      try {
        const snapshot = await getAiMetadataTask(taskId);
        onUpdate(snapshot);
        if (TERMINAL_AI_METADATA_TASK_STATUSES.has(snapshot.status)) {
          finish(snapshot);
        }
      } catch (error) {
        fail(error);
      } finally {
        isRefreshing = false;
        if (needsRefresh && !isSettled) {
          needsRefresh = false;
          void refreshSnapshot();
        }
      }
    };

    fallbackTimer = setInterval(() => {
      void refreshSnapshot();
    }, 1000);

    void listenDesktop<string>("ai-metadata-task-updated", (event) => {
      if (event.payload !== taskId || isSettled) return;
      void refreshSnapshot();
    })
      .then((dispose) => {
        if (isSettled) {
          dispose();
          return;
        }
        unlisten = dispose;
      })
      .catch(() => {
        // Keep fallback timer when event subscription fails.
      });

    void refreshSnapshot();
  });
}

async function finalizeAiMetadataTask(
  task: AiMetadataTaskSnapshot,
  setAiMetadataTask: (task: AiMetadataTaskSnapshot | null) => void,
) {
  if (task.successCount > 0 || task.processed > 0) {
    const libraryStore = useLibraryQueryStore.getState();
    await Promise.all([
      libraryStore.runCurrentQuery(libraryStore.selectedFolderId),
      useTagStore.getState().loadTags(),
    ]);
  }

  const firstFailure = task.results.find(
    (result) => result.status === "failed" && result.error,
  )?.error;

  if (task.status === "completed") {
    toast.success(`AI 分析完成：成功 ${task.successCount} 张`);
  } else if (task.status === "completed_with_errors") {
    const summary = `AI 分析完成：成功 ${task.successCount} 张，失败 ${task.failureCount} 张`;
    toast.error(firstFailure ? `${summary}。首个错误：${firstFailure}` : summary);
  } else if (task.status === "cancelled") {
    toast.error(`AI 分析已取消：已完成 ${task.processed}/${task.total}`);
  } else if (task.status === "failed") {
    toast.error(firstFailure ? `AI 分析失败：${firstFailure}` : "AI 分析失败");
  }

  setAiMetadataTask(null);
}

export const useAiBatchAnalyzeStore = create<AiBatchAnalyzeStore>((set, get) => ({
  aiMetadataTask: null,

  setAiMetadataTask: (task) => set({ aiMetadataTask: task }),

  startBatchAnalyze: async (fileIds) => {
    const uniqueFileIds = [...new Set(fileIds)].filter((fileId) => Number.isFinite(fileId));
    if (uniqueFileIds.length === 0) {
      toast.error("没有可执行 AI 分析的图片");
      return null;
    }

    const currentTask = get().aiMetadataTask;
    if (currentTask && !TERMINAL_AI_METADATA_TASK_STATUSES.has(currentTask.status)) {
      toast.error("已有 AI 批量分析任务正在进行");
      return null;
    }

    try {
      const task = await startAiMetadataTask(uniqueFileIds);
      set({ aiMetadataTask: task });

      void waitForAiMetadataTask(task.id, (nextTask) => {
        set({ aiMetadataTask: nextTask });
      })
        .then((finalTask) =>
          finalizeAiMetadataTask(finalTask, (nextTask) => set({ aiMetadataTask: nextTask })),
        )
        .catch((error) => {
          console.error("Failed to track AI metadata task:", error);
          set({ aiMetadataTask: null });
          toast.error("AI 批量分析任务状态同步失败");
        });

      return task;
    } catch (error) {
      console.error("Failed to start AI metadata task:", error);
      toast.error(`启动 AI 批量分析失败: ${String(error)}`);
      set({ aiMetadataTask: null });
      return null;
    }
  },

  cancelBatchAnalyze: async () => {
    const task = get().aiMetadataTask;
    if (!task || TERMINAL_AI_METADATA_TASK_STATUSES.has(task.status)) {
      return;
    }

    try {
      await cancelAiMetadataTaskCommand(task.id);
    } catch (error) {
      console.error("Failed to cancel AI metadata task:", error);
      toast.error("取消 AI 分析任务失败");
    }
  },
}));
