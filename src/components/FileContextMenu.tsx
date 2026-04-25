import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { FileItem } from "@/stores/fileTypes";
import { useAiBatchAnalyzeStore } from "@/stores/aiBatchAnalyzeStore";
import { useFolderStore, FolderNode } from "@/stores/folderStore";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { useSelectionStore } from "@/stores/selectionStore";
import { useTrashStore } from "@/stores/trashStore";
import { copyFilesToClipboard } from "@/lib/clipboard";
import { openFile, showInExplorer } from "@/services/desktop/system";
import { buildAiImageDataUrl } from "@/utils";
import { Button } from "@/components/ui/Button";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "@/components/ui/ContextMenu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Copy, ExternalLink, FolderOpen, Move, ScanSearch, Sparkles, Trash2 } from "lucide-react";

const AI_IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "bmp",
  "gif",
  "tif",
  "tiff",
  "ico",
  "avif",
]);

interface BatchAnalyzeDialogState {
  existingFiles: FileItem[];
  freshFiles: FileItem[];
  skippedUnsupportedCount: number;
}

function canAnalyzeFileWithAi(file: FileItem) {
  return AI_IMAGE_EXTENSIONS.has(file.ext.toLowerCase());
}

function hasExistingAiMetadata(file: FileItem) {
  return file.tags.length > 0 || file.description.trim().length > 0;
}

function findActionFile(fileId: number, files: FileItem[], fallbackFile: FileItem) {
  return (
    files.find((candidate) => candidate.id === fileId) ??
    (fallbackFile.id === fileId ? fallbackFile : null)
  );
}

interface FileContextMenuProps {
  file: FileItem;
  children: ReactNode;
}

