// 拾光采集器 - Background Script

const SHIGUANG_SERVER_URL = "http://127.0.0.1:7845";
const PREFERENCES_KEY = "shiguangCollectorPreferences";
const DEFAULT_IMPORT_CONCURRENCY = 10;
const DEDUPE_WINDOW_MS = 1000;
const IMPORT_QUEUE_LIMIT = 500;

const importQueue = [];
const recentImportTimes = new Map();
let activeImportCount = 0;
let cachedPreferences = {};

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

chrome.storage.sync.get(PREFERENCES_KEY, (result) => {
  cachedPreferences = normalizePreferences(result?.[PREFERENCES_KEY]);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !changes[PREFERENCES_KEY]) {
    return;
  }

  cachedPreferences = normalizePreferences(changes[PREFERENCES_KEY].newValue);
  drainImportQueue();
});

function normalizePreferences(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const preferences = {
    importConcurrency: normalizeOptionalNumberText(value.importConcurrency),
    targetFolderEnabled: value.targetFolderEnabled === true,
  };

  if (value.dragDockEnabled === false || value.dragDockEnabled === true) {
    preferences.dragDockEnabled = value.dragDockEnabled;
  }

  return preferences;
}

function normalizePreferencePatch(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const patch = {};
  for (const key of ["importConcurrency"]) {
    if (hasOwn(value, key)) {
      patch[key] = normalizeOptionalNumberText(value[key]);
    }
  }

  if (hasOwn(value, "targetFolderEnabled")) {
    patch.targetFolderEnabled = value.targetFolderEnabled === true;
  }

  if (hasOwn(value, "dragDockEnabled")) {
    if (value.dragDockEnabled === false || value.dragDockEnabled === true) {
      patch.dragDockEnabled = value.dragDockEnabled;
    }
  }

  return patch;
}

function normalizeOptionalNumberText(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value).trim();
  return /^\d+$/.test(text) ? text : "";
}

function normalizeOptionalFolderId(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    return "";
  }

  return Number.parseInt(text, 10) > 0 ? text : "";
}

function parseFolderId(folderId) {
  const normalized = normalizeOptionalFolderId(folderId);
  return normalized ? Number.parseInt(normalized, 10) : null;
}

async function resolveTargetFolderForSend(tabId, folderId, targetFolderResolved = false) {
  const explicitFolderId = parseFolderId(folderId);
  if (explicitFolderId) {
    return { cancelled: false, folderId: explicitFolderId };
  }

  if (targetFolderResolved) {
    return { cancelled: false, folderId: null };
  }

  if (cachedPreferences.targetFolderEnabled !== true) {
    return { cancelled: false, folderId: null };
  }

  if (!tabId) {
    throw new Error("当前页面无法选择目标文件夹");
  }

  let response;
  try {
    response = await chrome.tabs.sendMessage(tabId, { action: "selectTargetFolder" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "未知错误");
    throw new Error(`无法打开文件夹选择器：${message}`);
  }

  if (response?.cancelled || response?.success === false) {
    return {
      cancelled: true,
      folderId: null,
      error: response?.error || "已取消发送",
    };
  }

  return {
    cancelled: false,
    folderId: parseFolderId(response?.folderId),
  };
}

function getImportConcurrency() {
  const configured = Number.parseInt(cachedPreferences.importConcurrency || "", 10);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_IMPORT_CONCURRENCY;
  }

  return Math.min(configured, 20);
}

function cleanRecentImportTimes(now = Date.now()) {
  for (const [imageUrl, timestamp] of recentImportTimes) {
    if (now - timestamp > DEDUPE_WINDOW_MS * 6) {
      recentImportTimes.delete(imageUrl);
    }
  }
}

async function showPageToast(tabId, message, type = "info", duration = 3000) {
  if (!tabId) {
    return false;
  }

  try {
    await chrome.tabs.sendMessage(tabId, {
      action: "showToast",
      payload: {
        message,
        type,
        duration,
      },
    });
    return true;
  } catch (error) {
    console.warn("Failed to show page toast:", error);
    return false;
  }
}

function getErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error || "未知错误");
  if (message === "Failed to fetch") {
    return "无法连接到拾光本地服务（127.0.0.1:7845），请确保拾光应用正在运行";
  }
  return message;
}

function isLocalServiceConnectionError(error) {
  return getErrorMessage(error).includes("无法连接到拾光本地服务");
}

