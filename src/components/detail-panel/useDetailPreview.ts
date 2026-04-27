import { useEffect, useRef, useState } from "react";
import type { FileItem } from "@/stores/fileTypes";
import { useThumbnailRefreshStore } from "@/stores/thumbnailRefreshStore";
import {
  getFilePreviewMode,
  getFileSrc,
  getTextPreviewContent,
  getThumbnailImageSrc,
  getVideoThumbnailSrc,
  resolveThumbnailRequestMaxEdge,
} from "@/utils";

export function useDetailPreview({ file, width }: { file: FileItem; width: number }) {
  const [imageSrc, setImageSrc] = useState("");
  const [videoPosterSrc, setVideoPosterSrc] = useState("");
  const [textContent, setTextContent] = useState("");
  const [previewError, setPreviewError] = useState(false);
  const [isImageOriginalOpen, setIsImageOriginalOpen] = useState(false);
  const [isImageOriginalLoading, setIsImageOriginalLoading] = useState(false);
  const [isVideoPlayerOpen, setIsVideoPlayerOpen] = useState(false);
  const [isVideoPlayerLoading, setIsVideoPlayerLoading] = useState(false);
  const previewType = getFilePreviewMode(file.ext);
  const usesThumbnailPreview = previewType === "image" || previewType === "thumbnail";
  const thumbnailRefreshVersion = useThumbnailRefreshStore(
    (state) => state.fileVersions[file.id] ?? 0,
  );
  const videoLoadVersionRef = useRef(0);
  const imageLoadVersionRef = useRef(0);
  const previewWidth = Math.max(160, width - 28);
  const previewHeight = Math.round((previewWidth * 9) / 16);
  const previewThumbnailMaxEdge = resolveThumbnailRequestMaxEdge(previewWidth, previewHeight, {
    devicePixelRatioCap: 2,
  });

  useEffect(() => {
    let mounted = true;
    setPreviewError(false);
    setIsImageOriginalOpen(false);
    setIsImageOriginalLoading(false);
    setIsVideoPlayerOpen(false);
    setIsVideoPlayerLoading(false);
    videoLoadVersionRef.current += 1;
    imageLoadVersionRef.current += 1;

    if (!usesThumbnailPreview) {
      setImageSrc("");
    }

    if (previewType !== "video") {
      setVideoPosterSrc("");
    }

    if (previewType !== "text") {
      setTextContent("");
    }

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

    if (usesThumbnailPreview) {
      void (async () => {
        const thumbnailSrc = await getThumbnailImageSrc(
          file.path,
          file.ext,
          previewThumbnailMaxEdge,
        );
        if (!mounted) {
          if (thumbnailSrc.startsWith("blob:")) {
            URL.revokeObjectURL(thumbnailSrc);
          }
          return;
        }

        if (thumbnailSrc) {
          setImageSrc(thumbnailSrc);
          return;
        }

        if (previewType !== "image") {
          setPreviewError(true);
          return;
        }

        const originalSrc = await getFileSrc(file.path);
        if (!mounted) {
          if (originalSrc.startsWith("blob:")) {
            URL.revokeObjectURL(originalSrc);
          }
          return;
        }

        if (originalSrc) {
          setImageSrc(originalSrc);
          setIsImageOriginalOpen(true);
        } else {
          setPreviewError(true);
        }
      })();

      return () => {
        mounted = false;
      };
    }

    if (previewType === "video") {
      getVideoThumbnailSrc(file.path, previewThumbnailMaxEdge).then((src) => {
        if (mounted && src) {
          setVideoPosterSrc(src);
        }
      });
      return () => {
        mounted = false;
      };
    }

    getFileSrc(file.path).then((src) => {
      if (!mounted) return;

      if (src) {
        setImageSrc(src);
      } else {
        setPreviewError(true);
      }
    });
    return () => {
      mounted = false;
    };
  }, [
    file.path,
    file.size,
    previewType,
    file.ext,
    previewThumbnailMaxEdge,
    thumbnailRefreshVersion,
    usesThumbnailPreview,
  ]);

  useEffect(() => {
    return () => {
      if (imageSrc.startsWith("blob:")) {
        URL.revokeObjectURL(imageSrc);
      }
    };
  }, [imageSrc]);

  useEffect(() => {
    return () => {
      if (videoPosterSrc.startsWith("blob:")) {
        URL.revokeObjectURL(videoPosterSrc);
      }
    };
  }, [videoPosterSrc]);

  const handleOpenVideoPlayer = async () => {
    if (previewType !== "video" || isVideoPlayerOpen || isVideoPlayerLoading) {
      return;
    }

    const requestVersion = ++videoLoadVersionRef.current;
    setPreviewError(false);
    setIsVideoPlayerLoading(true);

    try {
      const src = await getFileSrc(file.path);
      if (videoLoadVersionRef.current !== requestVersion) {
        if (src.startsWith("blob:")) {
          URL.revokeObjectURL(src);
        }
        return;
      }

      if (src) {
        setImageSrc(src);
        setIsVideoPlayerOpen(true);
      } else {
        setPreviewError(true);
      }
    } finally {
      if (videoLoadVersionRef.current === requestVersion) {
        setIsVideoPlayerLoading(false);
      }
    }
  };

  const handleOpenOriginalImage = async () => {
    if (previewType !== "image" || isImageOriginalOpen || isImageOriginalLoading) {
      return;
    }

    const requestVersion = ++imageLoadVersionRef.current;
    setPreviewError(false);
    setIsImageOriginalLoading(true);

    try {
      const src = await getFileSrc(file.path);
      if (imageLoadVersionRef.current !== requestVersion) {
        if (src.startsWith("blob:")) {
          URL.revokeObjectURL(src);
        }
        return;
      }

      if (src) {
        setImageSrc(src);
        setIsImageOriginalOpen(true);
      } else {
        setPreviewError(true);
      }
    } finally {
      if (imageLoadVersionRef.current === requestVersion) {
        setIsImageOriginalLoading(false);
      }
    }
  };

  return {
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
  };
}
