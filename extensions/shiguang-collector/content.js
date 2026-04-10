// Content Script - 在页面中执行
// 处理小红书自定义右键菜单，注入"发送到拾光"选项

const TOAST_CONTAINER_ID = 'shiguang-toast-container';
const TOAST_REMOVE_DELAY = 240;

// 保存最后一次右键点击时的图片 URL
let lastImageUrl = null;

// 保存最后一次右键点击时的目标元素
let lastRightClickTarget = null;

function ensureToastContainer() {
  let container = document.getElementById(TOAST_CONTAINER_ID);
  if (container) {
    return container;
  }

  container = document.createElement('div');
  container.id = TOAST_CONTAINER_ID;
  container.setAttribute('aria-live', 'polite');
  container.style.cssText = [
    'position: fixed',
    'top: 16px',
    'right: 16px',
    'display: flex',
    'flex-direction: column',
    'align-items: flex-end',
    'gap: 10px',
    'width: min(360px, calc(100vw - 32px))',
    'z-index: 2147483647',
    'pointer-events: none'
  ].join(';');

  (document.body || document.documentElement).appendChild(container);
  return container;
}

function showToast(message, type = 'info', duration = 3000) {
  const theme = {
    success: {
      border: '#16a34a',
      icon: '✓'
    },
    error: {
      border: '#dc2626',
      icon: '!'
    },
    info: {
      border: '#2563eb',
      icon: 'i'
    }
  };

  const currentTheme = theme[type] || theme.info;
  const container = ensureToastContainer();
  const toast = document.createElement('div');
  toast.setAttribute('role', 'status');
  toast.style.cssText = [
    'display: flex',
    'align-items: flex-start',
    'gap: 10px',
    'width: 100%',
    'padding: 12px 14px',
    'border-radius: 12px',
    'border: 1px solid rgba(255, 255, 255, 0.12)',
    `border-left: 4px solid ${currentTheme.border}`,
    'background: rgba(17, 24, 39, 0.94)',
    'box-shadow: 0 14px 30px rgba(15, 23, 42, 0.28)',
    'color: #f9fafb',
    'font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    'transform: translateY(-8px)',
    'opacity: 0',
    'transition: opacity 0.24s ease, transform 0.24s ease',
    'backdrop-filter: blur(10px)',
    'pointer-events: none'
  ].join(';');

  const icon = document.createElement('div');
  icon.textContent = currentTheme.icon;
  icon.style.cssText = [
    'width: 18px',
    'height: 18px',
    'border-radius: 999px',
    `background: ${currentTheme.border}`,
    'color: #fff',
    'display: flex',
    'align-items: center',
    'justify-content: center',
    'font-size: 12px',
    'font-weight: 700',
    'flex-shrink: 0',
    'margin-top: 1px'
  ].join(';');

  const content = document.createElement('div');
  content.textContent = message;
  content.style.cssText = [
    'flex: 1',
    'min-width: 0',
    'word-break: break-word'
  ].join(';');

  toast.appendChild(icon);
  toast.appendChild(content);
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  const removeToast = () => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-8px)';
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
  const message = error instanceof Error ? error.message : String(error || '网络错误');
  if (message === 'Failed to fetch') {
    return '无法连接到拾光应用，请确保应用正在运行';
  }
  return message;
}

async function requestCollectImage(imageUrl, options = {}) {
  const response = await chrome.runtime.sendMessage({
    action: 'collectImage',
    payload: {
      imageUrl,
      referer: options.referer || window.location.href,
      missingImageMessage: options.missingImageMessage,
      notifyOnSuccess: options.notifyOnSuccess,
      successMessage: options.successMessage
    }
  });

  if (!response) {
    throw new Error('拾光采集器后台未响应');
  }

  return response;
}

// 尝试从元素中获取图片 URL
function getImageUrlFromElement(target) {
  const element = target?.nodeType === Node.TEXT_NODE ? target.parentElement : target;
  if (!(element instanceof Element)) return null;

  // 1. 检查是否是图片元素
  if (element.tagName === 'IMG') {
    // 优先使用 data-src 或 data-original 等懒加载属性
    return element.dataset.src || element.dataset.original || element.dataset.lazy || element.src;
  }

  // 2. 检查 data-src 属性
  if (element.dataset.src || element.dataset.original) {
    return element.dataset.src || element.dataset.original;
  }

  // 3. 检查是否是背景图片
  const style = window.getComputedStyle(element);
  const bgImage = style.backgroundImage;

  if (bgImage && bgImage !== 'none' && bgImage.startsWith('url(')) {
    const urlMatch = bgImage.match(/url\(["']?([^"')]+)["']?\)/);
    if (urlMatch) {
      return urlMatch[1];
    }
  }

  // 4. 检查子元素是否有图片
  const img = element.querySelector('img');
  if (img) {
    return img.dataset.src || img.dataset.original || img.dataset.lazy || img.src;
  }

  // 5. 查找父元素中的图片
  let parent = element.parentElement;
  while (parent && parent !== document.body) {
    const img = parent.querySelector('img');
    if (img) {
      return img.dataset.src || img.dataset.original || img.dataset.lazy || img.src;
    }
    parent = parent.parentElement;
  }

  return null;
}

// 监听页面的右键点击事件
document.addEventListener('contextmenu', (event) => {
  const target = event.target;
  lastRightClickTarget = target;
  lastImageUrl = getImageUrlFromElement(target);
  console.log('右键点击:', target?.tagName || target?.nodeName, '图片URL:', lastImageUrl);
});

