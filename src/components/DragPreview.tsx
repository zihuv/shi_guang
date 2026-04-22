import { useEffect, useState } from "react";
import FileTypeIcon from "@/components/FileTypeIcon";
import { getFilePreviewMode, getFileSrc, getThumbnailImageSrc } from "@/utils";

type DragPreviewProps = {
  fileId: number;
  files: Array<{ id: number; path: string; ext?: string }>;
};

export default function DragPreview({ fileId, files }: DragPreviewProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const file = files.find((item) => item.id === fileId);
  const previewType = getFilePreviewMode(file?.ext || "");

  useEffect(() => {
    if (!file) {
      setImageSrc(null);
      return;
    }

    if (previewType !== "image" && previewType !== "thumbnail") {
      setImageSrc(null);
      return;
    }

    let active = true;

    const loader =
      previewType === "thumbnail"
        ? getThumbnailImageSrc(file.path, file.ext)
        : getFileSrc(file.path);

    loader
      .then((src) => {
        if (!active) {
          return;
        }

        setImageSrc(src);
      })
      .catch(console.error);

    return () => {
      active = false;
    };
  }, [file, previewType]);

  useEffect(() => {
    return () => {
      if (imageSrc?.startsWith("blob:")) {
        URL.revokeObjectURL(imageSrc);
      }
    };
  }, [imageSrc]);

  return (
    <div className="h-24 w-24 overflow-hidden rounded-lg bg-white shadow-xl dark:bg-dark-surface">
      {imageSrc ? (
        <img src={imageSrc} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-gray-50 to-gray-100 text-gray-400 dark:from-slate-900/70 dark:to-slate-800/90">
          <FileTypeIcon ext={file?.ext || ""} className="h-8 w-8" />
          <span className="text-[10px] font-medium">{file?.ext?.toUpperCase() || "FILE"}</span>
        </div>
      )}
    </div>
  );
}
