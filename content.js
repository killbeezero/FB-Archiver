// ============================================================
// FB 自動封存舊貼文 - Content Script  v1.4
// 新增：
//   1. 進度儲存到 chrome.storage.local（popup 重開後可恢復顯示）
//   2. 好友 tag 自己的貼文改點「從個人檔案隱藏」
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startArchiving') {
    archiveOldPosts(message.daysOld || 2)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (message.action === 'stopArchiving') {
    stopFlag = true;
    sendResponse({ success: true });
  }
});

let stopFlag = false;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sendProgress(data) {
  // 傳送給 popup（若開著）
  try { chrome.runtime.sendMessage({ type: 'progress', ...data }); } catch (e) {}
  // ★ 同步儲存到 storage，讓 popup 重新開啟後可恢復進度
  try { chrome.storage.local.set({ fbArchiverProgress: data }); } catch (e) {}
}

// ============================================================
// 主流程：找所有「更多」按鈕，逐一判斷時間並封存
// ============================================================
async function archiveOldPosts(daysOld = 2) {
  stopFlag = false;
  const threshold = Date.now() - daysOld * 24 * 3600 * 1000;

  let archived = 0, skipped = 0, errors = 0;
  const processedBtns = new WeakSet(); // 已處理過的按鈕（避免重複）

  sendProgress({ status: 'running', archived, skipped, errors, message: '開始掃描貼文...' });

  const maxScrolls = 80;
  let emptyCount = 0;

  for (let scroll = 0; scroll < maxScrolls; scroll++) {
    if (stopFlag) break;

    // ★ 核心：找所有「可對此貼文採取的動作」按鈕
    const moreBtns = [...document.querySelectorAll('[aria-label]')]
      .filter(el => {
        const label = el.getAttribute('aria-label') || '';
        return label.includes('可對此貼文採取的動作') || label === '更多';
      });

    let foundNew = false;

    for (const btn of moreBtns) {
      if (stopFlag) break;
      if (processedBtns.has(btn)) continue;
      processedBtns.add(btn);
      foundNew = true;

      // 找這個按鈕附近的時間文字
      const timeText = findTimeNearBtn(btn);
      const timestamp = parseTimeText(timeText);

      const dbgTime = timestamp ? new Date(timestamp).toLocaleString('zh-TW') : '無法解析';
      console.log(`[FB封存] 「${timeText}」→ ${dbgTime} | ${
        timestamp === null ? '略過(無法解析)' :
        timestamp < threshold ? '封存！' : '太新略過'
      }`);

      if (timestamp === null) {
        skipped++;
        continue;
      }

      if (timestamp < threshold) {
        sendProgress({ status: 'running', archived, skipped, errors,
          message: `封存「${timeText}」中...（已掃描 ${archived + skipped + errors} 篇）` });

        const result = await archiveWithBtn(btn);
        if (result === 'archived' || result === 'hidden') archived++;
        else if (result === 'not_own_post') skipped++;
        else errors++;

        await sleep(1200 + Math.random() * 600);
      } else {
        skipped++;
      }
    }

    if (!foundNew) {
      emptyCount++;
      if (emptyCount >= 4) break;
    } else {
      emptyCount = 0;
    }

    window.scrollBy(0, window.innerHeight * 1.5);
    await sleep(1800 + Math.random() * 600);
  }

  const msg = stopFlag
    ? `已停止。封存 ${archived} 篇，略過 ${skipped} 篇，失敗 ${errors} 篇`
    : `完成！封存 ${archived} 篇，略過 ${skipped} 篇，失敗 ${errors} 篇`;

  sendProgress({ status: 'done', archived, skipped, errors, message: msg });
  return { archived, skipped, errors };
}

// ============================================================
// 從「更多」按鈕往上走DOM，找附近的時間文字
// ============================================================
function findTimeNearBtn(btn) {
  let el = btn;
  for (let depth = 0; depth < 20; depth++) {
    if (!el) break;
    for (const a of el.querySelectorAll('a')) {
      const t = (a.innerText || a.textContent || '').trim();
      if (isTimeText(t)) return t;
    }
    el = el.parentElement;
  }
  return null;
}

