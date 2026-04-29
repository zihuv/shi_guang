// 拾光采集器 - 页面内面板工具

(() => {
  if (globalThis.__shiguangCollectorPanelUtils) {
    return;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function parseOptionalInt(value) {
    const parsed = Number.parseInt(String(value || "").trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function scanPageImages(collector) {
    const images = new Map();

    function addImage(url, width = 0, height = 0, sourceElement = null) {
      const normalized = collector.normalizeImageUrl(url);
      if (!normalized || !/^https?:\/\//i.test(normalized)) {
        return;
      }

      const sourceUrl = sourceElement
        ? collector.resolveSourceUrlFromElement?.(sourceElement, normalized)
        : null;

      if (!images.has(normalized)) {
        images.set(normalized, {
          url: normalized,
          width,
          height,
          sourceUrl,
        });
      } else if (sourceUrl && !images.get(normalized).sourceUrl) {
        images.get(normalized).sourceUrl = sourceUrl;
      }
    }

    document.querySelectorAll("img").forEach((img) => {
      addImage(
        img.currentSrc || img.src,
        img.naturalWidth || img.width,
        img.naturalHeight || img.height,
        img,
      );
      addImage(
        img.dataset.src,
        img.naturalWidth || img.width,
        img.naturalHeight || img.height,
        img,
      );
      addImage(
        img.dataset.original,
        img.naturalWidth || img.width,
        img.naturalHeight || img.height,
        img,
      );
      addImage(
        img.dataset.lazy,
        img.naturalWidth || img.width,
        img.naturalHeight || img.height,
        img,
      );
    });

    document.querySelectorAll("[data-src], [data-original], [data-lazy]").forEach((element) => {
      addImage(
        element.dataset.src || element.dataset.original || element.dataset.lazy,
        0,
        0,
        element,
      );
    });

    document.querySelectorAll("*").forEach((element) => {
      const style = window.getComputedStyle(element);
      const backgroundImage = style.backgroundImage;
      if (!backgroundImage || backgroundImage === "none") {
        return;
      }

      for (const match of backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/gi)) {
        addImage(match[1], element.clientWidth, element.clientHeight, element);
      }
    });

    return [...images.values()];
  }

  function cropDataUrl(dataUrl, rect) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const scaleX = image.naturalWidth / window.innerWidth;
        const scaleY = image.naturalHeight / window.innerHeight;
        const sourceX = Math.max(0, Math.round(rect.left * scaleX));
        const sourceY = Math.max(0, Math.round(rect.top * scaleY));
        const sourceWidth = Math.max(1, Math.round(rect.width * scaleX));
        const sourceHeight = Math.max(1, Math.round(rect.height * scaleY));

        const canvas = document.createElement("canvas");
        canvas.width = sourceWidth;
        canvas.height = sourceHeight;
        const context = canvas.getContext("2d");
        context.drawImage(
          image,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          sourceWidth,
          sourceHeight,
        );
        resolve(canvas.toDataURL("image/png"));
      };
      image.onerror = () => reject(new Error("截图裁剪失败"));
      image.src = dataUrl;
    });
  }

  globalThis.__shiguangCollectorPanelUtils = {
    cropDataUrl,
    escapeHtml,
    parseOptionalInt,
    scanPageImages,
  };
})();
