// Popup Script

document.addEventListener('DOMContentLoaded', () => {
  checkConnection();
});

async function checkConnection() {
  const statusDot = document.querySelector('.status-dot');
  const statusText = document.querySelector('.status-text');

  statusText.textContent = '检查中...';

  try {
    const response = await chrome.runtime.sendMessage({ action: 'checkConnection' });
    if (response.connected) {
      statusDot.className = 'status-dot connected';
      statusText.textContent = '已连接';
    } else {
      statusDot.className = 'status-dot disconnected';
      statusText.textContent = '未连接';
    }
  } catch (error) {
    statusDot.className = 'status-dot disconnected';
    statusText.textContent = '未连接';
  }
}
