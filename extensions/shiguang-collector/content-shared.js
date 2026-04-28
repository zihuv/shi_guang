// Content Script Shared Utilities

(() => {
  if (globalThis.__shiguangCollector) {
    return;
  }

  const TOAST_CONTAINER_ID = "shiguang-toast-container";
  const TOAST_REMOVE_DELAY = 240;

  const state = {
    lastImageUrl: null,
    lastRightClickTarget: null,
  };

  function ensureToastContainer() {
    let container = document.getElementById(TOAST_CONTAINER_ID);
    if (container) {
      return container;
    }

    container = document.createElement("div");
    container.id = TOAST_CONTAINER_ID;
    container.setAttribute("aria-live", "polite");
    container.style.cssText = [
      "position: fixed",
      "top: 16px",
      "right: 16px",
      "display: flex",
      "flex-direction: column",
      "align-items: flex-end",
      "gap: 10px",
      "width: min(360px, calc(100vw - 32px))",
      "z-index: 2147483647",
      "pointer-events: none",
    ].join(";");

    (document.body || document.documentElement).appendChild(container);
    return container;
  }

  function showToast(message, type = "info", duration = 3000) {
    const theme = {
      success: {
        border: "#16a34a",
        icon: "✓",
      },
      error: {
        border: "#dc2626",
        icon: "!",
      },
      info: {
        border: "#2563eb",
        icon: "i",
      },
    };

    const currentTheme = theme[type] || theme.info;
    const container = ensureToastContainer();
    const toast = document.createElement("div");
    toast.setAttribute("role", "status");
    toast.style.cssText = [
      "display: flex",
      "align-items: flex-start",
      "gap: 10px",
      "width: 100%",
      "padding: 12px 14px",
      "border-radius: 12px",
      "border: 1px solid rgba(255, 255, 255, 0.12)",
      `border-left: 4px solid ${currentTheme.border}`,
      "background: rgba(17, 24, 39, 0.94)",
      "box-shadow: 0 14px 30px rgba(15, 23, 42, 0.28)",
      "color: #f9fafb",
      'font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      "transform: translateY(-8px)",
      "opacity: 0",
      "transition: opacity 0.24s ease, transform 0.24s ease",
      "backdrop-filter: blur(10px)",
      "pointer-events: none",
    ].join(";");

    const icon = document.createElement("div");
    icon.textContent = currentTheme.icon;
    icon.style.cssText = [
      "width: 18px",
      "height: 18px",
      "border-radius: 999px",
      `background: ${currentTheme.border}`,
      "color: #fff",
      "display: flex",
      "align-items: center",
      "justify-content: center",
      "font-size: 12px",
      "font-weight: 700",
      "flex-shrink: 0",
      "margin-top: 1px",
    ].join(";");

    const content = document.createElement("div");
    content.textContent = message;
    content.style.cssText = ["flex: 1", "min-width: 0", "word-break: break-word"].join(";");

    toast.appendChild(icon);
    toast.appendChild(content);
    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translateY(0)";
    });

    const removeToast = () => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(-8px)";
      window.setTimeout(() => {
        toast.remove();
        if (!container.childElementCount) {
          container.remove();
        }
      }, TOAST_REMOVE_DELAY);
    };

    window.setTimeout(removeToast, duration);
  }

  function getErrorMessage(error) {
    const message = error instanceof Error ? error.message : String(error || "网络错误");
    if (message === "Failed to fetch") {
      return "无法连接到拾光本地服务（127.0.0.1:7845），请确保拾光应用正在运行";
    }
    return message;
  }

  async function requestCollectImage(imageUrl, options = {}) {
    const response = await chrome.runtime.sendMessage({
      action: "collectImage",
      payload: {
        imageUrl,
        referer: options.referer || window.location.href,
        missingImageMessage: options.missingImageMessage,
        notifyOnSuccess: options.notifyOnSuccess,
        successMessage: options.successMessage,
        folderId: options.folderId,
        targetFolderResolved: options.targetFolderResolved === true,
      },
    });

    if (!response) {
      throw new Error("拾光采集器后台未响应");
    }

    return response;
  }

  function normalizeImageUrl(url) {
    if (typeof url !== "string") {
      return null;
    }

    const trimmed = url.trim();
    if (!trimmed) {
      return null;
    }

    try {
      return new URL(trimmed, window.location.href).href;
    } catch {
      return trimmed;
    }
  }

  function extractImageUrlFromDragEvent(event) {
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) {
      return null;
    }

    const uriList = dataTransfer.getData("text/uri-list");
    if (uriList) {
      const uriCandidate = uriList
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith("#"));

      if (uriCandidate) {
        return normalizeImageUrl(uriCandidate);
      }
    }

    const html = dataTransfer.getData("text/html");
    if (html) {
      const srcMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (srcMatch?.[1]) {
        return normalizeImageUrl(srcMatch[1]);
      }
    }

    const plainText = dataTransfer.getData("text/plain").trim();
    if (/^(https?:)?\/\//i.test(plainText)) {
      return normalizeImageUrl(plainText);
    }

    return null;
  }

  function getElementFromTarget(target) {
    return target?.nodeType === Node.TEXT_NODE ? target.parentElement : target;
  }

  function getImageUrlFromImage(img) {
    return normalizeImageUrl(
      img.dataset.src || img.dataset.original || img.dataset.lazy || img.currentSrc || img.src,
    );
  }

  function getImageUrlFromBackground(element, pseudoElement) {
    const style = window.getComputedStyle(element, pseudoElement);
    const bgImage = style.backgroundImage;
    if (!bgImage || bgImage === "none") {
      return null;
    }

    const urlMatch = bgImage.match(/url\(["']?([^"')]+)["']?\)/);
    return urlMatch ? normalizeImageUrl(urlMatch[1]) : null;
  }

  function getImageUrlFromSingleElement(element) {
    if (element.tagName === "IMG") {
      return getImageUrlFromImage(element);
    }

    if (element.dataset.src || element.dataset.original || element.dataset.lazy) {
      return normalizeImageUrl(
        element.dataset.src || element.dataset.original || element.dataset.lazy,
      );
    }

    const backgroundUrl =
      getImageUrlFromBackground(element) ||
      getImageUrlFromBackground(element, "::before") ||
      getImageUrlFromBackground(element, "::after");
    if (backgroundUrl) {
      return backgroundUrl;
    }

    const img = element.querySelector("img");
    return img ? getImageUrlFromImage(img) : null;
  }

  function getImageUrlFromElement(target) {
    const element = getElementFromTarget(target);
    if (!(element instanceof Element)) {
      return null;
    }

    let current = element;
    while (current && current !== document.body) {
      const imageUrl = getImageUrlFromSingleElement(current);
      if (imageUrl) {
        return imageUrl;
      }

      current = current.parentElement;
    }

    return null;
  }

  function getImageUrlFromPoint(x, y) {
    if (typeof document.elementsFromPoint !== "function") {
      return null;
    }

    const elements = document.elementsFromPoint(x, y);
    for (const element of elements) {
      const imageUrl = getImageUrlFromElement(element);
      if (imageUrl) {
        return imageUrl;
      }
    }

    return null;
  }

  function setLastImageContext(target, imageUrl) {
    state.lastRightClickTarget = target ?? null;
    state.lastImageUrl = imageUrl ?? null;
  }

  function getLastImageUrl() {
    return state.lastImageUrl;
  }

  function getLastRightClickTarget() {
    return state.lastRightClickTarget;
  }

  globalThis.__shiguangCollector = {
    state,
    showToast,
    getErrorMessage,
    requestCollectImage,
    normalizeImageUrl,
    extractImageUrlFromDragEvent,
    getImageUrlFromElement,
    getImageUrlFromPoint,
    setLastImageContext,
    getLastImageUrl,
    getLastRightClickTarget,
  };
})();