document.addEventListener('click', async (event) => {
  if (event.button !== 0 || !event.altKey) {
    return;
  }

  const target = event.target;
  const imageUrl = getImageUrlFromElement(target);

  if (!imageUrl) {
    return;
  }

  lastRightClickTarget = target;
  lastImageUrl = imageUrl;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  try {
    const result = await requestCollectImage(imageUrl, {
      missingImageMessage: '未找到可采集的图片',
      notifyOnSuccess: true,
      successMessage: '已发送到拾光'
    });

    if (!result.success) {
      throw new Error(result.error || '未知错误');
    }
  } catch (error) {
    console.error('Alt+左键发送到拾光失败:', error);
    showToast('发送失败: ' + getErrorMessage(error), 'error', 3600);
  }
}, true);

// 小红书自定义菜单处理
function handleXiaohongshuMenu() {
  // 监听 DOM 变化，检测自定义菜单是否出现
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        // 检查是否是菜单容器
        if (node.nodeType === Node.ELEMENT_NODE) {
          const menuContainer = node.classList?.contains('context-menu-container')
            ? node
            : node.querySelector?.('.context-menu-container');

          if (menuContainer && !menuContainer.dataset.shiguangInjected) {
            injectMenuItem(menuContainer);
          }
        }
      }

      // 检查已存在的菜单
      const existingMenus = document.querySelectorAll('.context-menu-container:not([data-shiguang-injected])');
      existingMenus.forEach(injectMenuItem);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// 向菜单中注入自定义选项
function injectMenuItem(menuContainer) {
  if (!menuContainer || menuContainer.dataset.shiguangInjected) return;

  // 标记已处理
  menuContainer.dataset.shiguangInjected = 'true';

  // 保存菜单位置
  const menuRect = menuContainer.getBoundingClientRect();

  // 创建发送到拾光的菜单项
  const menuItem = document.createElement('div');
  menuItem.className = 'menu-item';
  menuItem.setAttribute('data-v-26f6a4d9', '');
  menuItem.textContent = '发送到拾光';

  menuItem.addEventListener('click', async (event) => {
    event.stopPropagation();

    // 点击时再获取图片，而不是在菜单出现时
    // 优先使用最后右键点击的图片
    let imageUrl = lastImageUrl;

    // 如果没有，尝试从最后右键点击的目标获取
    if (!imageUrl && lastRightClickTarget) {
      imageUrl = getImageUrlFromElement(lastRightClickTarget);
    }

    // 如果还是没有，根据菜单位置找到最近的大图
    if (!imageUrl) {
      const allImages = Array.from(document.querySelectorAll('img'))
        .filter(img => img.naturalWidth > 100 && img.offsetParent !== null);

      if (allImages.length > 0) {
        // 找到距离菜单最近的那张图片
        let closestImg = null;
        let closestDist = Infinity;

        for (const img of allImages) {
          const rect = img.getBoundingClientRect();
          const imgCenterX = rect.x + rect.width / 2;
          const imgCenterY = rect.y + rect.height / 2;
          const menuCenterX = menuRect.x + menuRect.width / 2;
          const menuCenterY = menuRect.y + menuRect.height / 2;

          const dist = Math.sqrt(
            Math.pow(imgCenterX - menuCenterX, 2) +
            Math.pow(imgCenterY - menuCenterY, 2)
          );

          if (dist < closestDist) {
            closestDist = dist;
            closestImg = img;
          }
        }

        if (closestImg) {
          imageUrl = getImageUrlFromElement(closestImg);
        }
      }
    }

    // 如果还是没有图片，提示用户
    if (!imageUrl) {
      showToast('未找到图片，请右键点击图片后重试', 'error');
      return;
    }

    console.log('发送图片:', imageUrl);

    // 显示处理中
    menuItem.textContent = '正在发送...';

    try {
      const result = await requestCollectImage(imageUrl, {
        missingImageMessage: '未找到图片，请右键点击图片后重试'
      });

      if (result.success) {
        menuItem.textContent = '发送成功';
        setTimeout(() => {
          menuItem.textContent = '发送到拾光';
        }, 1200);
      } else {
        const errorMsg = result.error || '未知错误';
        menuItem.textContent = '发送失败: ' + errorMsg;
        showToast('发送失败: ' + errorMsg, 'error', 3600);
        setTimeout(() => {
          menuItem.textContent = '发送到拾光';
        }, 3000);
      }
    } catch (error) {
      console.error('发送到拾光失败:', error);
      const errorMsg = getErrorMessage(error);
      menuItem.textContent = '发送失败: ' + errorMsg;
      showToast('发送失败: ' + errorMsg, 'error', 3600);
      setTimeout(() => {
        menuItem.textContent = '发送到拾光';
      }, 3000);
    }
  });

  // 添加分隔线
  const divider = document.createElement('div');
  divider.style.cssText = 'border-top: 1px solid #eee; margin: 4px 0;';

  // 将新菜单项添加到菜单容器开头
  menuContainer.insertBefore(divider, menuContainer.firstChild);
  menuContainer.insertBefore(menuItem, divider);
}

// 检测是否是小红书页面
if (window.location.hostname.includes('xiaohongshu.com')) {
  // 等待页面加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handleXiaohongshuMenu);
  } else {
    handleXiaohongshuMenu();
  }
}

// 监听来自 background script 的消息
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'getLastImageUrl') {
    sendResponse({ imageUrl: lastImageUrl });
    return true;
  }

  if (message.action === 'showToast') {
    const payload = message.payload || {};
    showToast(payload.message || '', payload.type || 'info', payload.duration || 3000);
    sendResponse({ success: true });
    return true;
  }
});
