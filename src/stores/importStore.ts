import { create } from "zustand";
import {
  cancelImportTask as cancelImportTaskCommand,
  getImportTask,
  startImportTask,
} from "@/services/desktop/files";
import {
  parseFileList,
  TERMINAL_IMPORT_TASK_STATUSES,
  type BinaryImageImportItem,
  type FileItem,
  type ImportTaskSnapshot,
} from "@/stores/fileTypes";
import { useFolderStore } from "@/stores/folderStore";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { useSmartCollectionStore } from "@/stores/smartCollectionStore";
import { waitForDesktopTask } from "@/stores/taskWatcher";

interface ImportStore {
  importTask: ImportTaskSnapshot | null;
  setImportTask: (task: ImportTaskSnapshot | null) => void;
  importFile: (
    sourcePath: string,
    refresh?: boolean,
    targetFolderId?: number | null,
  ) => Promise<FileItem | null>;
  importFiles: (sourcePaths: string[], targetFolderId?: number | null) => Promise<FileItem[]>;
  importImageFromBase64: (
    base64Data: string,
    ext: string,
    refresh?: boolean,
    targetFolderId?: number | null,
  ) => Promise<FileItem | null>;
  importImagesFromBase64: (
    items: { base64Data: string; ext: string }[],
    targetFolderId?: number | null,
  ) => Promise<FileItem[]>;
  importBinaryImage: (
    bytes: Uint8Array,
    ext: string,
    refresh?: boolean,
    targetFolderId?: number | null,
  ) => Promise<FileItem | null>;
  importBinaryImages: (
    items: BinaryImageImportItem[],
    targetFolderId?: number | null,
  ) => Promise<FileItem[]>;
  cancelImportTask: () => Promise<void>;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function decodeBase64ToBytes(base64Data: string) {
  return Uint8Array.from(atob(base64Data), (char) => char.charCodeAt(0));
}

function toImportTaskItem(item: BinaryImageImportItem) {
  if (item.sourcePath) {
    return {
      kind: "clipboard_file",
      sourcePath: item.sourcePath,
      ext: item.ext,
      rating: item.rating,
      description: item.description,
      sourceUrl: item.sourceUrl,
      tagIds: item.tagIds,
    };
  }

  return {
    kind: "binary_image",
    bytes: item.bytes ?? new Uint8Array(),
    ext: item.ext,
    rating: item.rating,
    description: item.description,
    sourceUrl: item.sourceUrl,
    tagIds: item.tagIds,
  };
}

async function finalizeImportTask(
  task: ImportTaskSnapshot,
  setImportTask: (task: ImportTaskSnapshot | null) => void,
  selectedFolderId: number | null,
) {
  const results = parseFileList(
    task.results
      .filter((result) => result.status === "completed" && result.file)
      .map((result) => result.file as FileItem),
  );

  await delay(0);
  await useLibraryQueryStore.getState().loadFilesInFolder(selectedFolderId);
  await useFolderStore.getState().loadFolders();
  await useSmartCollectionStore.getState().loadStats();
  setImportTask(null);
  return results;
}

export const useImportStore = create<ImportStore>((set, get) => ({
  importTask: null,

  setImportTask: (task) => set({ importTask: task }),

  importFile: async (sourcePath, refresh = true, targetFolderId) => {
    const files = await get().importFiles([sourcePath], targetFolderId);
    if (!refresh && files.length > 0) {
      return files[0];
    }
    return files[0] ?? null;
  },

  importFiles: async (sourcePaths, targetFolderId) => {
    if (sourcePaths.length === 0) return [];

    const selectedFolderId =
      targetFolderId !== undefined
        ? targetFolderId
        : useLibraryQueryStore.getState().selectedFolderId;

    try {
      const task = await startImportTask({
        items: sourcePaths.map((path) => ({ kind: "file_path", path })),
        folderId: selectedFolderId,
      });
      set({ importTask: task });

      const currentTask = await waitForDesktopTask({
        eventChannel: "import-task-updated",
        getSnapshot: getImportTask,
        isTerminal: (status) => TERMINAL_IMPORT_TASK_STATUSES.has(status),
        onUpdate: (nextTask) => set({ importTask: nextTask }),
        taskId: task.id,
      });

      return await finalizeImportTask(
        currentTask,
        (nextTask) => set({ importTask: nextTask }),
        selectedFolderId,
      );
    } catch (error) {
      console.error("Failed to import files:", error);
      set({ importTask: null });
      return [];
    }
  },

  importImageFromBase64: async (base64Data, ext, refresh = true, targetFolderId) => {
    const files = await get().importBinaryImages(
      [{ bytes: decodeBase64ToBytes(base64Data), ext }],
      targetFolderId,
    );
    if (!refresh && files.length > 0) {
      return files[0];
    }
    return files[0] ?? null;
  },

  importImagesFromBase64: async (items, targetFolderId) => {
    return get().importBinaryImages(
      items.map((item) => ({
        bytes: decodeBase64ToBytes(item.base64Data),
        ext: item.ext,
      })),
      targetFolderId,
    );
  },

  importBinaryImage: async (bytes, ext, refresh = true, targetFolderId) => {
    const files = await get().importBinaryImages([{ bytes, ext }], targetFolderId);
    if (!refresh && files.length > 0) {
      return files[0];
    }
    return files[0] ?? null;
  },

  importBinaryImages: async (items, targetFolderId) => {
    if (items.length === 0) return [];

    const selectedFolderId =
      targetFolderId !== undefined
        ? targetFolderId
        : useLibraryQueryStore.getState().selectedFolderId;

    try {
      const task = await startImportTask({
        items: items.map(toImportTaskItem),
        folderId: selectedFolderId,
      });
      set({ importTask: task });

      const currentTask = await waitForDesktopTask({
        eventChannel: "import-task-updated",
        getSnapshot: getImportTask,
        isTerminal: (status) => TERMINAL_IMPORT_TASK_STATUSES.has(status),
        onUpdate: (nextTask) => set({ importTask: nextTask }),
        taskId: task.id,
      });

      return await finalizeImportTask(
        currentTask,
        (nextTask) => set({ importTask: nextTask }),
        selectedFolderId,
      );
    } catch (error) {
      console.error("Failed to import images:", error);
      set({ importTask: null });
      return [];
    }
  },

  cancelImportTask: async () => {
    const task = get().importTask;
    if (!task || TERMINAL_IMPORT_TASK_STATUSES.has(task.status)) {
      return;
    }

    await cancelImportTaskCommand(task.id);
  },
}));
