import { useEffect, useState, useCallback } from "react";
import { useFileStore, FileItem, getNameWithoutExt } from "@/stores/fileStore";
import { useTagStore } from "@/stores/tagStore";
import { useFolderStore, FolderNode } from "@/stores/folderStore";
import FileTypeIcon from "@/components/FileTypeIcon";
import { getFilePreviewMode, getFileSrc, getTextPreviewContent, formatSize, findFolderById, debounce } from "@/utils";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";

// Format date to match database format (YYYY-MM-DD HH:MM:SS)
function formatDateTime(isoString: string): string {
  if (!isoString) return ""
  const date = new Date(isoString)
  const pad = (n: number) => n.toString().padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export default function DetailPanel() {
  const { selectedFile } = useFileStore();
  const { folders, selectedFolderId } = useFolderStore();

  // Find the selected folder
  const selectedFolder = selectedFolderId
    ? findFolderById(folders, selectedFolderId)
    : null;

  // Show empty state when nothing is selected
  if (!selectedFile && !selectedFolder) {
    return (
      <div className="w-72 flex-shrink-0 bg-white dark:bg-dark-surface border-l border-gray-200 dark:border-dark-border flex flex-col items-center justify-center p-6">
        <svg
          className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4"
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
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
          选择文件或文件夹查看详情
        </p>
      </div>
    );
  }

  // Show file details when a file is selected (takes priority over folder)
  if (selectedFile) {
    return <FileDetailPanel file={selectedFile} />;
  }

  // Show folder details when no file is selected
  if (selectedFolder) {
    return <FolderDetailPanel folder={selectedFolder} />;
  }

  return null;
}

function FolderDetailPanel({ folder }: { folder: FolderNode }) {
  const { deleteFolder: deleteFolderFn } = useFolderStore();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDelete = async () => {
    await deleteFolderFn(folder.id);
    setShowDeleteConfirm(false);
  };

  return (
    <div className="w-72 flex-shrink-0 bg-white dark:bg-dark-surface border-l border-gray-200 dark:border-dark-border flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-dark-border">
        <h3 className="text-sm font-medium text-gray-800 dark:text-gray-200">
          文件夹详情
        </h3>
        <div className="flex items-center gap-1">
          {showDeleteConfirm ? (
            <>
              <button
                onClick={handleDelete}
                className="px-2 py-1 text-xs bg-red-500 hover:bg-red-600 text-white rounded"
              >
                确认删除
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded"
              >
                取消
              </button>
            </>
          ) : (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500"
              title="删除文件夹"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-x-hidden overflow-y-auto p-4 space-y-4">
        {/* Folder icon */}
        <div className="flex justify-center">
          <div className="w-20 h-20 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg flex items-center justify-center">
            <svg
              className="w-10 h-10 text-yellow-500"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
            </svg>
          </div>
        </div>

        {/* Folder name */}
        <div>
          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            文件夹名称
          </h4>
          <p className="text-sm text-gray-800 dark:text-gray-200 break-all">
            {folder.name}
          </p>
        </div>

        {/* File count */}
        <div>
          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            文件数量
          </h4>
          <p className="text-sm text-gray-800 dark:text-gray-200">
            {folder.fileCount} 个文件
          </p>
        </div>

        {/* Path */}
        <div>
          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            路径
          </h4>
          <p className="text-xs text-gray-800 dark:text-gray-200 break-all">
            {folder.path}
          </p>
        </div>
      </div>
    </div>
  );
}

function FileDetailPanel({ file }: { file: FileItem }) {
  const {
    addTagToFile,
    removeTagFromFile,
    deleteFile,
    updateFileMetadata,
    exportFile,
    updateFileName,
  } = useFileStore();
  const { flatTags } = useTagStore();
  const { folders } = useFolderStore();

  // Find folder by file's folderId
  const folder = file.folderId ? findFolderById(folders, file.folderId) : null;
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [imageSrc, setImageSrc] = useState<string>("");
  const [textContent, setTextContent] = useState<string>("");
  const previewType = getFilePreviewMode(file.ext);
  const [tagInput, setTagInput] = useState("");
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [rating, setRating] = useState(file.rating || 0);
  const [description, setDescription] = useState(file.description || "");
  const [sourceUrl, setSourceUrl] = useState(file.sourceUrl || "");
  const [showExportSuccess, setShowExportSuccess] = useState(false);
  const [editedName, setEditedName] = useState(getNameWithoutExt(file.name));

  // Helper to get extension
  const getExt = (name: string) => {
    const parts = name.split(".");
    return parts.length > 1 ? parts[parts.length - 1] : "";
  };

  useEffect(() => {
    let mounted = true;
    setImageSrc("");
    setTextContent("");

    if (previewType === "none") {
      return () => {
        mounted = false;
      };
    }

    if (previewType === "text") {
      getTextPreviewContent(file.path, file.size).then((content) => {
        if (mounted) {
          setTextContent(content);
        }
      });

      return () => {
        mounted = false;
      };
    }

    getFileSrc(file.path).then((src) => {
      if (mounted) setImageSrc(src);
    });
    return () => {
      mounted = false;
    };
  }, [file.path, previewType]);

  // Sync state with file prop when it changes
  useEffect(() => {
    setRating(file.rating || 0);
    setDescription(file.description || "");
    setSourceUrl(file.sourceUrl || "");
    setEditedName(getNameWithoutExt(file.name));
  }, [file.rating, file.description, file.sourceUrl, file.name]);

  const fileTags = file.tags;
  const availableTags = flatTags.filter(
    (t) => !fileTags.some((ft) => ft.id === t.id),
  );

  // Filter tags based on input
  const filteredTags = tagInput
    ? flatTags.filter(
        (t) =>
          t.name.toLowerCase().includes(tagInput.toLowerCase()) &&
          !fileTags.some((ft) => ft.id === t.id),
      )
    : availableTags;

  const handleDelete = async () => {
    await deleteFile(file.id);
  };

  // Auto-save metadata with debounce
  const saveMetadata = useCallback(
    debounce(
      async (
        newRating: number,
        newDescription: string,
        newSourceUrl: string,
      ) => {
        await updateFileMetadata(
          file.id,
          newRating,
          newDescription,
          newSourceUrl,
        );
      },
      500,
    ),
    [file.id, updateFileMetadata],
  );

  const handleRatingChange = (newRating: number) => {
    setRating(newRating);
    saveMetadata(newRating, description, sourceUrl);
  };

  const handleDescriptionChange = (value: string) => {
    setDescription(value);
    saveMetadata(rating, value, sourceUrl);
  };

  const handleSourceUrlChange = (value: string) => {
    setSourceUrl(value);
    saveMetadata(rating, description, value);
  };

  const handleAddTag = async (tagId: number) => {
    await addTagToFile(file.id, tagId);
    setTagInput("");
    setShowTagSuggestions(false);
  };

  const handleCreateAndAddTag = async () => {
    if (!tagInput.trim()) return;
    // Create a new tag with random color
    const colors = [
      "#ef4444",
      "#f97316",
      "#eab308",
      "#22c55e",
      "#06b6d4",
      "#3b82f6",
      "#8b5cf6",
      "#ec4899",
    ];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    const { addTag } = useTagStore.getState();
    await addTag(tagInput.trim(), randomColor);
    // Reload tags and get the new tag
    await useTagStore.getState().loadTags();
    const newTag = useTagStore
      .getState()
      .flatTags.find((t) => t.name === tagInput.trim());
    if (newTag) {
      await addTagToFile(file.id, newTag.id);
    }
    setTagInput("");
    setShowTagSuggestions(false);
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

  const handleNameSave = async () => {
    const currentNameWithoutExt = getNameWithoutExt(file.name);
    const ext = getExt(file.name);
    if (editedName && editedName !== currentNameWithoutExt) {
      // Add extension back if it exists
      const fullName = ext ? `${editedName}.${ext}` : editedName;
      await updateFileName(file.id, fullName);
    }
  };

  return (
    <div className="w-72 flex-shrink-0 bg-white dark:bg-dark-surface border-l border-gray-200 dark:border-dark-border flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-dark-border">
        <h3 className="text-sm font-medium text-gray-800 dark:text-gray-200">
          文件详情
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={handleExport}
            className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900/30 text-blue-500"
            title="导出文件"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
          </button>
          {showDeleteConfirm ? (
            <>
              <button
                onClick={handleDelete}
                className="px-2 py-1 text-xs bg-red-500 hover:bg-red-600 text-white rounded"
              >
                确认删除
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded"
              >
                取消
              </button>
            </>
          ) : (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500"
              title="删除文件"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {showExportSuccess && (
        <div className="px-3 py-2 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-xs">
          导出成功
        </div>
      )}

      <div className="flex-1 overflow-x-hidden overflow-y-auto p-3 space-y-3">
        {/* Preview image */}
        <div className="aspect-video bg-gray-100 dark:bg-dark-bg rounded-lg overflow-hidden relative">
          {previewType === "image" && imageSrc ? (
            <img
              src={imageSrc}
              alt={file.name}
              className="w-full h-full object-contain"
            />
          ) : previewType === "video" && imageSrc ? (
            <video
              src={imageSrc}
              controls
              playsInline
              preload="metadata"
              className="h-full w-full bg-black object-contain"
            />
          ) : previewType === "pdf" && imageSrc ? (
            <object
              data={imageSrc}
              type="application/pdf"
              className="h-full w-full bg-white"
            >
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-gray-500 dark:text-gray-400">
                <FileTypeIcon ext={file.ext} className="h-10 w-10" />
                <p className="text-sm">当前环境不支持 PDF 内嵌预览</p>
              </div>
            </object>
          ) : previewType === "text" ? (
            <div className="h-full w-full overflow-auto bg-white p-3 dark:bg-dark-surface">
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-gray-700 dark:text-gray-200">
                {textContent || "空文本文件"}
              </pre>
            </div>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-gray-500 dark:text-gray-400">
              <FileTypeIcon ext={file.ext} className="h-12 w-12" />
              <span className="rounded bg-white/80 px-2 py-1 text-xs font-medium dark:bg-black/20">
                {file.ext.toUpperCase()}
              </span>
            </div>
          )}
        </div>

        {/* 色彩分布进度条 */}
        {file.colorDistribution && file.colorDistribution.length > 0 && (
          <div className="h-3 w-full">
            <div className="flex w-full h-full">
              {file.colorDistribution.map((colorInfo, index) => (
                <div
                  key={index}
                  className="h-full relative group cursor-pointer"
                  style={{
                    width: `${colorInfo.percentage}%`,
                    minWidth: colorInfo.percentage > 0 ? "4px" : "0",
                  }}
                >
                  <div
                    className="absolute inset-0"
                    style={{ backgroundColor: colorInfo.color }}
                  />
                  {/* 悬停提示 */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 bg-black/80 text-white text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-10">
                    {colorInfo.color} {colorInfo.percentage.toFixed(1)}%
                  </div>
                </div>
              ))}
            </div>
          </div>
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
                setEditedName(getNameWithoutExt(file.name));
              }
            }}
            onBlur={handleNameSave}
            placeholder="名称"
          />
        </div>

        {/* 2. Tags input with tags displayed inside */}
        <div className="relative">
          {/* 已添加的标签芯片（显示在输入框内） */}
          {fileTags.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1">
              {fileTags.map((tag) => (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full text-white"
                  style={{ backgroundColor: tag.color }}
                >
                  {tag.name}
                  <button
                    onClick={() => removeTagFromFile(file.id, tag.id)}
                    className="hover:opacity-70"
                  >
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          )}
          {/* 标签输入框 */}
          <Input
            type="text"
            value={tagInput}
            onChange={(e) => {
              setTagInput(e.target.value);
              setShowTagSuggestions(true);
            }}
            onFocus={() => setShowTagSuggestions(true)}
            onBlur={() => setTimeout(() => setShowTagSuggestions(false), 200)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (filteredTags.length > 0) {
                  // 复用第一个匹配的标签
                  handleAddTag(filteredTags[0].id);
                } else if (tagInput.trim()) {
                  // 创建新标签
                  handleCreateAndAddTag();
                }
              }
            }}
            placeholder="添加标签"
          />
          {showTagSuggestions && tagInput && (
            <div className="absolute z-10 w-full mt-1 bg-white dark:bg-dark-surface border border-gray-200 dark:border-dark-border rounded-md shadow-lg max-h-40 overflow-auto">
              {filteredTags.length > 0 ? (
                filteredTags.map((tag) => (
                  <button
                    key={tag.id}
                    onClick={() => handleAddTag(tag.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-dark-border"
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="text-gray-700 dark:text-gray-300">
                      {tag.name}
                    </span>
                  </button>
                ))
              ) : (
                <button
                  onClick={handleCreateAndAddTag}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-primary-600 dark:text-primary-400 hover:bg-gray-100 dark:hover:bg-dark-border"
                >
                  <svg
                    className="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                  创建标签 "{tagInput}"
                </button>
              )}
            </div>
          )}
        </div>

        {/* 3. Description */}
        <div>
          <Textarea
            value={description}
            onChange={(e) => handleDescriptionChange(e.target.value)}
            placeholder="添加备注"
            rows={2}
          />
        </div>

        {/* 4. Source URL */}
        <div>
          <Input
            type="url"
            value={sourceUrl}
            onChange={(e) => handleSourceUrlChange(e.target.value)}
            placeholder="https://"
          />
        </div>

        {/* Rating and File info list */}
        <div className="space-y-1">
          <span className="text-sm font-semibold text-gray-600 dark:text-gray-300 my-2 block">
            素材信息
          </span>

          {/* Rating */}
          <div className="flex justify-between items-center">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              评级
            </span>
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => handleRatingChange(star === rating ? 0 : star)}
                  className="p-0.5 hover:scale-110 transition-transform"
                >
                  <svg
                    className={`w-3 h-3 ${
                      star <= rating
                        ? "text-yellow-400 fill-yellow-400"
                        : "text-gray-300 dark:text-gray-600"
                    }`}
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                </button>
              ))}
            </div>
          </div>
          {folder && (
            <div className="flex justify-between">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                文件夹
              </span>
              <span className="text-xs text-gray-800 dark:text-gray-200">
                {folder.name}
              </span>
            </div>
          )}
          {/* File info list - left label, right value */}
          <div className="flex justify-between">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              尺寸
            </span>
            <span className="text-xs text-gray-800 dark:text-gray-200">
              {file.width} x {file.height}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              大小
            </span>
            <span className="text-xs text-gray-800 dark:text-gray-200">
              {formatSize(file.size)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              格式
            </span>
            <span className="text-xs text-gray-800 dark:text-gray-200">
              {file.ext.toUpperCase()}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              创建时间
            </span>
            <span className="text-xs text-gray-800 dark:text-gray-200">
              {formatDateTime(file.createdAt)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              修改时间
            </span>
            <span className="text-xs text-gray-800 dark:text-gray-200">
              {formatDateTime(file.modifiedAt)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              导入时间
            </span>
            <span className="text-xs text-gray-800 dark:text-gray-200">
              {formatDateTime(file.importedAt)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