// 判斷一段文字是否為時間格式
function isTimeText(str) {
  if (!str || str.length > 35) return false;  // 放寬到 35（含年份的完整格式最長約 20 字）
  return /^\d+\s*(小時|分鐘|天|週|個月|年)$/.test(str) ||
         /^昨天/.test(str) ||
         /^\d{1,2}月\d{1,2}日/.test(str) ||
         /^\d{4}年\d{1,2}月\d{1,2}日/.test(str) ||  // 含年份的日期（含或不含時間）
         str === '剛剛';
}

// ============================================================
// 解析時間文字（根據瀏覽器實測的實際格式）
// 確認格式（無「前」字、無空格）：
//   「8 小時」「1天」「昨天上午12:02」「4月11日下午1:39」
// ============================================================
function parseTimeText(str) {
  if (!str) return null;
  const now = Date.now();
  const yr = new Date().getFullYear();
  str = str.trim();

  if (str === '剛剛') return now;

  let m;
  // 「X 分鐘」或「X分鐘」
  m = str.match(/^(\d+)\s*分鐘$/); if (m) return now - +m[1] * 60000;
  // 「X 小時」或「X小時」
  m = str.match(/^(\d+)\s*小時$/); if (m) return now - +m[1] * 3600000;
  // 「X 天」或「X天」
  m = str.match(/^(\d+)\s*天$/); if (m) return now - +m[1] * 86400000;
  // 「X 週」
  m = str.match(/^(\d+)\s*週$/); if (m) return now - +m[1] * 7 * 86400000;
  // 「X 個月」
  m = str.match(/^(\d+)\s*個月$/); if (m) return now - +m[1] * 30 * 86400000;
  // 「X 年」
  m = str.match(/^(\d+)\s*年$/); if (m) return now - +m[1] * 365 * 86400000;

  // 相容「前」結尾版本
  m = str.match(/^(\d+)\s*(分鐘|小時|天|週|個月|年)前$/);
  if (m) {
    const u = { 分鐘:60000, 小時:3600000, 天:86400000, 週:604800000, 個月:2592000000, 年:31536000000 };
    return now - +m[1] * u[m[2]];
  }

  // 「昨天上午12:02」「昨天下午1:30」（直接相連，無空格）
  m = str.match(/^昨天(上午|下午)?(\d{1,2}):(\d{2})$/);
  if (m) {
    let h = +m[2];
    if (m[1] === '下午' && h !== 12) h += 12;
    if (m[1] === '上午' && h === 12) h = 0;
    const d = new Date(now - 86400000);
    d.setHours(h, +m[3], 0, 0);
    return d.getTime();
  }
  if (str === '昨天') return now - 86400000;

  // 「4月11日下午1:39」（無空格）
  m = str.match(/^(\d{1,2})月(\d{1,2})日(上午|下午)?(\d{1,2}):(\d{2})$/);
  if (m) {
    let h = +m[4];
    if (m[3] === '下午' && h !== 12) h += 12;
    if (m[3] === '上午' && h === 12) h = 0;
    const dt = new Date(yr, +m[1] - 1, +m[2], h, +m[5]);
    if (dt.getTime() > now) dt.setFullYear(yr - 1);
    return isNaN(dt.getTime()) ? null : dt.getTime();
  }

  // 「4月11日」（只有日期）
  m = str.match(/^(\d{1,2})月(\d{1,2})日$/);
  if (m) {
    const dt = new Date(yr, +m[1] - 1, +m[2]);
    if (dt.getTime() > now) dt.setFullYear(yr - 1);
    return isNaN(dt.getTime()) ? null : dt.getTime();
  }

  // 「2025年11月15日下午3:45」（含年份 + 時間）
  m = str.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日(上午|下午)?(\d{1,2}):(\d{2})$/);
  if (m) {
    let h = +m[5];
    if (m[4] === '下午' && h !== 12) h += 12;
    if (m[4] === '上午' && h === 12) h = 0;
    return new Date(+m[1], +m[2] - 1, +m[3], h, +m[6]).getTime();
  }

  // ★ 新增：「2025年11月15日」（含年份，但無時間 ← 2025年以前舊貼文常見此格式）
  m = str.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (m) {
    return new Date(+m[1], +m[2] - 1, +m[3], 0, 0).getTime();
  }

  // ★ 新增：「2025年11月」（只有年月，無日期 ← 極少數情況）
  m = str.match(/^(\d{4})年(\d{1,2})月$/);
  if (m) {
    return new Date(+m[1], +m[2] - 1, 1).getTime();
  }

  return null;
}

