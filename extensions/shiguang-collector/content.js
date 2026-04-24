// Content Script Entry

(() => {
  if (globalThis.__shiguangCollectorEntryInitialized) {
    return;
  }
  globalThis.__shiguangCollectorEntryInitialized = true;

  const collector = globalThis.__shiguangCollector;
  if (!collector) {
    return;
  }

  const dragDock = globalThis.__shiguangCollectorDragDock;
  const panel = globalThis.__shiguangCollectorPanel;

  async function collectImageFromEvent(event, label) {
    const target = event.target;
    const imageUrl = collector.getImageUrlFromElement(target);

    if (!imageUrl) {
      return false;
    }

    collector.setLastImageContext(target, imageUrl);

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    try {
      const result = await collector.requestCollectImage(imageUrl, {
        missingImageMessage: "未找到可采集的图片",
        notifyOnSuccess: true,
        successMessage: "已发送到拾光",
      });

      if (!result.success) {
        throw new Error(result.error || "未知错误");
      }
    } catch (error) {
      console.error(`${label}发送到拾光失败:`, error);
      collector.showToast("发送失败: " + collector.getErrorMessage(error), "error", 3600);
    }

    return true;
  }

  document.addEventListener(
    "contextmenu",
    (event) => {
      const target = event.target;
      const imageUrl = collector.getImageUrlFromElement(target);
      collector.setLastImageContext(target, imageUrl);

      if (event.altKey && imageUrl) {
        void collectImageFromEvent(event, "Alt+右键");
        return;
      }

      console.log("右键点击:", target?.tagName || target?.nodeName, "图片URL:", imageUrl);
    },
    true,
  );

  document.addEventListener(
    "dragstart",
    (event) => {
      if (dragDock?.isEnabled && !dragDock.isEnabled()) {
        return;
      }

      const target = event.target;
      const imageUrl = collector.getImageUrlFromElement(target);

      if (!imageUrl) {
        return;
      }

      collector.setLastImageContext(target, imageUrl);
      dragDock?.showDragDock(imageUrl, window.location.href);
    },
    true,
  );

  document.addEventListener(
    "dragend",
    () => {
      dragDock?.scheduleHide();
    },
    true,
  );

  document.addEventListener(
    "drop",
    () => {
      dragDock?.scheduleHide(0);
    },
    true,
  );

  window.addEventListener(
    "blur",
    () => {
      dragDock?.scheduleHide(0);
    },
    true,
  );

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      dragDock?.hideDragDock?.(true);
    }
  });

  document.addEventListener(
    "click",
    async (event) => {
      if (event.button !== 0 || !event.altKey) {
        return;
      }

      void collectImageFromEvent(event, "Alt+左键");
    },
    true,
  );

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === "getLastImageUrl") {
      sendResponse({ imageUrl: collector.getLastImageUrl() });
      return true;
    }

    if (message.action === "showToast") {
      const payload = message.payload || {};
      collector.showToast(payload.message || "", payload.type || "info", payload.duration || 3000);
      sendResponse({ success: true });
      return true;
    }

    if (message.action === "togglePanel") {
      panel?.togglePanel?.();
      sendResponse({ success: Boolean(panel) });
      return true;
    }

    if (message.action === "startAreaCapture") {
      panel?.startAreaCapture?.();
      sendResponse({ success: Boolean(panel) });
      return true;
    }

    if (message.action === "captureVisibleFromPage") {
      if (!panel?.captureVisibleScreenshot) {
        sendResponse({ success: false });
        return true;
      }

      panel
        .captureVisibleScreenshot()
        .then(() => sendResponse({ success: true }))
        .catch((error) =>
          sendResponse({ success: false, error: collector.getErrorMessage(error) }),
        );
      return true;
    }
  });
})();