export default function FileContextMenu({ file, children }: FileContextMenuProps) {
  const deleteFile = useTrashStore((state) => state.deleteFile);
  const deleteFiles = useTrashStore((state) => state.deleteFiles);
  const setSelectedFile = useSelectionStore((state) => state.setSelectedFile);
  const selectedFiles = useSelectionStore((state) => state.selectedFiles);
  const files = useLibraryQueryStore((state) => state.files);
  const analyzeFileMetadata = useLibraryQueryStore((state) => state.analyzeFileMetadata);
  const searchSimilarToFile = useLibraryQueryStore((state) => state.searchSimilarToFile);
  const startBatchAnalyze = useAiBatchAnalyzeStore((state) => state.startBatchAnalyze);
  const moveFiles = useLibraryQueryStore((state) => state.moveFiles);
  const copyFiles = useLibraryQueryStore((state) => state.copyFiles);
  const { folders } = useFolderStore();
  const [frozenFileIds, setFrozenFileIds] = useState<number[] | null>(null);
  const [batchAnalyzeDialog, setBatchAnalyzeDialog] = useState<BatchAnalyzeDialogState | null>(
    null,
  );
  const [isSubmittingBatchAnalyze, setIsSubmittingBatchAnalyze] = useState(false);
  const frozenFileIdsRef = useRef<number[] | null>(null);
  const lastMenuActionRef = useRef<{ key: string; timestamp: number } | null>(null);
  const liveActiveFileIds = selectedFiles.includes(file.id) ? selectedFiles : [file.id];
  const activeFileIds = frozenFileIds ?? liveActiveFileIds;
  const activeFiles = activeFileIds
    .map((fileId) => findActionFile(fileId, files, file))
    .filter((candidate): candidate is FileItem => candidate !== null);
  const activeAnalyzableFiles = activeFiles.filter(canAnalyzeFileWithAi);
  const canAnalyzeWithAi = activeAnalyzableFiles.length > 0;
  const aiMenuLabel =
    activeAnalyzableFiles.length > 1 ? `AI 分析 ${activeAnalyzableFiles.length} 张图片` : "AI 分析";

  const snapshotActiveFileIds = () => {
    const { selectedFiles: latestSelectedFiles } = useSelectionStore.getState();
    const nextFileIds = latestSelectedFiles.includes(file.id)
      ? [...latestSelectedFiles]
      : [file.id];
    frozenFileIdsRef.current = nextFileIds;
    setFrozenFileIds(nextFileIds);
    console.log("[FileContextMenu] snapshotActiveFileIds", { fileId: file.id, nextFileIds });
    return nextFileIds;
  };

  const getActionFileIds = () => {
    if (frozenFileIdsRef.current && frozenFileIdsRef.current.length > 0) {
      return frozenFileIdsRef.current;
    }

    const { selectedFiles: latestSelectedFiles } = useSelectionStore.getState();
    return latestSelectedFiles.includes(file.id) ? [...latestSelectedFiles] : [file.id];
  };

  const clearActionFileIds = () => {
    frozenFileIdsRef.current = null;
    setFrozenFileIds(null);
    lastMenuActionRef.current = null;
  };

  const triggerMenuAction = (key: string, action: () => void | Promise<void>) => {
    const now = Date.now();
    const lastAction = lastMenuActionRef.current;
    if (lastAction && lastAction.key === key && now - lastAction.timestamp < 250) {
      return;
    }

    lastMenuActionRef.current = { key, timestamp: now };
    void action();
  };

  // Flatten folder tree for display in submenu
  const flattenFolders = (nodes: FolderNode[], depth = 0): FolderNode[] => {
    let result: FolderNode[] = [];
    for (const node of nodes) {
      result.push({ ...node, sortOrder: depth } as FolderNode);
      if (node.children && node.children.length > 0) {
        result = result.concat(flattenFolders(node.children, depth + 1));
      }
    }
    return result;
  };

  const flatFolders = flattenFolders(folders);

  // Open file with default application
  const handleOpenFile = async () => {
    try {
      await openFile(file.id);
    } catch (e) {
      console.error("Failed to open file:", e);
    }
  };

  // Open file in file explorer
  const handleShowInExplorer = async () => {
    try {
      await showInExplorer(file.id);
    } catch (e) {
      console.error("Failed to open directory:", e);
    }
  };

  const handleCopyFilesToClipboard = async () => {
    try {
      await copyFilesToClipboard(getActionFileIds());
    } catch (e) {
      console.error("Failed to copy files to clipboard:", e);
      toast.error(`复制到剪贴板失败: ${String(e)}`);
    }
  };

  const handleAnalyzeMetadata = async () => {
    const actionFiles = getActionFileIds()
      .map((fileId) => findActionFile(fileId, useLibraryQueryStore.getState().files, file))
      .filter((candidate): candidate is FileItem => candidate !== null);
    const analyzableFiles = actionFiles.filter(canAnalyzeFileWithAi);
    const skippedUnsupportedCount = Math.max(0, actionFiles.length - analyzableFiles.length);

    if (analyzableFiles.length === 0) {
      toast.error("当前仅支持对图片执行 AI 分析");
      return;
    }

    if (actionFiles.length === 1 && analyzableFiles.length === 1) {
      const loadingToast = toast.loading("AI 分析中...");
      try {
        const imageDataUrl = await buildAiImageDataUrl(analyzableFiles[0].path);
        await analyzeFileMetadata(analyzableFiles[0].id, imageDataUrl);
        toast.success("AI 已更新名称、标签和备注", { id: loadingToast });
      } catch (e) {
        console.error("Failed to analyze file metadata:", e);
        toast.error(`AI 分析失败: ${String(e)}`, { id: loadingToast });
      }
      return;
    }

    const existingFiles = analyzableFiles.filter(hasExistingAiMetadata);
    if (existingFiles.length > 0) {
      setBatchAnalyzeDialog({
        existingFiles,
        freshFiles: analyzableFiles.filter((candidate) => !hasExistingAiMetadata(candidate)),
        skippedUnsupportedCount,
      });
      return;
    }

    await runBatchAnalyze(analyzableFiles);
  };

  const handleSearchSimilar = async () => {
    try {
      await searchSimilarToFile({ id: file.id, name: file.name });
    } catch (e) {
      console.error("Failed to search similar images:", e);
      toast.error(`以图搜图失败: ${String(e)}`);
    }
  };

  const runBatchAnalyze = async (filesToAnalyze: FileItem[]) => {
    if (filesToAnalyze.length === 0) {
      toast.error("没有可执行 AI 分析的图片");
      return;
    }

    try {
      setIsSubmittingBatchAnalyze(true);
      await startBatchAnalyze(filesToAnalyze.map((candidate) => candidate.id));
    } catch (e) {
      console.error("Failed to start batch analyze file metadata:", e);
      toast.error(`启动 AI 分析失败: ${String(e)}`);
    } finally {
      setIsSubmittingBatchAnalyze(false);
    }
  };

  // Copy file to a folder
  const handleCopyFile = async (targetFolderId: number | null) => {
    try {
      await copyFiles(getActionFileIds(), targetFolderId);
    } catch (e) {
      console.error("Failed to copy file:", e);
      toast.error(`复制文件失败: ${String(e)}`);
    }
  };

  // Move file to a folder
  const handleMoveFile = async (targetFolderId: number | null) => {
    try {
      await moveFiles(getActionFileIds(), targetFolderId);
    } catch (e) {
      console.error("Failed to move file:", e);
      toast.error(`移动文件失败: ${String(e)}`);
    }
  };

  // Delete file
  const handleDeleteFile = async () => {
    try {
      const fileIds = getActionFileIds();

      if (fileIds.length > 1) {
        await deleteFiles(fileIds);
        return;
      }

      await deleteFile(fileIds[0] ?? file.id);
      setSelectedFile(null);
    } catch (e) {
      console.error("Failed to delete file:", e);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (open) {
      snapshotActiveFileIds();
      return;
    }

    clearActionFileIds();
  };

  return (
    <>
      <ContextMenu onOpenChange={handleOpenChange}>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            onSelect={() => triggerMenuAction("open", handleOpenFile)}
            onClick={() => triggerMenuAction("open", handleOpenFile)}
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            默认应用打开
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => triggerMenuAction("explorer", handleShowInExplorer)}
            onClick={() => triggerMenuAction("explorer", handleShowInExplorer)}
          >
            <FolderOpen className="w-4 h-4 mr-2" />
            在资源管理器中显示
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => triggerMenuAction("clipboard", handleCopyFilesToClipboard)}
            onClick={() => triggerMenuAction("clipboard", handleCopyFilesToClipboard)}
          >
            <Copy className="w-4 h-4 mr-2" />
            复制到剪贴板
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!canAnalyzeWithAi}
            onSelect={() => triggerMenuAction("ai", handleAnalyzeMetadata)}
            onClick={() => triggerMenuAction("ai", handleAnalyzeMetadata)}
          >
            <Sparkles className="w-4 h-4 mr-2" />
            {aiMenuLabel}
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => triggerMenuAction("search-similar", handleSearchSimilar)}
            onClick={() => triggerMenuAction("search-similar", handleSearchSimilar)}
          >
            <ScanSearch className="w-4 h-4 mr-2" />
            以图搜图
          </ContextMenuItem>
          <ContextMenuSeparator />

          {/* Copy to submenu */}
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Copy className="w-4 h-4 mr-2" />
              {activeFileIds.length > 1 ? `复制 ${activeFileIds.length} 个文件到` : "复制到"}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {flatFolders.length > 0 ? (
                flatFolders.map((folder) => (
                  <ContextMenuItem
                    key={folder.id}
                    onPointerDown={(event) => {
                      if (event.button !== 0) {
                        return;
                      }
                      triggerMenuAction(`copy:${folder.id}`, () => handleCopyFile(folder.id));
                    }}
                    onSelect={() =>
                      triggerMenuAction(`copy:${folder.id}`, () => handleCopyFile(folder.id))
                    }
                    onClick={() =>
                      triggerMenuAction(`copy:${folder.id}`, () => handleCopyFile(folder.id))
                    }
                    style={{ paddingLeft: `${(folder.sortOrder || 0) * 12 + 8}px` }}
                  >
                    {folder.name}
                  </ContextMenuItem>
                ))
              ) : (
                <ContextMenuItem disabled>暂无可用文件夹</ContextMenuItem>
              )}
            </ContextMenuSubContent>
          </ContextMenuSub>

          {/* Move to submenu (no root option for files) */}
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Move className="w-4 h-4 mr-2" />
              {activeFileIds.length > 1 ? `移动 ${activeFileIds.length} 个文件到` : "移动到"}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {flatFolders.length > 0 ? (
                flatFolders.map((folder) => (
                  <ContextMenuItem
                    key={folder.id}
                    onPointerDown={(event) => {
                      if (event.button !== 0) {
                        return;
                      }
                      triggerMenuAction(`move:${folder.id}`, () => handleMoveFile(folder.id));
                    }}
                    onSelect={() =>
                      triggerMenuAction(`move:${folder.id}`, () => handleMoveFile(folder.id))
                    }
                    onClick={() =>
                      triggerMenuAction(`move:${folder.id}`, () => handleMoveFile(folder.id))
                    }
                    style={{ paddingLeft: `${(folder.sortOrder || 0) * 12 + 8}px` }}
                  >
                    {folder.name}
                  </ContextMenuItem>
                ))
              ) : (
                <ContextMenuItem disabled>暂无可用文件夹</ContextMenuItem>
              )}
            </ContextMenuSubContent>
          </ContextMenuSub>

          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => triggerMenuAction("delete", handleDeleteFile)}
            onClick={() => triggerMenuAction("delete", handleDeleteFile)}
            className="text-red-600 dark:text-red-400"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            {activeFileIds.length > 1 ? `删除 ${activeFileIds.length} 个文件` : "删除"}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <Dialog
        open={batchAnalyzeDialog !== null}
        onOpenChange={(open) => {
          if (!open && !isSubmittingBatchAnalyze) {
            setBatchAnalyzeDialog(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>批量 AI 分析</DialogTitle>
            <DialogDescription>
              {batchAnalyzeDialog
                ? batchAnalyzeDialog.freshFiles.length > 0
                  ? `已选 ${batchAnalyzeDialog.freshFiles.length + batchAnalyzeDialog.existingFiles.length} 张可分析图片，其中 ${batchAnalyzeDialog.existingFiles.length} 张已经有标签或描述。是否也要对这些图片继续执行 AI 分析？`
                  : `已选 ${batchAnalyzeDialog.existingFiles.length} 张可分析图片，它们都已经有标签或描述。是否仍继续执行 AI 分析？`
                : ""}
            </DialogDescription>
          </DialogHeader>

          {batchAnalyzeDialog?.skippedUnsupportedCount ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              另外有 {batchAnalyzeDialog.skippedUnsupportedCount} 个非图片文件会自动跳过。
            </p>
          ) : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setBatchAnalyzeDialog(null)}
              disabled={isSubmittingBatchAnalyze}
            >
              取消
            </Button>

            {batchAnalyzeDialog && batchAnalyzeDialog.freshFiles.length > 0 ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  const currentDialog = batchAnalyzeDialog;
                  setBatchAnalyzeDialog(null);
                  void runBatchAnalyze(currentDialog.freshFiles);
                }}
                disabled={isSubmittingBatchAnalyze}
              >
                仅分析未标注图片
              </Button>
            ) : null}

            <Button
              type="button"
              onClick={() => {
                const currentDialog = batchAnalyzeDialog;
                if (!currentDialog) {
                  return;
                }

                setBatchAnalyzeDialog(null);
                void runBatchAnalyze([...currentDialog.freshFiles, ...currentDialog.existingFiles]);
              }}
              disabled={isSubmittingBatchAnalyze}
            >
              {batchAnalyzeDialog?.freshFiles.length
                ? "包含已标注图片"
                : `继续分析 ${batchAnalyzeDialog?.existingFiles.length ?? 0} 张`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