// ============================================================
// 點擊「更多」按鈕並執行封存
// ============================================================
async function archiveWithBtn(btn) {
  try {
    btn.click();
    await sleep(900);

    // ★ 優先檢查：是否誤觸「關於這則內容」對話窗（廣告／粉絲頁貼文常見）
    if (isAboutContentDialogOpen()) {
      console.log('[FB封存] 誤觸「關於這則內容」對話窗，自動關閉並略過');
      closeAboutContentDialog();
      await sleep(500);
      return 'not_own_post';
    }

    // 情況1：自己的貼文 → 有「移到儲藏盒」
    const archiveItem = findMenuOption('移到儲藏盒');
    if (archiveItem) {
      archiveItem.click();
      await sleep(900);
      // 關閉後再確認一次沒有殘留對話窗
      if (isAboutContentDialogOpen()) { closeAboutContentDialog(); await sleep(400); }
      return 'archived';
    }

    // 情況2：好友 tag 自己的貼文 → 只有「從個人檔案隱藏」（無儲藏盒選項）
    const hideItem = findMenuOption('從個人檔案隱藏');
    if (hideItem) {
      console.log('[FB封存] 好友標記的貼文，改點「從個人檔案隱藏」');
      hideItem.click();
      await sleep(900);
      return 'hidden';
    }

    // 選單裡兩個都沒有 → 略過
    console.log('[FB封存] 選單無對應選項，略過此貼文');
    closeMenu();
    await sleep(400);
    return 'not_own_post';
  } catch (e) {
    console.error('[FB封存] 操作失敗:', e);
    // 出錯時一併清理可能殘留的對話窗
    if (isAboutContentDialogOpen()) closeAboutContentDialog();
    else closeMenu();
    return 'error';
  }
}

// ============================================================
// 偵測「關於這則內容」對話窗是否開著
// ============================================================
function isAboutContentDialogOpen() {
  // 找 role="dialog" 且含有「關於這則內容」文字
  for (const dialog of document.querySelectorAll('[role="dialog"]')) {
    if (dialog.textContent.includes('關於這則內容')) return true;
  }
  // 備用：找任何含此標題的 div（FB 有時不用 role="dialog"）
  for (const el of document.querySelectorAll('h2, h3, [role="heading"]')) {
    if (el.textContent.trim() === '關於這則內容') return true;
  }
  return false;
}

// ============================================================
// 關閉「關於這則內容」對話窗
// ============================================================
function closeAboutContentDialog() {
  // 方法1：找對話窗內的關閉按鈕（aria-label="關閉" 或 "Close"）
  const closeLabels = ['關閉', 'Close', '×', 'Dismiss'];
  for (const label of closeLabels) {
    const btn = document.querySelector(`[aria-label="${label}"]`);
    if (btn) { btn.click(); return; }
  }
  // 方法2：找對話窗右上角的 X 按鈕（通常是最後一個 role="button"）
  const dialog = [...document.querySelectorAll('[role="dialog"]')]
    .find(d => d.textContent.includes('關於這則內容'));
  if (dialog) {
    const btns = dialog.querySelectorAll('[role="button"]');
    if (btns.length > 0) { btns[btns.length - 1].click(); return; }
  }
  // 方法3：按 Escape 鍵
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

// ============================================================
// 在選單中找「移到儲藏盒」
// ============================================================
function findMenuOption(text) {
  for (const el of document.querySelectorAll('[role="menuitem"]')) {
    if (el.textContent.includes(text)) return el;
  }
  for (const span of document.querySelectorAll('span')) {
    if (span.textContent.trim() === text) {
      const clickable = span.closest('[role="menuitem"],[role="button"],li,a');
      if (clickable) return clickable;
    }
  }
  return null;
}

function closeMenu() {
  try {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  } catch (e) { document.body.click(); }
}
