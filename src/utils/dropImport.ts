import { getDesktopBridge } from "@/services/desktop/core";

export function isExternalFileDrag(dataTransfer: DataTransfer | null | undefined) {
  return Boolean(dataTransfer && Array.from(dataTransfer.types).includes("Files"));
}

export function getDroppedFilePaths(dataTransfer: DataTransfer | null | undefined) {
  if (!dataTransfer) {
    return [];
  }

  const bridge = getDesktopBridge();
  const paths = Array.from(dataTransfer.files)
    .map((file) => {
      try {
        return bridge.file.getPathForFile(file).trim();
      } catch (error) {
        console.error("Failed to resolve dropped file path:", error);
        return "";
      }
    })
    .filter((path) => path.length > 0);

  return [...new Set(paths)];
}
