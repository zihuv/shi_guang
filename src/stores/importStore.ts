import { listen } from "@tauri-apps/api/event"
import { create } from "zustand"
import {
  cancelImportTask as cancelImportTaskCommand,
  getImportTask,
  importFile as importFileCommand,
  importImageFromBase64 as importImageFromBase64Command,
  startImportTask,
} from "@/services/tauri/files"
import {
  parseFileList,
  TERMINAL_IMPORT_TASK_STATUSES,
  type FileItem,
  type ImportTaskSnapshot,
} from "@/stores/fileTypes"
import { useFolderStore } from "@/stores/folderStore"
import { useLibraryQueryStore } from "@/stores/libraryQueryStore"

interface ImportStore {
  importTask: ImportTaskSnapshot | null
  setImportTask: (task: ImportTaskSnapshot | null) => void
  importFile: (
    sourcePath: string,
    refresh?: boolean,
    targetFolderId?: number | null,
  ) => Promise<FileItem | null>
  importFiles: (
    sourcePaths: string[],
    targetFolderId?: number | null,
  ) => Promise<FileItem[]>
  importImageFromBase64: (
    base64Data: string,
    ext: string,
    refresh?: boolean,
    targetFolderId?: number | null,
  ) => Promise<FileItem | null>
  importImagesFromBase64: (
    items: { base64Data: string; ext: string }[],
    targetFolderId?: number | null,
  ) => Promise<FileItem[]>
  cancelImportTask: () => Promise<void>
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForImportTask(
  taskId: string,
  onUpdate: (task: ImportTaskSnapshot) => void,
) {
  let unlisten: (() => void) | null = null
  let fallbackTimer: ReturnType<typeof setInterval> | null = null
  let isSettled = false
  let isRefreshing = false
  let needsRefresh = false

  return await new Promise<ImportTaskSnapshot>((resolve, reject) => {
    const cleanup = () => {
      if (fallbackTimer) {
        clearInterval(fallbackTimer)
        fallbackTimer = null
      }
      if (unlisten) {
        unlisten()
        unlisten = null
      }
    }

    const finish = (snapshot: ImportTaskSnapshot) => {
      if (isSettled) return
      isSettled = true
      cleanup()
      resolve(snapshot)
    }

    const fail = (error: unknown) => {
      if (isSettled) return
      isSettled = true
      cleanup()
      reject(error)
    }

    const refreshSnapshot = async () => {
      if (isSettled) return
      if (isRefreshing) {
        needsRefresh = true
        return
      }

      isRefreshing = true
      try {
        const snapshot = await getImportTask(taskId)
        onUpdate(snapshot)
        if (TERMINAL_IMPORT_TASK_STATUSES.has(snapshot.status)) {
          finish(snapshot)
        }
      } catch (error) {
        fail(error)
      } finally {
        isRefreshing = false
        if (needsRefresh && !isSettled) {
          needsRefresh = false
          void refreshSnapshot()
        }
      }
    }

    fallbackTimer = setInterval(() => {
      void refreshSnapshot()
    }, 1000)

    void listen<string>("import-task-updated", (event) => {
      if (event.payload !== taskId || isSettled) return
      void refreshSnapshot()
    })
      .then((dispose) => {
        if (isSettled) {
          dispose()
          return
        }
        unlisten = dispose
      })
      .catch(() => {
        // Keep fallback timer when event subscription fails.
      })

    void refreshSnapshot()
  })
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
  )

  await delay(0)
  await useLibraryQueryStore.getState().loadFilesInFolder(selectedFolderId)
  await useFolderStore.getState().loadFolders()
  setImportTask(null)
  return results
}

export const useImportStore = create<ImportStore>((set, get) => ({
  importTask: null,

  setImportTask: (task) => set({ importTask: task }),

  importFile: async (sourcePath, refresh = true, targetFolderId) => {
    const selectedFolderId =
      targetFolderId !== undefined
        ? targetFolderId
        : useLibraryQueryStore.getState().selectedFolderId

    try {
      const file = await importFileCommand({
        sourcePath,
        folderId: selectedFolderId,
      })

      if (refresh) {
        await useLibraryQueryStore.getState().loadFilesInFolder(selectedFolderId)
        await useFolderStore.getState().loadFolders()
      }

      return file
    } catch (error) {
      console.error("Failed to import file:", error)
      return null
    }
  },

  importFiles: async (sourcePaths, targetFolderId) => {
    if (sourcePaths.length === 0) return []

    const selectedFolderId =
      targetFolderId !== undefined
        ? targetFolderId
        : useLibraryQueryStore.getState().selectedFolderId

    try {
      const task = await startImportTask({
        items: sourcePaths.map((path) => ({ kind: "file_path", path })),
        folderId: selectedFolderId,
      })
      set({ importTask: task })

      const currentTask = await waitForImportTask(task.id, (nextTask) => {
        set({ importTask: nextTask })
      })

      return await finalizeImportTask(
        currentTask,
        (nextTask) => set({ importTask: nextTask }),
        selectedFolderId,
      )
    } catch (error) {
      console.error("Failed to import files:", error)
      set({ importTask: null })
      return []
    }
  },

  importImageFromBase64: async (base64Data, ext, refresh = true, targetFolderId) => {
    const selectedFolderId =
      targetFolderId !== undefined
        ? targetFolderId
        : useLibraryQueryStore.getState().selectedFolderId

    try {
      const file = await importImageFromBase64Command({
        base64Data,
        ext,
        folderId: selectedFolderId,
      })

      if (refresh) {
        await useLibraryQueryStore.getState().loadFilesInFolder(selectedFolderId)
        await useFolderStore.getState().loadFolders()
      }

      return file
    } catch (error) {
      console.error("Failed to import image from clipboard:", error)
      return null
    }
  },

  importImagesFromBase64: async (items, targetFolderId) => {
    if (items.length === 0) return []

    const selectedFolderId =
      targetFolderId !== undefined
        ? targetFolderId
        : useLibraryQueryStore.getState().selectedFolderId

    try {
      const task = await startImportTask({
        items: items.map((item) => ({
          kind: "base64_image",
          base64Data: item.base64Data,
          ext: item.ext,
        })),
        folderId: selectedFolderId,
      })
      set({ importTask: task })

      const currentTask = await waitForImportTask(task.id, (nextTask) => {
        set({ importTask: nextTask })
      })

      return await finalizeImportTask(
        currentTask,
        (nextTask) => set({ importTask: nextTask }),
        selectedFolderId,
      )
    } catch (error) {
      console.error("Failed to import images:", error)
      set({ importTask: null })
      return []
    }
  },

  cancelImportTask: async () => {
    const task = get().importTask
    if (!task || TERMINAL_IMPORT_TASK_STATUSES.has(task.status)) {
      return
    }

    await cancelImportTaskCommand(task.id)
  },
}))

