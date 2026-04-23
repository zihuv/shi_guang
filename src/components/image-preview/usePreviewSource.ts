import { useEffect, useState } from "react";
import { type FileItem } from "@/stores/fileTypes";
import {
  getFilePreviewMode,
  getFileSrc,
  getRememberedPreviewImageSrc,
  getTextPreviewContent,
  getThumbnailImageSrc,
  preloadFileImage,
  type FilePreviewMode,
} from "@/utils";

function isGeneratedThumbnailSrc(src: string) {
  if (!src) {
    return false;
  }

  try {
    const normalizedSrc = decodeURIComponent(src).replace(/\\/g, "/").toLowerCase();
    return normalizedSrc.includes("/.shiguang/thumbs/");
  } catch {
    return src.toLowerCase().includes(".shiguang/thumbs");
  }
}

export function usePreviewSource({
  currentFile,
  previewFiles,
  previewIndex,
  previewMode,
  previewType,
}: {
  currentFile: FileItem | undefined;
  previewFiles: FileItem[];
  previewIndex: number;
  previewMode: boolean;
  previewType: FilePreviewMode;
}) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [textContent, setTextContent] = useState("");
  const [imageError, setImageError] = useState(false);
  const [isPlaceholderImageSrc, setIsPlaceholderImageSrc] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadedImageSize, setLoadedImageSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    setLoadedImageSize({ width: 0, height: 0 });
  }, [currentFile?.id]);

  useEffect(() => {
    if (!currentFile) return;

    let mounted = true;
    setIsLoading(true);
    setImageError(false);
    setTextContent("");
    setIsPlaceholderImageSrc(false);

    if (previewType === "none") {
      setImageSrc(null);
      setIsLoading(false);
      return () => {
        mounted = false;
      };
    }

    if (previewType === "image") {
      const rememberedSrc = getRememberedPreviewImageSrc(currentFile.path);
      const rememberedSrcIsPlaceholder = isGeneratedThumbnailSrc(rememberedSrc);

      if (rememberedSrc) {
        setImageSrc(rememberedSrc);
        setIsPlaceholderImageSrc(rememberedSrcIsPlaceholder);
        setIsLoading(false);
      } else {
        setImageSrc(null);
      }

      preloadFileImage(currentFile.path)
        .then((result) => {
          if (!mounted) return;

          if (result?.src) {
            setImageSrc(result.src);
            setImageError(false);
            setIsPlaceholderImageSrc(false);
          } else if (!rememberedSrc) {
            setImageError(true);
          }

          setIsLoading(false);
        })
        .catch((error) => {
          if (!mounted) return;

          console.error("Failed to load preview image:", error);
          if (!rememberedSrc) {
            setImageError(true);
          }
          setIsLoading(false);
        });

      return () => {
        mounted = false;
      };
    }

    if (previewType === "thumbnail") {
      setImageSrc(null);

      getThumbnailImageSrc(currentFile.path, currentFile.ext)
        .then((src) => {
          if (!mounted) return;
          if (src) {
            setImageSrc(src);
            setImageError(false);
          } else {
            setImageError(true);
          }
          setIsLoading(false);
        })
        .catch((error) => {
          if (!mounted) return;

          console.error("Failed to load thumbnail preview:", error);
          setImageError(true);
          setIsLoading(false);
        });

      return () => {
        mounted = false;
      };
    }

    setImageSrc(null);

    if (previewType === "text") {
      getTextPreviewContent(currentFile.path, currentFile.size).then((content) => {
        if (mounted) {
          setTextContent(content);
          setIsLoading(false);
        }
      });

      return () => {
        mounted = false;
      };
    }

    getFileSrc(currentFile.path).then((src) => {
      if (!mounted) return;
      if (src) {
        setImageSrc(src);
      } else {
        setImageError(true);
      }
      setIsLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, [currentFile, previewType]);

  useEffect(() => {
    if (!previewMode || previewType !== "image") {
      return;
    }

    const nearbyFiles = [previewFiles[previewIndex - 1], previewFiles[previewIndex + 1]].filter(
      (file): file is FileItem => Boolean(file),
    );

    nearbyFiles.forEach((file) => {
      if (getFilePreviewMode(file.ext) !== "image") {
        return;
      }

      void preloadFileImage(file.path).catch((error) => {
        console.error("Failed to warm nearby preview image:", error);
      });
    });
  }, [previewFiles, previewIndex, previewMode, previewType]);

  useEffect(() => {
    return () => {
      if (imageSrc?.startsWith("blob:")) {
        URL.revokeObjectURL(imageSrc);
      }
    };
  }, [imageSrc]);

  return {
    imageSrc,
    textContent,
    imageError,
    isPlaceholderImageSrc,
    isLoading,
    loadedImageSize,
    setLoadedImageSize,
  };
}
