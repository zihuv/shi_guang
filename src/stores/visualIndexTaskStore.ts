import { create } from "zustand";
import { toast } from "sonner";
import {
  cancelVisualIndexTask as cancelVisualIndexTaskCommand,
  getVisualIndexTask,
  startVisualIndexTask as startVisualIndexTaskCommand,
} from "@/services/desktop/files";
import { getErrorMessage } from "@/services/desktop/core";
import {
  TERMINAL_VISUAL_INDEX_TASK_STATUSES,
  type VisualIndexTaskSnapshot,
} from "@/stores/fileTypes";
import { useSettingsStore } from "@/stores/settingsStore";
import { waitForDesktopTask } from "@/stores/taskWatcher";

const VISUAL_INDEX_TASK_EVENT = "visual-index-task-updated";

interface VisualIndexTaskStore {
  visualIndexTask: VisualIndexTaskSnapshot | null;
  setVisualIndexTask: (task: VisualIndexTaskSnapshot | null) => void;
  startVisualIndexTask: (processUnindexedOnly: boolean) => Promise<VisualIndexTaskSnapshot | null>;
  cancelVisualIndexTask: () => Promise<void>;
}

async function finalizeVisualIndexTask(
  task: VisualIndexTaskSnapshot,
  setVisualIndexTask: (task: VisualIndexTaskSnapshot | null) => void,
) {
  await useSettingsStore.getState().refreshVisualSearchStatus();

  const taskLabel = task.processUnindexedOnly ? "未索引图片处理" : "视觉索引";

  if (task.status === "completed") {
    toast.success(`${taskLabel}完成：成功 ${task.indexedCount} 张`);
  } else if (task.status === "completed_with_errors") {
    toast.error(`${taskLabel}完成：成功 ${task.indexedCount} 张，失败 ${task.failureCount} 张`);
  } else if (task.status === "cancelled") {
    toast.error(`${taskLabel}已取消：已完成 ${task.processed}/${task.total}`);
  } else if (task.status === "failed") {
    toast.error(`${taskLabel}失败`);
  }

  setVisualIndexTask(null);
}

export const useVisualIndexTaskStore = create<VisualIndexTaskStore>((set, get) => ({
  visualIndexTask: null,

  setVisualIndexTask: (task) => set({ visualIndexTask: task }),

  startVisualIndexTask: async (processUnindexedOnly) => {
    const currentTask = get().visualIndexTask;
    if (currentTask && !TERMINAL_VISUAL_INDEX_TASK_STATUSES.has(currentTask.status)) {
      toast.error("已有视觉索引任务正在进行");
      return null;
    }

    try {
      const task = await startVisualIndexTaskCommand(processUnindexedOnly);
      set({ visualIndexTask: task });
      let runtimeStatusRefreshed = false;

      void waitForDesktopTask({
        eventChannel: VISUAL_INDEX_TASK_EVENT,
        getSnapshot: getVisualIndexTask,
        isTerminal: (status) => TERMINAL_VISUAL_INDEX_TASK_STATUSES.has(status),
        onUpdate: (nextTask) => {
          set({ visualIndexTask: nextTask });
          if (!runtimeStatusRefreshed && nextTask.processed > 0) {
            runtimeStatusRefreshed = true;
            void useSettingsStore.getState().refreshVisualSearchStatus();
          }
        },
        taskId: task.id,
      })
        .then((finalTask) =>
          finalizeVisualIndexTask(finalTask, (nextTask) => set({ visualIndexTask: nextTask })),
        )
        .catch(async (error) => {
          console.error("Failed to track visual index task:", error);
          set({ visualIndexTask: null });
          await useSettingsStore.getState().refreshVisualSearchStatus();
          toast.error(`视觉索引任务状态同步失败: ${getErrorMessage(error)}`);
        });

      return task;
    } catch (error) {
      console.error("Failed to start visual index task:", error);
      set({ visualIndexTask: null });
      toast.error(`启动视觉索引失败: ${getErrorMessage(error)}`);
      return null;
    }
  },

  cancelVisualIndexTask: async () => {
    const task = get().visualIndexTask;
    if (!task || TERMINAL_VISUAL_INDEX_TASK_STATUSES.has(task.status)) {
      return;
    }

    try {
      await cancelVisualIndexTaskCommand(task.id);
    } catch (error) {
      console.error("Failed to cancel visual index task:", error);
      toast.error(`取消视觉索引任务失败: ${getErrorMessage(error)}`);
    }
  },
}));
