// 拾光采集器 - Background Script

const SHIGUANG_SERVER_URL = 'http://127.0.0.1:7845';

async function showPageToast(tabId, message, type = 'info', duration = 3000) {
  if (!tabId) {
    return false;
  }

  try {
    await chrome.tabs.sendMessage(tabId, {
      action: 'showToast',
      payload: {
        message,
        type,
        duration
      }
    });
    return true;
  } catch (error) {
    console.warn('Failed to show page toast:', error);
    return false;
  }
}

function getErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error || '未知错误');
  if (message === 'Failed to fetch') {
    return '无法连接到拾光应用，请确保应用正在运行';
  }
  return message;
}

async function notifyResult(tabId, message, type = 'info', duration = 3000) {
  const shownInPage = await showPageToast(tabId, message, type, duration);
  if (shownInPage) {
    return;
  }

  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: '拾光采集器',
    message
  });
}

// Create context menu when extension is installed
chrome.runtime.onInstalled.addListener(() => {
  // 使用 'page' context 然后在 content script 中检查点击的是否是图片
  // 这样可以处理更多网站（如 SPA、懒加载等）
  chrome.contextMenus.create({
    id: 'sendToShiguang',
    title: '发送给拾光',
    contexts: ['page', 'image']
  });
});

// Listen for context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const tabId = tab?.id;
  const referer = tab?.url || info.pageUrl;

  // 优先使用 srcUrl
  let imageUrl = info.srcUrl;

  // 如果没有 srcUrl，从 content script 获取最后一次右键点击的图片
  if (!imageUrl && tabId) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        action: 'getLastImageUrl'
      });
      if (response && response.imageUrl) {
        imageUrl = response.imageUrl;
      }
    } catch (error) {
      console.error('Failed to get image from content script:', error);
    }
  }

  if (imageUrl) {
    try {
      // Send image URL and page URL (referer) to backend for downloading
      const importResponse = await fetch(`${SHIGUANG_SERVER_URL}/api/import-from-url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          image_url: imageUrl,
          referer
        })
      });

      if (!importResponse.ok) {
        const errorText = await importResponse.text();
        throw new Error(`Server error: ${errorText}`);
      }

      const result = await importResponse.json();

      if (result.success) {
        return;
      } else {
        throw new Error(result.error || 'Unknown error');
      }
    } catch (error) {
      console.error('Failed to import image:', error);
      await notifyResult(tabId, `发送失败: ${getErrorMessage(error)}`, 'error', 3600);
    }
  } else {
    await notifyResult(tabId, '未找到图片，请右键点击图片后重试', 'error');
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
  if (message.action === 'checkConnection') {
    checkServerConnection().then(connected => {
      sendResponse({ connected });
    });
    return true;
  }
});
