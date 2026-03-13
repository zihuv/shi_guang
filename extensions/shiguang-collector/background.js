// 拾光采集器 - Background Script

const SHIGUANG_SERVER_URL = 'http://127.0.0.1:7845';

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
  // 优先使用 srcUrl
  let imageUrl = info.srcUrl;

  // 如果没有 srcUrl，从 content script 获取最后一次右键点击的图片
  if (!imageUrl) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
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
      // Show notification that we're processing
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: '拾光采集器',
        message: '正在采集图片...'
      });

      // Send image URL and page URL (referer) to backend for downloading
      const importResponse = await fetch(`${SHIGUANG_SERVER_URL}/api/import-from-url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          image_url: imageUrl,
          referer: tab.url
        })
      });

      if (!importResponse.ok) {
        const errorText = await importResponse.text();
        throw new Error(`Server error: ${errorText}`);
      }

      const result = await importResponse.json();

      if (result.success) {
        // Update stats
        const stats = await getStats();
        await setStats(stats.collected + 1);

        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: '拾光采集器',
          message: `图片已采集成功！共采集 ${stats.collected + 1} 张图片`
        });
      } else {
        throw new Error(result.error || 'Unknown error');
      }
    } catch (error) {
      console.error('Failed to import image:', error);
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: '拾光采集器',
        message: `采集失败: ${error.message}`
      });
    }
  }
});

// Stats management
async function getStats() {
  const result = await chrome.storage.local.get('stats');
  return result.stats || { collected: 0 };
}

async function setStats(stats) {
  await chrome.storage.local.set({ stats });
}

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

  if (message.action === 'getStats') {
    getStats().then(stats => {
      sendResponse(stats);
    });
    return true;
  }
});
