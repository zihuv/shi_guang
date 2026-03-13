// Content Script - 在页面中执行
// 处理小红书自定义右键菜单，注入"发送到拾光"选项

const SHIGUANG_SERVER_URL = 'http://127.0.0.1:7845';

// 保存最后一次右键点击时的图片 URL
let lastImageUrl = null;

// 保存最后一次右键点击时的目标元素
let lastRightClickTarget = null;

// 尝试从元素中获取图片 URL
function getImageUrlFromElement(target) {
  if (!target) return null;

  // 1. 检查是否是图片元素
  if (target.tagName === 'IMG') {
    // 优先使用 data-src 或 data-original 等懒加载属性
    return target.dataset.src || target.dataset.original || target.dataset.lazy || target.src;
  }

  // 2. 检查 data-src 属性
  if (target.dataset.src || target.dataset.original) {
    return target.dataset.src || target.dataset.original;
  }

  // 3. 检查是否是背景图片
  const style = window.getComputedStyle(target);
  const bgImage = style.backgroundImage;

  if (bgImage && bgImage !== 'none' && bgImage.startsWith('url(')) {
    const urlMatch = bgImage.match(/url\(["']?([^"')]+)["']?\)/);
    if (urlMatch) {
      return urlMatch[1];
    }
  }

  // 4. 检查子元素是否有图片
  const img = target.querySelector('img');
  if (img) {
    return img.dataset.src || img.dataset.original || img.dataset.lazy || img.src;
  }

  // 5. 查找父元素中的图片
  let parent = target.parentElement;
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
  console.log('右键点击:', target.tagName, '图片URL:', lastImageUrl);
});

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
      alert('未找到图片，请右键点击图片后重试');
      return;
    }

    console.log('发送图片:', imageUrl);

    // 显示处理中
    menuItem.textContent = '正在发送...';

    try {
      console.log('发送到拾光:', SHIGUANG_SERVER_URL + '/api/import-from-url');

      const response = await fetch(`${SHIGUANG_SERVER_URL}/api/import-from-url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          image_url: imageUrl,
          referer: window.location.href
        })
      });

      const result = await response.json();

      if (result.success) {
        menuItem.textContent = '✓ 已发送到拾光';
        setTimeout(() => {
          menuItem.textContent = '发送到拾光';
        }, 2000);
      } else {
        menuItem.textContent = '发送失败: ' + (result.error || '未知错误');
        setTimeout(() => {
          menuItem.textContent = '发送到拾光';
        }, 3000);
      }
    } catch (error) {
      console.error('发送到拾光失败:', error);
      let errorMsg = error.message || '网络错误';
      if (error.message === 'Failed to fetch') {
        errorMsg = '无法连接到拾光应用，请确保应用正在运行';
      }
      menuItem.textContent = '发送失败: ' + errorMsg;
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
});
