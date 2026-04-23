import { clipboard, contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";

const eventChannels = new Set([
  "file-imported",
  "file-import-error",
  "file-updated",
  "library-sync-updated",
  "library-sync-status",
  "import-task-updated",
  "ai-metadata-task-updated",
  "thumbnail-build-request",
  "visual-index-task-updated",
  "visual-index-browser-decode-request",
]);

contextBridge.exposeInMainWorld("shiguang", {
  invoke: (command: string, args?: Record<string, unknown>) =>
    ipcRenderer.invoke("shiguang:invoke", command, args ?? {}),
  on: (channel: string, callback: (payload: unknown) => void) => {
    if (!eventChannels.has(channel)) {
      throw new Error(`Unsupported event channel: ${channel}`);
    }
    const listener = (_event: IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  dialog: {
    open: (options: Electron.OpenDialogOptions) =>
      ipcRenderer.invoke("shiguang:dialog:open", options),
  },
  fs: {
    exists: (filePath: string) => ipcRenderer.invoke("shiguang:fs:exists", filePath),
    readFile: (filePath: string) => ipcRenderer.invoke("shiguang:fs:readFile", filePath),
    readTextFile: (filePath: string) => ipcRenderer.invoke("shiguang:fs:readTextFile", filePath),
  },
  file: {
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
  },
  clipboard: {
    readText: () => clipboard.readText(),
    writeText: (text: string) => clipboard.writeText(text),
    readImageData: () => {
      const image = clipboard.readImage();
      if (image.isEmpty()) {
        return null;
      }

      return {
        bytes: new Uint8Array(image.toPNG()),
        ext: "png",
      };
    },
  },
  asset: {
    toUrl: (filePath: string) => ipcRenderer.invoke("shiguang:asset:toUrl", filePath),
  },
  log: (level: string, message: string) => ipcRenderer.invoke("shiguang:log", level, message),
});
