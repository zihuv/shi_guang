// 拾光采集器 - 页面内面板

(() => {
  if (globalThis.__shiguangCollectorPanel) {
    return;
  }

  const collector = globalThis.__shiguangCollector;
  if (!collector) {
    return;
  }

  const PANEL_ID = "shiguang-collector-panel-host";
  const OVERLAY_ID = "shiguang-area-capture-overlay";
  const ELEMENT_PICKER_OVERLAY_ID = "shiguang-element-picker-overlay";

  let host = null;
  let shadow = null;
  let panelOpen = false;
  let currentView = "home";
  let preferences = {};
  let defaults = { importConcurrency: 10 };
  let batchImages = [];
  let selectedUrls = new Set();
  let batchStatus = new Map();
  let activeBatchUrls = new Set();
  let batchRunning = false;

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(response);
      });
    });
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

  async function loadPreferences() {
    try {
      const response = await sendRuntimeMessage({ action: "getPreferences" });
      preferences = response?.preferences || {};
      defaults = response?.defaults || defaults;
    } catch (error) {
      console.warn("Failed to load collector preferences:", error);
      preferences = {};
    }
  }

  async function savePreferences(nextPreferences) {
    const response = await sendRuntimeMessage({
      action: "updatePreferences",
      payload: nextPreferences,
    });

    if (response?.success) {
      preferences = response.preferences || nextPreferences;
      return preferences;
    }

    throw new Error(response?.error || "偏好保存失败");
  }

  function ensurePanel() {
    if (host?.isConnected && shadow) {
      return { host, shadow };
    }

    host = document.createElement("div");
    host.id = PANEL_ID;
    host.style.cssText = [
      "position: fixed",
      "top: 18px",
      "right: 18px",
      "z-index: 2147483646",
      "display: none",
    ].join(";");

    shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; }
        .panel {
          --panel-bg: rgba(250, 250, 249, 0.98);
          width: min(280px, calc(100vw - 28px));
          max-height: min(720px, calc(100vh - 36px));
          display: flex;
          flex-direction: column;
          overflow: hidden;
          border-radius: 14px;
          background: var(--panel-bg);
          box-shadow: 0 18px 46px rgba(15, 23, 42, 0.18);
          color: #1f2937;
          font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          backdrop-filter: blur(18px);
        }
        .panel.wide {
          width: min(430px, calc(100vw - 28px));
        }
        .top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 12px 6px;
          background: var(--panel-bg);
        }
        .brand {
          font-size: 14px;
          font-weight: 400;
        }
        .icon-btn {
          width: 28px;
          height: 28px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 0;
          border-radius: 999px;
          background: transparent;
          color: #475569;
          cursor: pointer;
          font-size: 18px;
        }
        .icon-btn:hover { background: rgba(15, 23, 42, 0.07); color: #111827; }
        .body {
          min-height: 0;
          overflow: auto;
          padding: 0 12px 12px;
        }
        .actions { display: flex; flex-direction: column; gap: 2px; }
        .action, .plain-row {
          width: 100%;
          min-height: 36px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border: 0;
          border-radius: 10px;
          background: transparent;
          color: #111827;
          padding: 0 6px;
        }
        .action {
          cursor: pointer;
          text-align: left;
          font: inherit;
          font-weight: 400;
        }
        .action:hover { background: rgba(15, 23, 42, 0.06); }
        .row {
          display: flex;
          align-items: center;
          gap: 10px;
          min-height: 42px;
        }
        .row + .row { margin-top: 10px; }
        .muted { color: #64748b; }
        .button {
          min-height: 34px;
          border: 0;
          border-radius: 999px;
          background: #111827;
          color: #fff;
          cursor: pointer;
          padding: 0 13px;
          font-weight: 400;
        }
        .button.secondary { background: rgba(15, 23, 42, 0.08); color: #1f2937; }
        .button:disabled { cursor: default; opacity: 0.45; }
        .toolbar {
          position: sticky;
          top: 0;
          z-index: 2;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin: 0 -12px 12px;
          padding: 8px 12px 10px;
          background: var(--panel-bg);
          backdrop-filter: blur(18px);
        }
        .toolbar-left, .toolbar-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
        }
        .thumb {
          position: relative;
          aspect-ratio: 1;
          overflow: hidden;
          border-radius: 12px;
          background: rgba(15, 23, 42, 0.08);
        }
        .thumb img {
          width: 100%;
          height: 100%;
          display: block;
          object-fit: cover;
        }
        .check {
          position: absolute;
          top: 7px;
          left: 7px;
          width: 20px;
          height: 20px;
          accent-color: #111827;
        }
        .status {
          position: absolute;
          right: 6px;
          bottom: 6px;
          max-width: calc(100% - 12px);
          padding: 3px 7px;
          border-radius: 999px;
          background: rgba(17, 24, 39, 0.78);
          color: #fff;
          font-size: 11px;
          white-space: nowrap;
        }
        .field {
          display: grid;
          grid-template-columns: 1fr 110px;
          align-items: center;
          gap: 12px;
          min-height: 42px;
        }
        .field input {
          width: 100%;
          height: 34px;
          border: 0;
          border-radius: 10px;
          background: rgba(15, 23, 42, 0.07);
          color: #111827;
          padding: 0 10px;
          outline: none;
        }
        .field input:focus { background: rgba(15, 23, 42, 0.10); }
        .switch {
          width: 46px;
          height: 26px;
          border: 0;
          border-radius: 999px;
          background: rgba(15, 23, 42, 0.18);
          padding: 3px;
          cursor: pointer;
        }
        .switch span {
          display: block;
          width: 20px;
          height: 20px;
          border-radius: 999px;
          background: #fff;
          transition: transform 0.18s ease;
        }
        .switch.on { background: #111827; }
        .switch.on span { transform: translateX(20px); }
        .empty {
          padding: 34px 8px;
          color: #64748b;
          text-align: center;
        }
        @media (max-width: 460px) {
          .panel { width: min(280px, calc(100vw - 24px)); }
          .panel.wide { width: calc(100vw - 24px); }
          .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
      </style>
      <div class="panel" id="panelRoot" role="dialog" aria-label="拾光采集面板">
        <div class="top">
          <button class="icon-btn" id="backButton" type="button" title="返回">‹</button>
          <div class="brand" id="panelTitle">拾光</div>
          <button class="icon-btn" id="closeButton" type="button" title="关闭">×</button>
        </div>
        <div class="body" id="panelBody"></div>
      </div>
    `;

    shadow.getElementById("closeButton").addEventListener("click", closePanel);
    shadow.getElementById("backButton").addEventListener("click", () => {
      currentView = "home";
      renderPanel();
    });

    (document.body || document.documentElement).appendChild(host);
    return { host, shadow };
  }

  function openPanel(view = currentView || "home") {
    ensurePanel();
    panelOpen = true;
    currentView = view;
    host.style.display = "block";
    void loadPreferences().then(renderPanel);
  }

  function closePanel() {
    if (!host) {
      return;
    }

    panelOpen = false;
    host.style.display = "none";
  }

  function togglePanel() {
    if (panelOpen) {
      closePanel();
    } else {
      openPanel("home");
    }
  }

  function setPanelVisible(visible) {
    if (!host) {
      return;
    }
    host.style.display = visible && panelOpen ? "block" : "none";
  }

  function renderPanel() {
    const { shadow: root } = ensurePanel();
    const backButton = root.getElementById("backButton");
    const title = root.getElementById("panelTitle");
    const body = root.getElementById("panelBody");
    const panelRoot = root.getElementById("panelRoot");

    backButton.style.visibility = currentView === "home" ? "hidden" : "visible";
    panelRoot.classList.toggle("wide", currentView === "batch");

    if (currentView === "batch") {
      title.textContent = "批量收藏";
      renderBatch(body);
      return;
    }

    if (currentView === "preferences") {
      title.textContent = "偏好设置";
      renderPreferences(body);
      return;
    }

    title.textContent = "拾光";
    renderHome(body);
  }

  function renderHome(body) {
    const dragEnabled = preferences.dragDockEnabled !== false;
    body.innerHTML = `
      <div class="actions">
        <button class="action" id="areaCaptureButton" type="button">区域截图</button>
        <button class="action" id="elementCaptureButton" type="button">元素截图</button>
        <button class="action" id="visibleCaptureButton" type="button">可视截图</button>
        <button class="action" id="batchButton" type="button">批量收藏</button>
        <button class="action" id="preferencesButton" type="button">偏好设置</button>
      </div>
      <div class="plain-row" style="margin-top: 2px;">
        <span>拖拽收藏</span>
        <button class="switch ${dragEnabled ? "on" : ""}" id="dragToggleButton" type="button" aria-label="切换拖拽收藏">
          <span></span>
        </button>
      </div>
    `;

    body.querySelector("#areaCaptureButton").addEventListener("click", startAreaCapture);
    body.querySelector("#elementCaptureButton").addEventListener("click", startElementCapture);
    body.querySelector("#visibleCaptureButton").addEventListener("click", captureVisibleScreenshot);
    body.querySelector("#batchButton").addEventListener("click", async () => {
      currentView = "batch";
      await scanImages();
      renderPanel();
    });
    body.querySelector("#preferencesButton").addEventListener("click", () => {
      currentView = "preferences";
      renderPanel();
    });
    body.querySelector("#dragToggleButton").addEventListener("click", async () => {
      const next = { ...preferences, dragDockEnabled: !dragEnabled };
      try {
        await savePreferences(next);
        renderPanel();
      } catch (error) {
        collector.showToast(collector.getErrorMessage(error), "error", 3000);
      }
    });
  }

  function renderBatch(body) {
    const previousScrollTop = body.scrollTop;
    const selectedCount = selectedUrls.size;
    const progressText = getBatchProgressText(selectedCount);

    body.innerHTML = `
      <div class="toolbar">
        <div class="toolbar-left">
          <button class="button secondary" id="rescanButton" type="button">刷新</button>
          <button class="button secondary" id="selectAllButton" type="button">全选</button>
          <button class="button secondary" id="selectNoneButton" type="button">全不选</button>
        </div>
        <div class="toolbar-right">
          <span class="muted" id="batchProgressText">${escapeHtml(progressText)}</span>
          <button class="button" id="collectSelectedButton" type="button" ${selectedCount && !batchRunning ? "" : "disabled"}>收藏</button>
        </div>
      </div>
      ${
        batchImages.length
          ? `<div class="grid">${batchImages.map(renderImageItem).join("")}</div>`
          : '<div class="empty">当前页面没有找到可收藏图片</div>'
      }
    `;

    body.querySelector("#rescanButton").addEventListener("click", async () => {
      await scanImages();
      renderPanel();
    });
    body.querySelector("#selectAllButton").addEventListener("click", () => {
      selectedUrls = new Set(
        batchImages.map((image) => image.url).filter((url) => isSelectableBatchUrl(url)),
      );
      renderPanel();
    });
    body.querySelector("#selectNoneButton").addEventListener("click", () => {
      selectedUrls = new Set();
      renderPanel();
    });
    body.querySelector("#collectSelectedButton").addEventListener("click", collectSelectedImages);

    body.querySelectorAll(".check").forEach((input) => {
      input.addEventListener("change", () => {
        if (!isSelectableBatchUrl(input.value)) {
          input.checked = false;
          selectedUrls.delete(input.value);
          syncBatchToolbar();
          return;
        }

        if (input.checked) {
          selectedUrls.add(input.value);
        } else {
          selectedUrls.delete(input.value);
        }
        syncBatchToolbar();
      });
    });

    body.scrollTop = previousScrollTop;
  }

  function syncBatchToolbar() {
    const root = shadow;
    if (!root || currentView !== "batch") {
      return;
    }

    const selectedCount = selectedUrls.size;
    const progressText = getBatchProgressText(selectedCount);
    const progress = root.getElementById("batchProgressText");
    const collectButton = root.getElementById("collectSelectedButton");

    if (progress) {
      progress.textContent = progressText;
    }
    if (collectButton) {
      collectButton.disabled = !selectedCount || batchRunning;
    }
  }

  function getBatchProgressText(selectedCount = selectedUrls.size) {
    if (!batchRunning || !activeBatchUrls.size) {
      return `${selectedCount} 已选`;
    }

    const activeStatuses = [...activeBatchUrls].map((url) => batchStatus.get(url));
    const completed = activeStatuses.filter(
      (status) => status === "success" || status === "failed",
    ).length;
    return `${completed} / ${activeBatchUrls.size}`;
  }

  function isSelectableBatchUrl(url) {
    const status = batchStatus.get(url);
    return status !== "success" && status !== "queued" && status !== "running";
  }

  function renderImageItem(image) {
    const status = batchStatus.get(image.url);
    const selectable = isSelectableBatchUrl(image.url);
    const statusText =
      status === "success"
        ? "完成"
        : status === "failed"
          ? "失败"
          : status === "running"
            ? "进行"
            : status === "queued"
              ? "队列"
              : "";

    return `
      <label class="thumb" title="${escapeHtml(image.url)}">
        <img src="${escapeHtml(image.url)}" alt="">
        <input class="check" type="checkbox" value="${escapeHtml(image.url)}" ${selectedUrls.has(image.url) && selectable ? "checked" : ""} ${selectable && !batchRunning ? "" : "disabled"}>
        ${statusText ? `<span class="status">${statusText}</span>` : ""}
      </label>
    `;
  }

  function renderPreferences(body) {
    const dragEnabled = preferences.dragDockEnabled !== false;
    body.innerHTML = `
      <div class="field">
        <label for="importConcurrency">导入并发</label>
        <input id="importConcurrency" inputmode="numeric" placeholder="${escapeHtml(defaults.importConcurrency || 10)}" value="${escapeHtml(preferences.importConcurrency || "")}">
      </div>
      <div class="plain-row" style="margin-top: 2px;">
        <span>拖拽收藏</span>
        <button class="switch ${dragEnabled ? "on" : ""}" id="dragToggleButton" type="button" aria-label="切换拖拽收藏">
          <span></span>
        </button>
      </div>
      <div class="row" style="justify-content: flex-end; margin-top: 14px;">
        <button class="button" id="savePreferencesButton" type="button">保存</button>
      </div>
    `;

    body.querySelector("#dragToggleButton").addEventListener("click", async () => {
      preferences = { ...preferences, dragDockEnabled: !dragEnabled };
      await savePreferences(preferences);
      renderPanel();
    });
    body.querySelector("#savePreferencesButton").addEventListener("click", async () => {
      const next = {
        ...preferences,
        importConcurrency: body.querySelector("#importConcurrency").value.trim(),
      };

      try {
        await savePreferences(next);
        collector.showToast("偏好已保存", "success", 1800);
        renderPanel();
      } catch (error) {
        collector.showToast(collector.getErrorMessage(error), "error", 3000);
      }
    });
  }

  async function scanImages() {
    await loadPreferences();

    const images = new Map();

    function addImage(url, width = 0, height = 0) {
      const normalized = collector.normalizeImageUrl(url);
      if (!normalized || !/^https?:\/\//i.test(normalized)) {
        return;
      }

      if (!images.has(normalized)) {
        images.set(normalized, {
          url: normalized,
          width,
          height,
        });
      }
    }

    document.querySelectorAll("img").forEach((img) => {
      addImage(
        img.currentSrc || img.src,
        img.naturalWidth || img.width,
        img.naturalHeight || img.height,
      );
      addImage(img.dataset.src, img.naturalWidth || img.width, img.naturalHeight || img.height);
      addImage(
        img.dataset.original,
        img.naturalWidth || img.width,
        img.naturalHeight || img.height,
      );
      addImage(img.dataset.lazy, img.naturalWidth || img.width, img.naturalHeight || img.height);
    });

    document.querySelectorAll("[data-src], [data-original], [data-lazy]").forEach((element) => {
      addImage(element.dataset.src || element.dataset.original || element.dataset.lazy);
    });

    document.querySelectorAll("*").forEach((element) => {
      const style = window.getComputedStyle(element);
      const backgroundImage = style.backgroundImage;
      if (!backgroundImage || backgroundImage === "none") {
        return;
      }

      for (const match of backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/gi)) {
        addImage(match[1], element.clientWidth, element.clientHeight);
      }
    });

    batchImages = [...images.values()];
    batchStatus = new Map(
      [...batchStatus.entries()].filter(([url, status]) => images.has(url) && status === "success"),
    );
    activeBatchUrls = new Set([...activeBatchUrls].filter((url) => images.has(url)));
    selectedUrls = new Set();
  }

  async function collectSelectedImages() {
    const urls = [...selectedUrls];
    if (!urls.length || batchRunning) {
      return;
    }

    batchRunning = true;
    activeBatchUrls = new Set(urls);
    for (const url of urls) {
      selectedUrls.delete(url);
      batchStatus.set(url, "queued");
    }
    renderPanel();

    let nextIndex = 0;
    const workerCount = Math.min(
      urls.length,
      parseOptionalInt(preferences.importConcurrency) || defaults.importConcurrency || 10,
    );

    async function runNext() {
      const url = urls[nextIndex];
      nextIndex += 1;
      if (!url) {
        return;
      }

      batchStatus.set(url, "running");
      renderPanel();

      try {
        const result = await collector.requestCollectImage(url, {
          referer: window.location.href,
          missingImageMessage: "未找到可采集的图片",
          notifyOnSuccess: false,
        });

        batchStatus.set(url, result?.success ? "success" : "failed");
      } catch {
        batchStatus.set(url, "failed");
      }
      renderPanel();
      await runNext();
    }

    await Promise.all(Array.from({ length: workerCount }, () => runNext()));

    batchRunning = false;
    activeBatchUrls = new Set();
    const failures = [...batchStatus.values()].filter((status) => status === "failed").length;
    collector.showToast(
      failures ? `批量收藏完成，失败 ${failures} 张` : "批量收藏完成",
      failures ? "info" : "success",
      2600,
    );
    renderPanel();
  }

  async function captureVisibleScreenshot() {
    try {
      setPanelVisible(false);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const response = await sendRuntimeMessage({ action: "captureVisibleScreenshot" });

      if (!response?.success) {
        throw new Error(response?.error || "截图失败");
      }

      collector.showToast("已收藏可视范围截图", "success", 2200);
      return true;
    } catch (error) {
      collector.showToast("截图失败: " + collector.getErrorMessage(error), "error", 3600);
      throw error;
    } finally {
      setPanelVisible(true);
    }
  }

  function startAreaCapture() {
    ensurePanel();
    setPanelVisible(false);

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.style.cssText = [
      "position: fixed",
      "inset: 0",
      "z-index: 2147483647",
      "cursor: crosshair",
      "background: rgba(15, 23, 42, 0.16)",
    ].join(";");

    const selection = document.createElement("div");
    selection.style.cssText = [
      "position: fixed",
      "display: none",
      "border-radius: 8px",
      "background: rgba(255, 255, 255, 0.18)",
      "box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.34), inset 0 0 0 1px rgba(255, 255, 255, 0.95)",
    ].join(";");
    overlay.appendChild(selection);

    let startX = 0;
    let startY = 0;
    let currentRect = null;
    let dragging = false;

    function updateSelection(event) {
      const left = Math.min(startX, event.clientX);
      const top = Math.min(startY, event.clientY);
      const width = Math.abs(event.clientX - startX);
      const height = Math.abs(event.clientY - startY);
      currentRect = { left, top, width, height };
      selection.style.display = "block";
      selection.style.left = `${left}px`;
      selection.style.top = `${top}px`;
      selection.style.width = `${width}px`;
      selection.style.height = `${height}px`;
    }

    function cleanup(restorePanel = true) {
      window.removeEventListener("keydown", handleKeydown, true);
      overlay.remove();
      if (restorePanel) {
        setPanelVisible(true);
      }
    }

    async function finishSelection() {
      const rect = currentRect;
      cleanup(false);

      if (!rect || rect.width < 8 || rect.height < 8) {
        setPanelVisible(true);
        return;
      }

      try {
        await captureArea(rect);
        collector.showToast("已收藏区域截图", "success", 2200);
      } catch (error) {
        collector.showToast("截图失败: " + collector.getErrorMessage(error), "error", 3600);
      } finally {
        setPanelVisible(true);
      }
    }

    function handleKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        cleanup(true);
      }
    }

    overlay.addEventListener("mousedown", (event) => {
      if (event.button !== 0) {
        return;
      }
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      updateSelection(event);
    });

    overlay.addEventListener("mousemove", (event) => {
      if (!dragging) {
        return;
      }
      updateSelection(event);
    });

    overlay.addEventListener("mouseup", () => {
      if (!dragging) {
        return;
      }
      dragging = false;
      void finishSelection();
    });

    window.addEventListener("keydown", handleKeydown, true);
    (document.body || document.documentElement).appendChild(overlay);
  }

  function startElementCapture() {
    ensurePanel();
    setPanelVisible(false);

    const previousCursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = "crosshair";

    const overlay = document.createElement("div");
    overlay.id = ELEMENT_PICKER_OVERLAY_ID;
    overlay.style.cssText = [
      "position: fixed",
      "inset: 0",
      "z-index: 2147483647",
      "pointer-events: none",
      "background: rgba(15, 23, 42, 0.10)",
    ].join(";");

    const highlight = document.createElement("div");
    highlight.style.cssText = [
      "position: fixed",
      "display: none",
      "border-radius: 6px",
      "background: rgba(37, 99, 235, 0.14)",
      "box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.95), 0 0 0 9999px rgba(15, 23, 42, 0.20)",
    ].join(";");
    overlay.appendChild(highlight);

    let selectedElement = null;
    let selectedRect = null;
    let completed = false;

    function cleanup(restorePanel = true) {
      document.documentElement.style.cursor = previousCursor;
      document.removeEventListener("mousemove", handleMouseMove, true);
      document.removeEventListener("mousedown", handleMouseDown, true);
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("keydown", handleKeydown, true);
      window.removeEventListener("scroll", handleScroll, true);
      overlay.remove();
      if (restorePanel) {
        setPanelVisible(true);
      }
    }

    function isPickerElement(element) {
      return (
        element === overlay ||
        element === host ||
        element?.id === ELEMENT_PICKER_OVERLAY_ID ||
        element?.id === PANEL_ID ||
        element?.id === "shiguang-toast-container" ||
        host?.contains(element)
      );
    }

    function getElementAtPoint(x, y) {
      const elements = document.elementsFromPoint(x, y);
      return (
        elements.find((element) => {
          if (!(element instanceof Element) || isPickerElement(element)) {
            return false;
          }
          const rect = element.getBoundingClientRect();
          return rect.width >= 2 && rect.height >= 2;
        }) || null
      );
    }

    function getVisibleRect(element) {
      const rect = element.getBoundingClientRect();
      const left = Math.max(0, rect.left);
      const top = Math.max(0, rect.top);
      const right = Math.min(window.innerWidth, rect.right);
      const bottom = Math.min(window.innerHeight, rect.bottom);
      const width = Math.max(0, right - left);
      const height = Math.max(0, bottom - top);
      return { left, top, width, height };
    }

    function updateHighlight(rect) {
      selectedRect = rect;
      if (!rect || rect.width < 2 || rect.height < 2) {
        highlight.style.display = "none";
        return;
      }

      highlight.style.display = "block";
      highlight.style.left = `${rect.left}px`;
      highlight.style.top = `${rect.top}px`;
      highlight.style.width = `${rect.width}px`;
      highlight.style.height = `${rect.height}px`;
    }

    function selectFromEvent(event) {
      selectedElement = getElementAtPoint(event.clientX, event.clientY);
      updateHighlight(selectedElement ? getVisibleRect(selectedElement) : null);
    }

    async function finishSelection(event) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (completed) {
        return;
      }
      completed = true;

      if (!selectedElement) {
        selectFromEvent(event);
      }

      const rect = selectedElement ? getVisibleRect(selectedElement) : selectedRect;
      cleanup(false);

      if (!rect || rect.width < 8 || rect.height < 8) {
        setPanelVisible(true);
        return;
      }

      try {
        await captureArea(rect, "element-screenshot.png");
        collector.showToast("已收藏元素截图", "success", 2200);
      } catch (error) {
        collector.showToast("截图失败: " + collector.getErrorMessage(error), "error", 3600);
      } finally {
        setPanelVisible(true);
      }
    }

    function handleMouseMove(event) {
      selectFromEvent(event);
    }

    function handleMouseDown(event) {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }

    function handleClick(event) {
      if (event.button !== 0) {
        return;
      }
      void finishSelection(event);
    }

    function handleKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        cleanup(true);
      }
    }

    function handleScroll() {
      if (selectedElement) {
        updateHighlight(getVisibleRect(selectedElement));
      }
    }

    document.addEventListener("mousemove", handleMouseMove, true);
    document.addEventListener("mousedown", handleMouseDown, true);
    document.addEventListener("click", handleClick, true);
    window.addEventListener("keydown", handleKeydown, true);
    window.addEventListener("scroll", handleScroll, true);
    (document.body || document.documentElement).appendChild(overlay);
  }

  async function captureArea(rect, filename = "area-screenshot.png") {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const response = await sendRuntimeMessage({ action: "captureVisibleDataUrl" });
    if (!response?.success || !response.dataUrl) {
      throw new Error(response?.error || "截图失败");
    }

    const croppedDataUrl = await cropDataUrl(response.dataUrl, rect);
    const importResponse = await sendRuntimeMessage({
      action: "importScreenshotDataUrl",
      payload: {
        dataUrl: croppedDataUrl,
        filename,
      },
    });

    if (!importResponse?.success) {
      throw new Error(importResponse?.error || "导入截图失败");
    }

    return importResponse.result;
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

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && panelOpen) {
        closePanel();
      }
    },
    true,
  );

  globalThis.__shiguangCollectorPanel = {
    togglePanel,
    openPanel,
    closePanel,
    startAreaCapture,
    startElementCapture,
    captureVisibleScreenshot,
  };
})();
