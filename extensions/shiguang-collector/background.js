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
    return "无法连接到拾光应用，请确保应用正在运行";
  }
  return message;
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

async function importImageToShiguang(imageUrl, referer) {
  const response = await fetch(`${SHIGUANG_SERVER_URL}/api/import-from-url`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image_url: imageUrl,
      referer,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const message = parseServerErrorText(errorText) || `HTTP ${response.status}`;
    throw new Error(message);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || "Unknown error");
  }

  return result;
}

async function importBytesToShiguang(bytes, { filename = "screenshot.png" } = {}) {
  const response = await fetch(
    `${SHIGUANG_SERVER_URL}/api/import?filename=${encodeURIComponent(filename)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
      },
      body: bytes,
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    const message = parseServerErrorText(errorText) || `HTTP ${response.status}`;
    throw new Error(message);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || "Unknown error");
  }

  return result;
}

async function importDataUrlToShiguang(dataUrl, options = {}) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bytes = await blob.arrayBuffer();
  return importBytesToShiguang(bytes, {
    filename: options.filename || "screenshot.png",
  });
}

function enqueueImportTask(task) {
  const now = Date.now();
  cleanRecentImportTimes(now);

  const recent = recentImportTimes.get(task.imageUrl);
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

  recentImportTimes.set(task.imageUrl, now);

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
    const result = await importImageToShiguang(task.imageUrl, task.referer);
    if (task.notifyOnSuccess) {
      await notifyResult(task.tabId, task.successMessage || "已发送到拾光", "success", 2200);
    }
    return {
      success: true,
      result,
    };
  } catch (error) {
    console.error("Failed to import image:", error);
    const errorMessage = getErrorMessage(error);

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

  return enqueueImportTask({
    tabId,
    imageUrl,
    referer,
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

  await collectImage({
    tabId,
    imageUrl,
    referer,
    missingImageMessage: "未找到图片，请右键点击图片后重试",
    notifyOnSuccess: true,
  });
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

async function captureVisibleAndImport(tab) {
  const dataUrl = await captureVisibleDataUrl(tab);
  return importDataUrlToShiguang(dataUrl, {
    filename: "visible-screenshot.png",
  });
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
      await captureVisibleAndImport(tab);
      await notifyResult(tab.id, "已收藏可视范围截图", "success", 2200);
    } catch (error) {
      await notifyResult(tab.id, `截图失败: ${getErrorMessage(error)}`, "error", 3600);
    }
  }
});

// Check server connection
async function checkServerConnection() {
  try {
    const response = await fetch(`${SHIGUANG_SERVER_URL}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

// Export for popup
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
    }).then(sendResponse);
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
    const tab = _sender.tab;
    if (!tab) {
      sendResponse({ success: false, error: "未找到当前标签页" });
      return true;
    }

    captureVisibleAndImport(tab)
      .then((result) => sendResponse({ success: true, result }))
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
    })
      .then((result) => sendResponse({ success: true, result }))
      .catch((error) => sendResponse({ success: false, error: getErrorMessage(error) }));
    return true;
  }
});