async function isShiguangServerReachable() {
  try {
    const response = await fetch(`${SHIGUANG_SERVER_URL}/api/health`, {
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function fetchShiguang(endpoint, options = {}) {
  const url = `${SHIGUANG_SERVER_URL}${endpoint}`;
  try {
    return await fetch(url, options);
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error || "网络错误");
    const reachable = await isShiguangServerReachable();
    if (!reachable) {
      throw new Error(
        `无法连接到拾光本地服务（${SHIGUANG_SERVER_URL}）。请确认拾光应用正在运行，且浏览器扩展允许访问 127.0.0.1。原始错误：${rawMessage}`,
      );
    }

    throw new Error(
      `拾光本地服务可连接，但请求 ${endpoint} 失败。可能被浏览器、代理或安全软件拦截。原始错误：${rawMessage}`,
    );
  }
}

function parseServerErrorText(errorText) {
  if (!errorText) {
    return "";
  }

  try {
    const payload = JSON.parse(errorText);
    if (typeof payload.message === "string" && payload.message) {
      return payload.message;
    }
    if (typeof payload.error === "string" && payload.error) {
      return payload.error;
    }
  } catch {
    // Keep plain text errors as-is.
  }

  return errorText;
}

async function readShiguangJson(response) {
  if (!response.ok) {
    const errorText = await response.text();
    const message =
      parseServerErrorText(errorText) ||
      `拾光本地服务返回 HTTP ${response.status} ${response.statusText || ""}`.trim();
    throw new Error(message);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || "Unknown error");
  }

  return result;
}

async function importImageToShiguang(imageUrl, referer, folderId) {
  const response = await fetchShiguang("/api/import-from-url", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image_url: imageUrl,
      referer,
      folder_id: folderId,
    }),
  });
  return readShiguangJson(response);
}

function extensionFromContentType(contentType) {
  const mime = String(contentType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const extensions = {
    "image/apng": "png",
    "image/avif": "avif",
    "image/bmp": "bmp",
    "image/gif": "gif",
    "image/heic": "heic",
    "image/heif": "heif",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/svg+xml": "svg",
    "image/tiff": "tiff",
    "image/webp": "webp",
  };
  return extensions[mime] || "";
}

function filenameFromImageUrl(imageUrl, contentType) {
  let filename = "browser-image";
  try {
    const url = new URL(imageUrl);
    const name = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
    if (name) {
      filename = name;
    }
  } catch {
    // Keep fallback filename.
  }

  filename = filename.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 160) || "browser-image";
  if (/\.[a-z0-9]{1,8}$/i.test(filename)) {
    return filename;
  }

  const ext = extensionFromContentType(contentType);
  return ext ? `${filename}.${ext}` : filename;
}

async function importImageViaBrowserFetch(imageUrl, folderId) {
  const response = await fetch(imageUrl, {
    cache: "no-store",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(
      `浏览器侧下载失败：HTTP ${response.status} ${response.statusText || ""}`.trim(),
    );
  }

  const contentType = response.headers.get("content-type") || "";
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength) {
    throw new Error("浏览器侧下载失败：图片数据为空");
  }

  return importBytesToShiguang(bytes, {
    filename: filenameFromImageUrl(imageUrl, contentType),
    folderId,
  });
}

