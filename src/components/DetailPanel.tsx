import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { toast } from "sonner";
import { type FileItem } from "@/stores/fileTypes";
import { useFolderStore, FolderNode } from "@/stores/folderStore";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { useSelectionStore } from "@/stores/selectionStore";
import { useTrashStore } from "@/stores/trashStore";
import FileTagInput from "@/components/FileTagInput";
import { formatDateTime, formatSize, findFolderById } from "@/utils";
import { cn } from "@/lib/utils";
import {
  appIconButtonClass,
  appPanelClass,
  appPanelHeaderClass,
  appPanelMetaClass,
  appPanelTitleClass,
  appPanelValueClass,
  appQuietButtonClass,
  appSectionHeadingClass,
  appSectionLabelClass,
} from "@/lib/ui";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { ColorDistributionBar } from "@/components/detail-panel/ColorDistributionBar";
import { DetailPreview } from "@/components/detail-panel/DetailPreview";
import { RatingControl } from "@/components/detail-panel/RatingControl";
import { useFileDetailMetadata } from "@/components/detail-panel/useFileDetailMetadata";
import { useDetailPreview } from "@/components/detail-panel/useDetailPreview";

interface DetailPanelProps {
  width: number;
}

function PanelIconButton({
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={cn(appIconButtonClass, className)} {...props} />;
}

function PanelActionButton({
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={cn(appQuietButtonClass, className)} {...props} />;
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid min-h-7 grid-cols-[72px_minmax(0,1fr)] items-center gap-x-3 py-0.5">
      <span className={cn(appPanelMetaClass, "leading-5")}>{label}</span>
      <div
        className={cn(
          appPanelValueClass,
          "min-w-0 whitespace-nowrap text-right text-[12px] font-medium leading-5",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function getFolderDisplayPath(folders: FolderNode[], folderId: number): string | null {
  for (const folder of folders) {
    if (folder.id === folderId) {
      return folder.name;
    }

    const childPath = getFolderDisplayPath(folder.children, folderId);
    if (childPath) {
      return `${folder.name}/${childPath}`;
    }
  }

  return null;
}

export default function DetailPanel({ width }: DetailPanelProps) {
  const selectedFile = useSelectionStore((state) => state.selectedFile);
  const { folders, selectedFolderId } = useFolderStore();

  // Find the selected folder
  const selectedFolder = selectedFolderId ? findFolderById(folders, selectedFolderId) : null;

  // Show empty state when nothing is selected
  if (!selectedFile && !selectedFolder) {
    return (
      <div
        className={`${appPanelClass} flex-shrink-0 items-center justify-center p-6`}
        style={{ width }}
      >
        <svg
          className="mb-4 h-14 w-14 text-gray-300 dark:text-gray-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p className="text-center text-[13px] text-gray-500 dark:text-gray-400">
          选择文件或文件夹查看详情
        </p>
      </div>
    );
  }

  // Show file details when a file is selected (takes priority over folder)
  if (selectedFile) {
    return <FileDetailPanel file={selectedFile} width={width} />;
  }

  // Show folder details when no file is selected
  if (selectedFolder) {
    return <FolderDetailPanel folder={selectedFolder} width={width} />;
  }

  return null;
}

function FolderDetailPanel({ folder, width }: { folder: FolderNode; width: number }) {
  const { deleteFolder: deleteFolderFn, folders } = useFolderStore();
  const selectedFolderId = useFolderStore((state) => state.selectedFolderId);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const folderDisplayPath = getFolderDisplayPath(folders, folder.id) ?? folder.name;

  const handleDelete = async () => {
    const result = await deleteFolderFn(folder.id);
    if (result?.movedToTrash) {
      await useTrashStore.getState().addFolderDeleteToUndoStack({
        folderId: result.folderId,
        folderName: result.folderName,
        folderPath: result.folderPath,
        shouldSelectOnUndo: selectedFolderId === folder.id,
      });
      toast.success(`已删除文件夹“${result.folderName}”，可在回收站恢复或按 Cmd/Ctrl+Z 撤回。`);
    } else if (result) {
      toast.success(`已删除文件夹“${result.folderName}”。`);
    }
    setShowDeleteConfirm(false);
  };

  return (
    <div className={`${appPanelClass} flex-shrink-0`} style={{ width }}>
      <div className={appPanelHeaderClass}>
        <h3 className={appPanelTitleClass}>文件夹详情</h3>
        <div className="flex items-center gap-1">
          {showDeleteConfirm ? (
            <>
              <PanelActionButton
                onClick={handleDelete}
                className="bg-red-500 text-white hover:bg-red-600"
              >
                确认删除
              </PanelActionButton>
              <PanelActionButton
                onClick={() => setShowDeleteConfirm(false)}
                className="bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
              >
                取消
              </PanelActionButton>
            </>
          ) : (
            <PanelIconButton
              onClick={() => setShowDeleteConfirm(true)}
              className="text-red-500 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30"
              title="删除文件夹"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </PanelIconButton>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-4 pb-5 pt-5 [&>*]:shrink-0">
        <div className="mb-6 flex flex-col items-center gap-4 text-center">
          <div className="flex size-24 items-center justify-center rounded-[28px] bg-yellow-400/10 dark:bg-yellow-500/12">
            <svg className="h-11 w-11 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
              <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
            </svg>
          </div>
          <div className="space-y-1.5">
            <h4 className={appSectionLabelClass}>文件夹名称</h4>
            <p className="break-all text-[18px] font-semibold leading-7 text-gray-800 dark:text-gray-100">
              {folder.name}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <h4 className={appSectionLabelClass}>文件数量</h4>
            <p className={appPanelValueClass}>{folder.fileCount} 个文件</p>
          </div>

          <div className="space-y-1.5">
            <h4 className={appSectionLabelClass}>路径</h4>
            <p
              className="break-all text-[12px] leading-5 text-gray-500 dark:text-gray-400"
              title={folderDisplayPath}
            >
              {folderDisplayPath}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function FileDetailPanel({ file, width }: { file: FileItem; width: number }) {
  const deleteFile = useTrashStore((state) => state.deleteFile);
  const updateFileMetadata = useLibraryQueryStore((state) => state.updateFileMetadata);
  const exportFile = useLibraryQueryStore((state) => state.exportFile);
  const updateFileName = useLibraryQueryStore((state) => state.updateFileName);
  const { folders } = useFolderStore();

  // Find folder by file's folderId
  const folder = file.folderId ? findFolderById(folders, file.folderId) : null;
  const folderDisplayPath = file.folderId ? getFolderDisplayPath(folders, file.folderId) : null;
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showExportSuccess, setShowExportSuccess] = useState(false);
  const {
    description,
    editedName,
    handleDescriptionChange,
    handleNameSave,
    handleRatingChange,
    handleSourceUrlChange,
    rating,
    resetEditedName,
    setEditedName,
    sourceUrl,
  } = useFileDetailMetadata({
    file,
    updateFileMetadata,
    updateFileName,
  });
  const {
    handleOpenOriginalImage,
    handleOpenVideoPlayer,
    imageSrc,
    isImageOriginalOpen,
    isVideoPlayerOpen,
    previewError,
    previewType,
    textContent,
    usesThumbnailPreview,
    videoPosterSrc,
  } = useDetailPreview({ file, width });

  const handleDelete = async () => {
    await deleteFile(file.id);
  };

  const handleExport = async () => {
    try {
      await exportFile(file.id);
      setShowExportSuccess(true);
      setTimeout(() => setShowExportSuccess(false), 3000);
    } catch (e) {
      console.error("Export failed:", e);
    }
  };

  return (
    <div className={`${appPanelClass} flex-shrink-0`} style={{ width }}>
      <div className={appPanelHeaderClass}>
        <h3 className={appPanelTitleClass}>文件详情</h3>
        <div className="flex items-center gap-1">
          <PanelIconButton
            onClick={handleExport}
            className="text-blue-500 hover:bg-blue-100 hover:text-blue-600 dark:hover:bg-blue-900/30"
            title="导出文件"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
          </PanelIconButton>
          {showDeleteConfirm ? (
            <>
              <PanelActionButton
                onClick={handleDelete}
                className="bg-red-500 text-white hover:bg-red-600"
              >
                确认删除
              </PanelActionButton>
              <PanelActionButton
                onClick={() => setShowDeleteConfirm(false)}
                className="bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
              >
                取消
              </PanelActionButton>
            </>
          ) : (
            <PanelIconButton
              onClick={() => setShowDeleteConfirm(true)}
              className="text-red-500 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30"
              title="删除文件"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </PanelIconButton>
          )}
        </div>
      </div>

      {showExportSuccess && (
        <div className="bg-emerald-500/10 px-3.5 py-2 text-[12px] text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-300">
          导出成功
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto px-4 pb-5 pt-4 [&>*]:shrink-0">
        <DetailPreview
          file={file}
          imageSrc={imageSrc}
          isImageOriginalOpen={isImageOriginalOpen}
          isVideoPlayerOpen={isVideoPlayerOpen}
          onOpenOriginalImage={handleOpenOriginalImage}
          onOpenVideoPlayer={handleOpenVideoPlayer}
          previewError={previewError}
          previewType={previewType}
          textContent={textContent}
          usesThumbnailPreview={usesThumbnailPreview}
          videoPosterSrc={videoPosterSrc}
        />

        {file.colorDistribution && file.colorDistribution.length > 0 && (
          <ColorDistributionBar colors={file.colorDistribution} />
        )}

        {/* Input fields in order: name, tags, description, source URL */}
        {/* 1. File name - always editable */}
        <div>
          <Input
            type="text"
            value={editedName}
            onChange={(e) => setEditedName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleNameSave();
              if (e.key === "Escape") {
                resetEditedName();
              }
            }}
            onBlur={handleNameSave}
            placeholder="名称"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
        </div>

        {/* 2. Tags input with tags displayed inside */}
        <FileTagInput fileId={file.id} fileTags={file.tags} />

        {/* 3. Description */}
        <div>
          <Textarea
            value={description}
            onChange={(e) => handleDescriptionChange(e.target.value)}
            placeholder="添加备注"
            rows={2}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
        </div>

        {/* 4. Source URL */}
        <div>
          <Input
            type="url"
            value={sourceUrl}
            onChange={(e) => handleSourceUrlChange(e.target.value)}
            placeholder="https://"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
        </div>

        {/* Rating and File info list */}
        <div className="flex flex-col gap-0.5 pt-1">
          <span className={appSectionHeadingClass}>素材信息</span>

          <InfoRow
            label="评级"
            value={<RatingControl rating={rating} onChange={handleRatingChange} />}
          />
          {folder && (
            <InfoRow
              label="文件夹"
              value={
                <span className="block truncate" title={folderDisplayPath ?? folder.name}>
                  {folderDisplayPath ?? folder.name}
                </span>
              }
            />
          )}
          {/* File info list - left label, right value */}
          <InfoRow label="尺寸" value={`${file.width} x ${file.height}`} />
          <InfoRow label="大小" value={formatSize(file.size)} />
          <InfoRow label="格式" value={file.ext.toUpperCase()} />
          <InfoRow label="创建时间" value={formatDateTime(file.createdAt)} />
          <InfoRow label="修改时间" value={formatDateTime(file.modifiedAt)} />
          <InfoRow label="导入时间" value={formatDateTime(file.importedAt)} />
        </div>
      </div>
    </div>
  );
}
