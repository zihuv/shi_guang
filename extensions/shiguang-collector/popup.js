// Popup Script

document.addEventListener('DOMContentLoaded', () => {
  checkConnection();
  loadStats();

  // Refresh button
  document.getElementById('refreshBtn').addEventListener('click', () => {
    checkConnection();
    loadStats();
  });
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

async function loadStats() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getStats' });
    document.getElementById('collectedCount').textContent = response.collected || 0;
  } catch (error) {
    document.getElementById('collectedCount').textContent = '0';
  }
}
