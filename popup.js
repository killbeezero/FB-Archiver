// ============================================================
// FB 自動封存舊貼文 - Popup Script  v1.4
// 新增：popup 重新開啟時，從 chrome.storage 恢復進度顯示
// ============================================================

let daysOld = 2;
let isRunning = false;

// DOM 元素參考
const btnMinus     = document.getElementById('btnMinus');
const btnPlus      = document.getElementById('btnPlus');
const daysDisplay  = document.getElementById('daysDisplay');
const btnStart     = document.getElementById('btnStart');
const btnStop      = document.getElementById('btnStop');
const progressCard = document.getElementById('progressCard');
const progressBar  = document.getElementById('progressBar');
const progressMsg  = document.getElementById('progressMessage');
const statArchived = document.getElementById('statArchived');
const statSkipped  = document.getElementById('statSkipped');
const statErrors   = document.getElementById('statErrors');
const mainUI       = document.getElementById('mainUI');
const notFbUI      = document.getElementById('notFbUI');

// ============================================================
// 初始化：檢查 Facebook + 恢復上次進度
// ============================================================
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isFacebook = tab && tab.url && tab.url.includes('facebook.com');

  if (!isFacebook) {
    mainUI.style.display = 'none';
    notFbUI.style.display = 'block';
    return;
  }

  mainUI.style.display = 'block';
  notFbUI.style.display = 'none';

  // ★ 從 storage 讀取上次的進度狀態
  chrome.storage.local.get('fbArchiverProgress', (result) => {
    const saved = result.fbArchiverProgress;
    if (!saved) return;

    // 恢復進度數字顯示
    updateProgress(saved);

    if (saved.status === 'running') {
      // 仍在執行中：切換到執行狀態，並重新掛上 progressListener
      setRunningState(true);
      chrome.runtime.onMessage.addListener(progressListener);
    }
    // 若 status === 'done'，只顯示結果，不切換狀態
  });
}

// ============================================================
// 天數加減按鈕
// ============================================================
btnMinus.addEventListener('click', () => {
  if (daysOld > 1) { daysOld--; daysDisplay.textContent = daysOld; }
});
btnPlus.addEventListener('click', () => {
  if (daysOld < 365) { daysOld++; daysDisplay.textContent = daysOld; }
});

// ============================================================
// 開始封存按鈕
// ============================================================
btnStart.addEventListener('click', async () => {
  if (isRunning) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.includes('facebook.com')) {
    alert('請先前往 Facebook 個人頁面再使用此功能！');
    return;
  }

  const confirmed = confirm(
    `確定要封存超過 ${daysOld} 天的貼文嗎？\n\n` +
    `• 自己的貼文 → 移到「儲藏盒」\n` +
    `• 好友標記你的貼文 → 從個人檔案隱藏\n` +
    `• 請確認目前在「自己的個人頁面」`
  );
  if (!confirmed) return;

  // 清除上次的舊進度
  chrome.storage.local.remove('fbArchiverProgress');

  setRunningState(true);
  chrome.runtime.onMessage.addListener(progressListener);

  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'startArchiving', daysOld });
  } catch (e) {
    // content script 可能未載入，嘗試重新注入
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tab.id, { action: 'startArchiving', daysOld });
    } catch (e2) {
      alert('無法執行腳本，請重新整理 Facebook 頁面後再試。\n錯誤：' + e2.message);
      setRunningState(false);
      chrome.runtime.onMessage.removeListener(progressListener);
    }
  }
});

// ============================================================
// 停止按鈕
// ============================================================
btnStop.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) await chrome.tabs.sendMessage(tab.id, { action: 'stopArchiving' });
  } catch (e) {}
  // 更新 storage 狀態為 done
  chrome.storage.local.get('fbArchiverProgress', (r) => {
    const cur = r.fbArchiverProgress || {};
    const updated = { ...cur, status: 'done', message: '使用者手動停止' };
    chrome.storage.local.set({ fbArchiverProgress: updated });
    updateProgress(updated);
  });
  setRunningState(false);
  chrome.runtime.onMessage.removeListener(progressListener);
});

// ============================================================
// 接收來自 content script 的進度訊息
// ============================================================
function progressListener(message) {
  if (message.type === 'progress') {
    updateProgress(message);
    if (message.status === 'done') {
      setRunningState(false);
      chrome.runtime.onMessage.removeListener(progressListener);
    }
  }
}

// ============================================================
// 更新進度顯示
// ============================================================
function updateProgress(data) {
  progressCard.style.display = 'block';
  progressMsg.textContent = data.message || '';

  if (data.archived !== undefined) statArchived.textContent = data.archived;
  if (data.skipped  !== undefined) statSkipped.textContent  = data.skipped;
  if (data.errors   !== undefined) statErrors.textContent   = data.errors;

  if (data.status === 'done') {
    progressBar.classList.add('done');
    progressBar.style.width = '100%';
  } else {
    progressBar.classList.remove('done');
    const cur = parseFloat(progressBar.style.width) || 5;
    progressBar.style.width = Math.min(cur + Math.random() * 5 + 1, 90) + '%';
  }
}

// ============================================================
// 切換執行/停止狀態的 UI
// ============================================================
function setRunningState(running) {
  isRunning = running;
  btnStart.disabled = running;
  btnStart.textContent = running ? '⏳ 封存中...' : '🚀 開始封存舊貼文';
  btnStop.style.display = running ? 'block' : 'none';
  btnMinus.disabled = running;
  btnPlus.disabled  = running;

  if (running && progressBar.style.width === '') {
    // 只有全新開始才重置進度條，恢復狀態不重置
    progressCard.style.display = 'block';
    progressBar.style.width = '5%';
    progressBar.classList.remove('done');
    progressMsg.textContent = '準備中...';
    statArchived.textContent = '0';
    statSkipped.textContent  = '0';
    statErrors.textContent   = '0';
  }
}

// 頁面載入時初始化
document.addEventListener('DOMContentLoaded', init);
