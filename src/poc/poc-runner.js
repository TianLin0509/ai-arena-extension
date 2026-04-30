// AI Arena PoC — Runner logic
const PROMPTS = {
  short: '1+1等于几？',
  long: '写一首200字的现代诗，主题是"城市的黎明"',
  code: '用 Python 写一个快速排序算法，包含完整的代码和注释',
  think: '请分析量子计算相对于经典计算的三个核心优势和三个主要挑战',
  roleplay: '你是一个经验丰富的海盗船长，向船员描述一次惊险的冒险经历',
};

const MARKER_ROUND = 99;
const MARKER_INSTRUCTION = `\n（请在回答的最开头输出 ARENA_START_R${MARKER_ROUND}，最末尾输出 ARENA_DONE_R${MARKER_ROUND} 作为标记，不要解释这些标记）`;

let chatGPTTabId = null;
let injected = false;
let testHistory = [];
let currentResults = {};
let pollTimer = null;

// ──── UI refs ────
const $status     = document.getElementById('status');
const $log        = document.getElementById('log');
const $resultBody = document.getElementById('resultBody');
const $histBody   = document.getElementById('historyBody');
const $promptSel  = document.getElementById('promptSelect');
const $custom     = document.getElementById('customPrompt');
const $marker     = document.getElementById('includeMarker');
const $btnInject  = document.getElementById('btnInject');
const $btnRun     = document.getElementById('btnRun');
const $btnPoll    = document.getElementById('btnPoll');
const $btnExport  = document.getElementById('btnExport');

// ──── Status + Log ────
function setStatus(msg) { $status.textContent = msg; }
function addLog(msg) {
  const ts = new Date().toISOString().slice(11, 23);
  const div = document.createElement('div');
  div.innerHTML = `<span class="ts">[${ts}]</span> ${msg}`;
  $log.prepend(div);
  if ($log.children.length > 200) $log.lastChild.remove();
}

// ──── Find ChatGPT tab ────
async function findChatGPTTab() {
  const tabs = await chrome.tabs.query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] });
  if (tabs.length === 0) {
    setStatus('未找到 ChatGPT 标签页，请先打开 chatgpt.com');
    return null;
  }
  return tabs[0].id;
}

// ──── Step 1: Inject scripts ────
$btnInject.addEventListener('click', async () => {
  chatGPTTabId = await findChatGPTTab();
  if (!chatGPTTabId) return;

  try {
    // Inject MAIN world fetch hook
    await chrome.scripting.executeScript({
      target: { tabId: chatGPTTabId },
      files: ['poc/inject-net-tap.js'],
      world: 'MAIN'
    });
    addLog('MAIN world inject-net-tap.js 注入成功');

    // Inject ISOLATED world bridge
    await chrome.scripting.executeScript({
      target: { tabId: chatGPTTabId },
      files: ['poc/poc-bridge.js'],
      world: 'ISOLATED'
    });
    addLog('ISOLATED world poc-bridge.js 注入成功');

    injected = true;
    setStatus('脚本注入成功，可以发送测试 prompt');
  } catch (e) {
    setStatus(`注入失败: ${e.message}`);
    addLog(`注入错误: ${e.message}`);
  }
});

// ──── Step 2: Send prompt & start capture ────
$btnRun.addEventListener('click', async () => {
  if (!injected || !chatGPTTabId) {
    setStatus('请先注入脚本（步骤 1）');
    return;
  }

  const promptKey = $promptSel.value;
  let prompt = promptKey === 'custom' ? $custom.value.trim() : PROMPTS[promptKey];
  if (!prompt) { setStatus('请输入 prompt'); return; }

  // Reset UI
  resetResultRows();
  currentResults = {};

  // Append marker if enabled
  const withMarker = $marker.checked;
  const fullPrompt = withMarker ? prompt + MARKER_INSTRUCTION : prompt;

  // Tell bridge to start capture
  try {
    await chrome.tabs.sendMessage(chatGPTTabId, { type: 'poc-start-capture', prompt });
    addLog(`开始捕获 (marker=${withMarker})`);
  } catch (e) {
    addLog(`bridge 通信失败: ${e.message}，请重新注入`);
    setStatus('bridge 通信失败，请重新注入');
    return;
  }

  // Send prompt to ChatGPT via existing content script
  try {
    const resp = await chrome.tabs.sendMessage(chatGPTTabId, { action: 'inject', text: fullPrompt });
    addLog(`prompt 已发送: ${resp?.status || 'unknown'}`);
    setStatus('prompt 已发送，等待各方法捕获...');
  } catch (e) {
    addLog(`prompt 发送失败: ${e.message}`);
    setStatus('prompt 发送失败');
    return;
  }

  // Start auto-polling results every 2s
  startAutoPoll();
});

