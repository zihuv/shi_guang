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

async function importImageToShiguang(imageUrl, referer) {
  const response = await fetch(`${SHIGUANG_SERVER_URL}/api/import-from-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      image_url: imageUrl,
      referer
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Server error: ${errorText || `HTTP ${response.status}`}`);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || 'Unknown error');
  }

  return result;
}

async function collectImage({
  tabId,
  imageUrl,
  referer,
  missingImageMessage = '未找到图片，请右键点击图片后重试',
  notifyOnError = true,
  notifyOnSuccess = false,
  successMessage = '已发送到拾光'
}) {
  if (!imageUrl) {
    if (notifyOnError) {
      await notifyResult(tabId, missingImageMessage, 'error');
    }

    return {
      success: false,
      error: missingImageMessage
    };
  }

  try {
    const result = await importImageToShiguang(imageUrl, referer);
    if (notifyOnSuccess) {
      await notifyResult(tabId, successMessage, 'success', 2200);
    }
    return {
      success: true,
      result
    };
  } catch (error) {
    console.error('Failed to import image:', error);
    const errorMessage = getErrorMessage(error);

    if (notifyOnError) {
      await notifyResult(tabId, `发送失败: ${errorMessage}`, 'error', 3600);
    }

    return {
      success: false,
      error: errorMessage
    };
  }
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
  let imageUrl = null;

  // 优先复用 content script 的取图结果，和 Alt+左键保持一致
  if (tabId) {
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

  // content script 未取到时，再回退到浏览器提供的 srcUrl
  if (!imageUrl) {
    imageUrl = info.srcUrl || null;
  }

  await collectImage({
    tabId,
    imageUrl,
    referer,
    missingImageMessage: '未找到图片，请右键点击图片后重试',
    notifyOnSuccess: true
  });
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
  if (message.action === 'collectImage') {
    const payload = message.payload || {};
    collectImage({
      tabId: _sender.tab?.id,
      imageUrl: payload.imageUrl,
      referer: payload.referer || _sender.tab?.url,
      missingImageMessage: payload.missingImageMessage || '未找到可采集的图片',
      notifyOnError: false,
      notifyOnSuccess: payload.notifyOnSuccess === true,
      successMessage: payload.successMessage || '已发送到拾光'
    }).then(sendResponse);
    return true;
  }

  if (message.action === 'checkConnection') {
    checkServerConnection().then(connected => {
      sendResponse({ connected });
    });
    return true;
  }
});
