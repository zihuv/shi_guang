import { useEffect, useState } from "react";
import { readFile } from "@tauri-apps/plugin-fs";

type DragPreviewProps = {
  fileId: number;
  files: Array<{ id: number; path: string }>;
};

export default function DragPreview({ fileId, files }: DragPreviewProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);

  useEffect(() => {
    const file = files.find((item) => item.id === fileId);
    if (!file) {
      setImageSrc(null);
      return;
    }

    let active = true;
    let objectUrl: string | null = null;

    readFile(file.path)
      .then((contents) => {
        if (!active) {
          return;
        }

        const blob = new Blob([contents]);
        objectUrl = URL.createObjectURL(blob);
        setImageSrc(objectUrl);
      })
      .catch(console.error);

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [fileId, files]);

  return (
    <div className="h-24 w-24 overflow-hidden rounded-lg bg-white shadow-xl dark:bg-dark-surface">
      {imageSrc ? (
        <img src={imageSrc} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <svg
            className="h-8 w-8 animate-pulse text-gray-300"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </div>
      )}
    </div>
  );
}