// ──── Step 3: Manual poll ────
$btnPoll.addEventListener('click', () => pullResults());

async function pullResults() {
  if (!chatGPTTabId) return;
  try {
    const r = await chrome.tabs.sendMessage(chatGPTTabId, { type: 'poc-get-results' });
    if (r) {
      currentResults = r;
      updateResultRows(r);
      addLog(`拉取结果: A=${r.A.totalTime}ms C=${r.C.totalTime}ms H=${r.H.totalTime}ms BL=${r.baseline.totalTime}ms`);
    }
  } catch (e) {
    addLog(`拉取失败: ${e.message}`);
  }
}

function startAutoPoll() {
  if (pollTimer) clearInterval(pollTimer);
  let settled = 0;
  pollTimer = setInterval(async () => {
    await pullResults();
    const r = currentResults;
    if (!r.A && !r.C) return;
    const done = [r.A?.totalTime > 0, r.C?.totalTime > 0, r.H?.totalTime > 0, r.baseline?.totalTime > 0];
    const doneCount = done.filter(Boolean).length;
    if (doneCount >= 3 || (doneCount === settled && settled > 0)) {
      clearInterval(pollTimer);
      pollTimer = null;
      setStatus(`捕获完成 (${doneCount}/4 方法成功)`);
      saveToHistory();
    }
    settled = doneCount;
  }, 2000);
}

// ──── Result table ────
function resetResultRows() {
  ['A', 'C', 'H', 'baseline'].forEach(m => {
    const row = document.getElementById(`row-${m}`);
    const cells = row.querySelectorAll('td');
    cells[1].innerHTML = '<span class="tag tag-wait">等待中</span>';
    cells[2].textContent = '—';
    cells[3].textContent = '—';
    cells[4].textContent = '—';
    cells[5].textContent = '—';
  });
}

function updateResultRows(r) {
  updateRow('A', r.A);
  updateRow('C', r.C);
  updateRow('H', r.H);
  updateRow('baseline', r.baseline);
}

function updateRow(method, data) {
  if (!data) return;
  const row = document.getElementById(`row-${method}`);
  const cells = row.querySelectorAll('td');

  if (data.totalTime > 0) {
    cells[1].innerHTML = '<span class="tag tag-ok">完成</span>';
    cells[2].textContent = data.firstDelay > 0 ? data.firstDelay : '—';
    cells[3].textContent = data.totalTime;
    cells[4].textContent = data.textLen || data.text?.length || 0;
    cells[5].innerHTML = `<div class="text-preview">${escapeHtml((data.text || '').slice(0, 150))}</div>`;
  } else if (data.firstDelay > 0 || data.chunks > 0) {
    cells[1].innerHTML = '<span class="tag tag-wait">流式中</span>';
    cells[4].textContent = data.textLen || data.text?.length || 0;
  }
}

// ──── Listen for real-time events ────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'poc-event') return;
  addLog(`[${msg.method}] ${msg.event} +${msg.elapsed}ms ${JSON.stringify(msg.data || {}).slice(0, 120)}`);
});

// ──── History ────
function saveToHistory() {
  const entry = {
    id: testHistory.length + 1,
    prompt: $promptSel.value === 'custom' ? $custom.value.trim().slice(0, 50) : $promptSel.value,
    marker: $marker.checked,
    results: JSON.parse(JSON.stringify(currentResults)),
    time: new Date().toLocaleTimeString()
  };
  testHistory.push(entry);
  renderHistory();
}

function renderHistory() {
  $histBody.innerHTML = testHistory.map(e => {
    const tag = (r) => r?.totalTime > 0
      ? `<span class="tag tag-ok">${r.totalTime}ms</span>`
      : '<span class="tag tag-fail">fail</span>';
    return `<tr>
      <td>${e.id}</td>
      <td>${e.prompt}${e.marker ? ' +M' : ''}</td>
      <td>${tag(e.results.A)}</td>
      <td>${tag(e.results.C)}</td>
      <td>${tag(e.results.H)}</td>
      <td>${tag(e.results.baseline)}</td>
      <td>${e.time}</td>
    </tr>`;
  }).join('');
}

// ──── Export ────
$btnExport.addEventListener('click', () => {
  const data = JSON.stringify({ exported: new Date().toISOString(), history: testHistory }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `poc-results-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  addLog('结果已导出');
});

// ──── Utils ────
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
