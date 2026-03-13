// Content Script - 在页面中执行
// 处理右键菜单，获取鼠标位置的图片

// 保存最后一次右键点击时的图片 URL
let lastImageUrl = null;

// 监听页面的右键点击事件
document.addEventListener('contextmenu', (event) => {
  const target = event.target;

  // 检查是否是图片元素
  if (target.tagName === 'IMG') {
    lastImageUrl = target.src;
    return;
  }

  // 检查是否是背景图片
  const style = window.getComputedStyle(target);
  const bgImage = style.backgroundImage;

  if (bgImage && bgImage !== 'none' && bgImage.startsWith('url(')) {
    const urlMatch = bgImage.match(/url\(["']?([^"')]+)["']?\)/);
    if (urlMatch) {
      lastImageUrl = urlMatch[1];
      return;
    }
  }

  // 检查子元素是否有图片
  const img = target.querySelector('img');
  if (img) {
    lastImageUrl = img.src;
    return;
  }

  lastImageUrl = null;
});

// 监听来自 background script 的消息
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'getLastImageUrl') {
    sendResponse({ imageUrl: lastImageUrl });
    return true;
  }
});