async function importBytesToShiguang(bytes, { filename = "screenshot.png", folderId = null } = {}) {
  const params = new URLSearchParams({
    filename,
  });
  if (folderId) {
    params.set("folder_id", String(folderId));
  }

  const response = await fetchShiguang(`/api/import?${params.toString()}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
    },
    body: bytes,
  });

  return readShiguangJson(response);
}

async function importDataUrlToShiguang(dataUrl, options = {}) {
  const target = await resolveTargetFolderForSend(
    options.tabId,
    options.folderId,
    options.targetFolderResolved === true,
  );
  if (target.cancelled) {
    return { success: false, cancelled: true, error: target.error || "已取消发送" };
  }

  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bytes = await blob.arrayBuffer();
  return importBytesToShiguang(bytes, {
    filename: options.filename || "screenshot.png",
    folderId: target.folderId,
  });
}

function enqueueImportTask(task) {
  const now = Date.now();
  cleanRecentImportTimes(now);

  const dedupeKey = `${task.folderId || "default"}\n${task.imageUrl}`;
  const recent = recentImportTimes.get(dedupeKey);
  if (recent && now - recent < DEDUPE_WINDOW_MS) {
    return Promise.resolve({
      success: true,
      deduped: true,
      result: null,
    });
  }

  if (importQueue.length >= IMPORT_QUEUE_LIMIT) {
    return Promise.resolve({
      success: false,
      error: "收藏队列已满，请稍后再试",
    });
  }

  recentImportTimes.set(dedupeKey, now);

  return new Promise((resolve) => {
    importQueue.push({ ...task, resolve });
    drainImportQueue();
  });
}

function drainImportQueue() {
  const maxConcurrency = getImportConcurrency();

  while (activeImportCount < maxConcurrency && importQueue.length > 0) {
    const task = importQueue.shift();
    activeImportCount += 1;

    runImportTask(task)
      .then(task.resolve)
      .catch((error) => {
        task.resolve({
          success: false,
          error: getErrorMessage(error),
        });
      })
      .finally(() => {
        activeImportCount -= 1;
        drainImportQueue();
      });
  }
}

async function runImportTask(task) {
  try {
    const result = await importImageToShiguang(task.imageUrl, task.referer, task.folderId);
    if (task.notifyOnSuccess) {
      await notifyResult(task.tabId, task.successMessage || "已发送到拾光", "success", 2200);
    }
    return {
      success: true,
      result,
    };
  } catch (error) {
    let errorMessage = getErrorMessage(error);
    if (!isLocalServiceConnectionError(error)) {
      try {
        const result = await importImageViaBrowserFetch(task.imageUrl, task.folderId);
        if (task.notifyOnSuccess) {
          await notifyResult(task.tabId, task.successMessage || "已发送到拾光", "success", 2200);
        }
        return {
          success: true,
          result,
          fallback: "browser_fetch",
        };
      } catch (fallbackError) {
        errorMessage = `后端下载失败：${errorMessage}；浏览器兜底失败：${getErrorMessage(fallbackError)}`;
      }
    }

    console.error("发送到拾光失败:", errorMessage);

    if (task.notifyOnError) {
      await notifyResult(task.tabId, `发送失败: ${errorMessage}`, "error", 3600);
    }

    return {
      success: false,
      error: errorMessage,
    };
  }
}

async function collectImage({
  tabId,
  imageUrl,
  referer,
  missingImageMessage = "未找到图片，请右键点击图片后重试",
  notifyOnError = true,
  notifyOnSuccess = false,
  successMessage = "已发送到拾光",
  folderId,
  targetFolderResolved = false,
}) {
  if (!imageUrl) {
    if (notifyOnError) {
      await notifyResult(tabId, missingImageMessage, "error");
    }

    return {
      success: false,
      error: missingImageMessage,
    };
  }

  const target = await resolveTargetFolderForSend(tabId, folderId, targetFolderResolved);
  if (target.cancelled) {
    return { success: false, cancelled: true, error: target.error || "已取消发送" };
  }

  return enqueueImportTask({
    tabId,
    imageUrl,
    referer,
    folderId: target.folderId,
    notifyOnError,
    notifyOnSuccess,
    successMessage,
  });
}

async function notifyResult(tabId, message, type = "info", duration = 3000) {
  const shownInPage = await showPageToast(tabId, message, type, duration);
  if (shownInPage) {
    return;
  }

  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon48.png",
    title: "拾光采集器",
    message,
  });
}

// Create context menu when extension is installed
chrome.runtime.onInstalled.addListener(() => {
  // 链接遮罩里的图片（如小红书封面）会被 Chrome 归类为 link context。
  // 取图仍交给 content script，保证 SPA、懒加载和遮罩结构都走同一套逻辑。
  chrome.contextMenus.create({
    id: "sendToShiguang",
    title: "发送给拾光",
    contexts: ["page", "image", "link"],
  });
});

// Listen for context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const tabId = tab?.id;
  const referer = tab?.url || info.pageUrl;
  let imageUrl = null;

  // 优先复用 content script 的取图结果，和 Alt+左键保持一致
  if (tabId) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        action: "getLastImageUrl",
      });
      if (response && response.imageUrl) {
        imageUrl = response.imageUrl;
      }
    } catch (error) {
      console.error("Failed to get image from content script:", error);
    }
  }

  // content script 未取到时，再回退到浏览器提供的 srcUrl
  if (!imageUrl) {
    imageUrl = info.srcUrl || null;
  }

  try {
    await collectImage({
      tabId,
      imageUrl,
      referer,
      missingImageMessage: "未找到图片，请右键点击图片后重试",
      notifyOnSuccess: true,
    });
  } catch (error) {
    await notifyResult(tabId, `发送失败: ${getErrorMessage(error)}`, "error", 3600);
  }
});

async function sendMessageToTab(tabId, message) {
  if (!tabId) {
    return false;
  }

  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch (error) {
    console.warn("Failed to send message to tab:", error);
    return false;
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function captureVisibleDataUrl(tab) {
  return chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
}

async function captureVisibleAndImport(tab, options = {}) {
  const dataUrl = await captureVisibleDataUrl(tab);
  return importDataUrlToShiguang(dataUrl, {
    filename: "visible-screenshot.png",
    folderId: options.folderId,
    targetFolderResolved: options.targetFolderResolved === true,
    tabId: tab?.id,
  });
}

function sendImportResponse(sendResponse, result) {
  if (result?.cancelled) {
    sendResponse(result);
    return;
  }

  sendResponse({ success: true, result });
}

async function fetchFoldersFromShiguang() {
  const response = await fetchShiguang("/api/folders");
  return readShiguangJson(response);
}

chrome.action.onClicked.addListener(async (tab) => {
  const opened = await sendMessageToTab(tab?.id, { action: "togglePanel" });
  if (!opened) {
    await notifyResult(tab?.id, "当前页面无法打开采集面板", "error", 3200);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  const tab = await getActiveTab();
  if (!tab?.id) {
    return;
  }

  if (command === "open-panel") {
    await sendMessageToTab(tab.id, { action: "togglePanel" });
    return;
  }

  if (command === "capture-area") {
    await sendMessageToTab(tab.id, { action: "startAreaCapture" });
    return;
  }

  if (command === "capture-element") {
    await sendMessageToTab(tab.id, { action: "startElementCapture" });
    return;
  }

  if (command === "capture-visible") {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: "captureVisibleFromPage" });
      if (response?.success) {
        return;
      }
    } catch {
      // Fall back to a background-only capture on pages where content scripts are unavailable.
    }

    try {
      const result = await captureVisibleAndImport(tab);
      if (result?.cancelled) {
        return;
      }
      await notifyResult(tab.id, "已收藏可视范围截图", "success", 2200);
    } catch (error) {
      await notifyResult(tab.id, `截图失败: ${getErrorMessage(error)}`, "error", 3600);
    }
  }
});

// Check server connection
async function checkServerConnection() {
  return isShiguangServerReachable();
}

// Messages from content scripts and the collector panel.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "collectImage") {
    const payload = message.payload || {};
    collectImage({
      tabId: _sender.tab?.id,
      imageUrl: payload.imageUrl,
      referer: payload.referer || _sender.tab?.url,
      missingImageMessage: payload.missingImageMessage || "未找到可采集的图片",
      notifyOnError: false,
      notifyOnSuccess: payload.notifyOnSuccess === true,
      successMessage: payload.successMessage || "已发送到拾光",
      folderId: payload.folderId ?? payload.folder_id,
      targetFolderResolved: payload.targetFolderResolved === true,
    })
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, error: getErrorMessage(error) }));
    return true;
  }

  if (message.action === "checkConnection") {
    checkServerConnection().then((connected) => {
      sendResponse({ connected });
    });
    return true;
  }

  if (message.action === "getPreferences") {
    chrome.storage.sync.get(PREFERENCES_KEY, (result) => {
      const preferences = normalizePreferences(result?.[PREFERENCES_KEY]);
      cachedPreferences = preferences;
      sendResponse({
        preferences,
        defaults: {
          importConcurrency: DEFAULT_IMPORT_CONCURRENCY,
        },
      });
    });
    return true;
  }

  if (message.action === "getFolders") {
    fetchFoldersFromShiguang()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: getErrorMessage(error) }));
    return true;
  }

  if (message.action === "updatePreferences") {
    chrome.storage.sync.get(PREFERENCES_KEY, (result) => {
      const current = normalizePreferences(result?.[PREFERENCES_KEY]);
      const patch = normalizePreferencePatch(message.payload || {});
      const next = normalizePreferences({ ...current, ...patch });
      chrome.storage.sync.set({ [PREFERENCES_KEY]: next }, () => {
        cachedPreferences = next;
        drainImportQueue();
        sendResponse({ success: true, preferences: next });
      });
    });
    return true;
  }

  if (message.action === "captureVisibleScreenshot") {
    const payload = message.payload || {};
    const tab = _sender.tab;
    if (!tab) {
      sendResponse({ success: false, error: "未找到当前标签页" });
      return true;
    }

    captureVisibleAndImport(tab, {
      folderId: payload.folderId ?? payload.folder_id,
      targetFolderResolved: payload.targetFolderResolved === true,
    })
      .then((result) => sendImportResponse(sendResponse, result))
      .catch((error) => sendResponse({ success: false, error: getErrorMessage(error) }));
    return true;
  }

  if (message.action === "captureVisibleDataUrl") {
    const tab = _sender.tab;
    if (!tab) {
      sendResponse({ success: false, error: "未找到当前标签页" });
      return true;
    }

    captureVisibleDataUrl(tab)
      .then((dataUrl) => sendResponse({ success: true, dataUrl }))
      .catch((error) => sendResponse({ success: false, error: getErrorMessage(error) }));
    return true;
  }

  if (message.action === "importScreenshotDataUrl") {
    const payload = message.payload || {};
    if (!payload.dataUrl) {
      sendResponse({ success: false, error: "缺少截图数据" });
      return true;
    }

    importDataUrlToShiguang(payload.dataUrl, {
      filename: payload.filename || "screenshot.png",
      folderId: payload.folderId ?? payload.folder_id,
      targetFolderResolved: payload.targetFolderResolved === true,
      tabId: _sender.tab?.id,
    })
      .then((result) => sendImportResponse(sendResponse, result))
      .catch((error) => sendResponse({ success: false, error: getErrorMessage(error) }));
    return true;
  }
});
