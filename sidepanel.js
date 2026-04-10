// AI Arena — Side Panel v6.0 (状态机驱动)

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const logEl = $("#log"), listEl = $("#participant-list"), countEl = $("#participant-count");
const judgeSelect = $("#judge-select");
const broadcastInput = $("#broadcast-input"), btnSend = $("#btn-send");
const btnDebate = $("#btn-debate"), btnSummary = $("#btn-summary"), btnDebateRetry = $("#btn-debate-retry");
const customInstruction = $("#custom-instruction"), presetSelect = $("#preset-select");
const guidanceInput = $("#guidance-input"), roundBadge = $("#round-badge");
const confirmPanel = $("#confirm-panel"), confirmCards = $("#confirm-cards");
const btnConfirmReady = $("#btn-confirm-ready"), btnConfirmWait = $("#btn-confirm-wait");
const btnManualReady = $("#btn-manual-ready");
const pasteModal = $("#paste-modal"), pasteTextarea = $("#paste-textarea");

let participants = [], debateSession = {}, flowState = "idle", streamingPollTimer = null;
let currentPasteParticipantId = null;
let injectResults = {}; // { participantId: "ok" | "failed" }

// ── 状态标签映射 ──
const STATE_LABELS = {
  idle: "", injecting: "注入中", inject_ok: "已发送", inject_failed: "发送失败",
  waiting: "等待中", streaming: "生成中", ready: "已完成",
  response_ready: "回复就绪", response_failed: "读取失败"
};
const STATE_ICONS = {
  idle: "", injecting: "⏳", inject_ok: "✅", inject_failed: "❌",
  waiting: "🤔", streaming: "⏳", ready: "✅",
  response_ready: "✅", response_failed: "❌"
};

function setEditorText(text) {
  broadcastInput.innerText = text;
  const range = document.createRange();
  range.selectNodeContents(broadcastInput);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  broadcastInput.focus();
}
function getDebateRound() { return debateSession?.rounds?.length || 0; }

const BUILTIN_PRESETS = { table: "请用表格对比各方观点，列出各自的优缺点", tech: "重点分析技术可行性和具体实现方案", invest: "从投资角度分析，关注风险、收益和仓位建议", academic: "以学术标准评价各方论证的严谨性", action: "只输出可直接执行的行动清单" };

// ── 日志 ──
function addLog(msg, type = "info") {
  const e = document.createElement("div");
  e.className = `entry ${type}`;
  e.textContent = `[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${msg}`;
  logEl.prepend(e);
  while (logEl.children.length > 50) logEl.lastChild.remove();
}

// ── 渲染参与者（状态卡片） ──
function renderParticipants() {
  countEl.textContent = participants.length;
  const rounds = debateSession?.rounds?.length || 0;
  if (rounds > 0) { roundBadge.style.display = ""; roundBadge.textContent = `第${rounds}轮`; }
  else { roundBadge.style.display = "none"; }

  if (!participants.length) {
    listEl.innerHTML = '<div class="empty-hint">选择预设或手动添加参与者</div>';
  } else {
    listEl.innerHTML = participants.map(p => {
      // 轮询状态是唯一 UI 状态源
      const pState = p._pollStatus || "idle";
      const sc = (pState === "streaming" || pState === "waiting") ? "streaming" : (p.tabId ? "ready" : "offline");
      const stateLabel = STATE_LABELS[pState] || "";
      const stateIcon = STATE_ICONS[pState] || "";

      // 门控1：发送失败时显示操作按钮
      let gateActions = "";
      if (injectResults[p.id] === "failed" && flowState === "broadcasting") {
        gateActions = `<div class="p-gate-actions">
          <button class="p-gate-btn" data-action="retry" data-id="${p.id}">重试</button>
          <button class="p-gate-btn" data-action="manual-send" data-id="${p.id}">已手动发送</button>
          <button class="p-gate-btn" data-action="skip" data-id="${p.id}">跳过</button>
        </div>`;
      }

      return `<div class="participant-item ${p.service}">
        <span class="p-status ${sc}"></span>
        <span class="p-name">${p.name}</span>
        ${stateLabel ? `<span class="p-state-badge ${pState.replace(/_/g, '-')}">${stateIcon} ${stateLabel}</span>` : `<span class="p-status-text">${sc === "offline" ? "离线" : ""}</span>`}
        ${gateActions}
        ${!gateActions ? (sc === "offline" ? '' : `<button class="p-btn p-focus" data-id="${p.id}">👁</button>`) : ''}
        <button class="p-btn p-remove" data-id="${p.id}">✕</button>
      </div>`;
    }).join("");

    // 事件绑定
    listEl.querySelectorAll(".p-focus").forEach(b => b.addEventListener("click", () => chrome.runtime.sendMessage({ type: "focusTab", id: b.dataset.id })));
    listEl.querySelectorAll(".p-remove").forEach(b => b.addEventListener("click", () => chrome.runtime.sendMessage({ type: "removeParticipant", id: b.dataset.id })));

    // 门控1 按钮
    listEl.querySelectorAll(".p-gate-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const { action, id } = btn.dataset;
        if (action === "retry") {
          addLog("重试注入...", "info");
          const r = await chrome.runtime.sendMessage({ type: "retryInject", id });
          if (r?.ok) {
            injectResults[id] = "ok";
          }
        } else if (action === "manual-send") {
          injectResults[id] = "ok";
          addLog("已标记为手动发送", "info");
        } else if (action === "skip") {
          delete injectResults[id];
          addLog("已跳过", "info");
        }
        // 检查是否所有门控1都已处理
        renderParticipants();
        checkGate1Complete();
      });
    });
  }

  // 更新裁判下拉
  [judgeSelect].forEach(sel => {
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">选择裁判...</option>' + participants.map(p => `<option value="${p.id}">${p.name}</option>`).join("");
    if (cur && participants.find(p => p.id === cur)) sel.value = cur;
  });
}

// 门控1完成检查：injectResults 中无 failed → 自动进入 AWAITING_RESPONSES
function checkGate1Complete() {
  if (flowState !== "broadcasting") return;
  const hasFailure = Object.values(injectResults).some(v => v === "failed");
  if (!hasFailure) {
    flowState = "awaiting_responses";
    startStreamingPoll();
    addLog("所有参与者已就绪，开始等待回复...", "success");
  }
}

// ── 确认面板（门控2/4） ──
function showConfirmPanel() {
  confirmPanel.style.display = "";
  confirmCards.innerHTML = participants.map(p => {
    const isReady = p._pollStatus === "ready" || !!p.responsePreview;
    const isFailed = false; // no more state-based failure; poll determines status
    const suspicious = isReady && p.responsePreview && p.responsePreview.trim().length < 10;
    const statusIcon = isReady ? (suspicious ? "⚠️" : "✅") : "⏳";
    const statusText = isReady ? (suspicious ? "疑似不完整" : "回复就绪") : "等待中";

    return `<div class="confirm-card">
      <span class="cc-status">${statusIcon}</span>
      <div class="cc-info">
        <div class="cc-name">${p.name}</div>
        ${isReady && p.responsePreview ? `<div class="cc-preview">${p.responsePreview}${p.responsePreview.length >= 100 ? '...' : ''}</div>` : ''}
        ${suspicious ? `<div class="cc-suspicious">回复较短，请确认是否完整</div>` : ''}
      </div>
      <div class="cc-actions">
        ${isReady || isFailed ? `<button class="cc-btn" data-action="continue-wait" data-id="${p.id}">继续等</button>` : ''}
        ${isFailed || suspicious ? `<button class="cc-btn cc-btn-paste" data-action="paste" data-id="${p.id}">手动粘贴</button>` : ''}
        ${isFailed ? `<button class="cc-btn" data-action="skip-confirm" data-id="${p.id}">跳过</button>` : ''}
      </div>
    </div>`;
  }).join("");

  // 更新确认按钮状态
  const validCount = participants.filter(p => p._pollStatus === "ready" || p.responsePreview).length;
  btnConfirmReady.disabled = validCount < 2;
  btnConfirmReady.textContent = validCount >= 2 ? `全部就绪，开始辩论 (${validCount}个有效)` : "至少需要 2 个有效回复";

  // 确认面板按钮事件
  confirmCards.querySelectorAll(".cc-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const { action, id } = btn.dataset;
      if (action === "continue-wait") {
        flowState = "awaiting_responses";
        hideConfirmPanel();
        startStreamingPoll();
        addLog(`${participants.find(p => p.id === id)?.name || id} 继续等待`, "info");
      } else if (action === "paste") {
        openPasteModal(id);
      } else if (action === "skip-confirm") {
        // Mark as skipped locally, refresh confirm panel
        const pIdx = participants.findIndex(p => p.id === id);
        if (pIdx !== -1) participants[pIdx]._pollStatus = "ready";
        showConfirmPanel();
      }
    });
  });
}

function hideConfirmPanel() {
  confirmPanel.style.display = "none";
}

// ── 手动粘贴弹框 ──
function openPasteModal(participantId) {
  currentPasteParticipantId = participantId;
  const p = participants.find(p => p.id === participantId);
  $("#paste-modal-title").textContent = `手动粘贴 ${p?.name || ''} 的回复`;
  pasteTextarea.value = "";
  pasteModal.style.display = "flex";
  pasteTextarea.focus();
}

function closePasteModal() {
  pasteModal.style.display = "none";
  currentPasteParticipantId = null;
}

$("#paste-modal-close").addEventListener("click", closePasteModal);
pasteModal.addEventListener("click", (e) => { if (e.target === pasteModal) closePasteModal(); });

$("#btn-paste-confirm").addEventListener("click", async () => {
  const text = pasteTextarea.value.trim();
  if (!text) { addLog("请粘贴回复内容", "error"); return; }
  await chrome.runtime.sendMessage({ type: "manualPaste", id: currentPasteParticipantId, text });
  addLog(`已手动粘贴 ${participants.find(p => p.id === currentPasteParticipantId)?.name || ''} 的回复`, "success");
  closePasteModal();
  // 刷新确认面板
  const state = await chrome.runtime.sendMessage({ type: "getState" });
  if (state) { participants = state.participants; debateSession = state.debateSession; flowState = state.flowState; }
  showConfirmPanel();
});

// ── 确认面板按钮 ──
btnConfirmReady.addEventListener("click", () => {
  flowState = "debating";
  hideConfirmPanel();
  addLog("确认就绪，进入辩论", "success");
  updateWizard("ready");
});

btnConfirmWait.addEventListener("click", () => {
  flowState = "awaiting_responses";
  hideConfirmPanel();
  startStreamingPoll();
  addLog("继续等待所有 AI 回复...", "info");
});

// ── 手动确认按钮（轮询卡住时的逃生口） ──
btnManualReady.addEventListener("click", async () => {
  stopStreamingPoll();
  btnManualReady.disabled = true;
  btnManualReady.textContent = "⏳ 正在读取回复...";
  addLog("手动确认回复完成，正在读取...", "info");
  await readAllResponses();
  showConfirmPanel();
  btnManualReady.style.display = "none";
  btnManualReady.disabled = false;
  btnManualReady.textContent = "✋ AI 都回答完了？点此手动确认";
});

// ── 标记驱动轮询 ──
let pollStartTime = 0, pollErrorCount = 0, pollReadyCount = 0;
let pollDelayTimer = null;
let prevLengths = {}; // { participantId: number } 上一次文本长度
const POLL_MAX_DURATION = 10 * 60 * 1000; // 10 分钟超时
const POLL_MAX_ERRORS = 10;
const POLL_READY_THRESHOLD = 2; // 连续 2 次稳定+标记 = 完成（3 秒）
const POLL_INITIAL_DELAY = 2000; // 初始等待 2 秒
const POLL_INTERVAL_SLOW = 1500; // 等待阶段 1.5 秒
const POLL_INTERVAL_FAST = 500; // 生成中阶段 0.5 秒（检测到 START 后加速）
const POLL_FALLBACK_TIMEOUT = 60000; // 60 秒无标记降级到选择器
let pollCurrentInterval = POLL_INTERVAL_SLOW;
let anyStartDetected = false;

function startStreamingPoll() {
  stopStreamingPoll();
  pollStartTime = Date.now();
  pollErrorCount = 0;
  pollReadyCount = 0;
  prevLengths = {};
  pollCurrentInterval = POLL_INTERVAL_SLOW;
  anyStartDetected = false;
  pollDelayTimer = setTimeout(() => {
    pollDelayTimer = null;
    schedulePollTick();
  }, POLL_INITIAL_DELAY);
}

function schedulePollTick() {
  streamingPollTimer = setTimeout(async () => {
      if (Date.now() - pollStartTime > POLL_MAX_DURATION) {
        addLog("轮询超时（10分钟），已自动停止", "error");
        stopStreamingPoll();
        return;
      }
      try {
        const s = await chrome.runtime.sendMessage({ type: "checkAllCompletion" });
        pollErrorCount = 0;

        let allDone = true;
        let hasOnline = false;
        for (const [id, v] of Object.entries(s)) {
          if (v.status === "offline") continue;
          hasOnline = true;
          const prevLen = prevLengths[id] || 0;
          const lengthChanged = v.textLength !== prevLen;
          prevLengths[id] = v.textLength;

          // 更新参与者显示状态
          const p = participants.find(p => p.id === id);
          if (p) {
            if (!v.hasStart && v.textLength === 0) {
              p._pollStatus = "waiting"; // 等待中
            } else if (lengthChanged) {
              p._pollStatus = "streaming"; // 字符在增长 = 一票否决完成
            } else if (v.hasDone) {
              p._pollStatus = "ready"; // 标记出现 + 字符稳定
            } else {
              p._pollStatus = "streaming"; // 有内容但无 DONE 标记
            }
          }

          if (p?._pollStatus !== "ready") allDone = false;
        }
        renderParticipants();

        // 检测到任何 START → 切换到快速轮询
        const hasAnyStart = Object.values(s).some(v => v.hasStart);
        if (hasAnyStart && !anyStartDetected) {
          anyStartDetected = true;
          pollCurrentInterval = POLL_INTERVAL_FAST;
        }

        // 降级检测：60 秒内无任何 START 标记，回退到选择器检测
        if (!hasAnyStart && Date.now() - pollStartTime > POLL_FALLBACK_TIMEOUT) {
          addLog("⚠️ 未检测到标记，降级到选择器检测", "error");
          stopStreamingPoll();
          startFallbackStreamingPoll();
          return;
        }

        if (allDone && hasOnline) {
          pollReadyCount++;
          if (pollReadyCount >= POLL_READY_THRESHOLD) {
            addLog("所有 AI 已回答完毕（标记确认），读取回复...", "success");
            stopStreamingPoll();
            await readAllResponses();
            showConfirmPanel();
            if (Notification.permission === "granted") {
              try { new Notification("AI Arena", { body: "所有 AI 已回答完毕，请确认", icon: "icons/icon128.png" }); } catch {}
            }
          }
        } else { pollReadyCount = 0; }
      } catch (e) {
        pollErrorCount++;
        if (pollErrorCount >= POLL_MAX_ERRORS) {
          addLog(`轮询连续失败 ${POLL_MAX_ERRORS} 次，已停止`, "error");
          stopStreamingPoll();
          return;
        }
      }
      // 递归调度下一次轮询（自适应频率）
      schedulePollTick();
    }, pollCurrentInterval);
}

// 降级：选择器 + 文本稳定性检测（标记不可用时）
function startFallbackStreamingPoll() {
  let fallbackReadyCount = 0;
  let fallbackPrevLengths = {};
  streamingPollTimer = setInterval(async () => {
    try {
      const s = await chrome.runtime.sendMessage({ type: "checkAllCompletion" });
      const sStream = await chrome.runtime.sendMessage({ type: "checkAllStreaming" });
      let allStable = true;
      for (const [id, v] of Object.entries(s)) {
        if (v.status === "offline") continue;
        const prevLen = fallbackPrevLengths[id] || 0;
        const lengthStable = v.textLength === prevLen && v.textLength > 0;
        const noSelector = !sStream[id] || sStream[id].status !== "streaming";
        fallbackPrevLengths[id] = v.textLength;
        if (!(lengthStable && noSelector)) allStable = false;
      }
      if (allStable) {
        fallbackReadyCount++;
        if (fallbackReadyCount >= 3) { // 5 秒稳定（3 × 1.5s）
          addLog("降级检测确认完成，读取回复...", "success");
          stopStreamingPoll();
          await readAllResponses();
          showConfirmPanel();
        }
      } else { fallbackReadyCount = 0; }
    } catch {}
  }, POLL_INTERVAL_SLOW);
}

function stopStreamingPoll() {
  if (pollDelayTimer) { clearTimeout(pollDelayTimer); pollDelayTimer = null; }
  if (streamingPollTimer) clearInterval(streamingPollTimer);
  streamingPollTimer = null;
}

// 读取所有参与者的回复
async function readAllResponses() {
  for (const p of participants) {
    try {
      await chrome.runtime.sendMessage({ type: "readOneResponse", participantId: p.id });
    } catch (e) {
      addLog(`读取 ${p.name} 失败: ${e.message}`, "error");
    }
  }
  // 刷新状态
  const state = await chrome.runtime.sendMessage({ type: "getState" });
  if (state) { participants = state.participants; debateSession = state.debateSession; flowState = state.flowState; }
  renderParticipants();
}

// ── 消息监听 ──
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "status") addLog(msg.message);
  if (msg.type === "stateUpdate") {
    participants = msg.participants;
    debateSession = msg.debateSession || {};
    flowState = msg.flowState || "idle";
    renderParticipants();
    updateWizard(flowState);
  }
  if (msg.type === "selectorWarning") {
    addLog(`⚠️ ${msg.message}`, "error");
  }
  if (msg.type === "contextMenuText") {
    const text = msg.text || "";
    if (text) { setEditorText(text); addLog("已从网页获取选中文本 (" + text.length + " 字)", "info"); }
  }
});

// 初始化
(async () => {
  try {
    const r = await chrome.runtime.sendMessage({ type: "getState" });
    if (r) { participants = r.participants; debateSession = r.debateSession || {}; flowState = r.flowState || "idle"; renderParticipants(); updateWizard(flowState); }
  } catch {}
  try {
    const s = await chrome.storage.local.get(["customPresets", "lastCustomInstruction"]);
    if (s.lastCustomInstruction && customInstruction) customInstruction.value = s.lastCustomInstruction;
    if (s.customPresets) renderCustomPresets(s.customPresets);
  } catch {}
})();

// 定期刷新
setInterval(async () => {
  try {
    const r = await chrome.runtime.sendMessage({ type: "getState" });
    if (r) {
      participants = r.participants; debateSession = r.debateSession || {};
      flowState = r.flowState || "idle";
      if (!streamingPollTimer) renderParticipants();
    }
  } catch {}
}, 5000);

// ── 预设 ──
$$(".btn-preset").forEach(b => b.addEventListener("click", async () => {
  addLog(`加载预设: ${b.textContent}...`);
  await chrome.runtime.sendMessage({ type: "loadPreset", presetId: b.dataset.preset });
}));

// ── 添加参与者 ──
$$(".btn-add").forEach(b => b.addEventListener("click", async () => {
  if (participants.length >= 3) { addLog("最多 3 个参与者", "error"); return; }
  addLog(`添加 ${b.dataset.service}...`);
  await chrome.runtime.sendMessage({ type: "addParticipant", service: b.dataset.service });
}));

// ── 打开全部 ──
$("#btn-open-all").addEventListener("click", async () => { addLog("打开全部..."); await chrome.runtime.sendMessage({ type: "openAll" }); });

// ── 文件管理 ──
let pendingImages = [], pendingFiles = [];
const imagePreviews = $("#image-previews");
const fileInput = $("#file-input");

function addImage(dataUrl) { pendingImages.push(dataUrl); renderFilePreviews(); }
function addTextFile(name, content) { pendingFiles.push({ name, content }); renderFilePreviews(); }
function removeAttachment(type, index) {
  if (type === "img") pendingImages.splice(index, 1);
  else pendingFiles.splice(index, 1);
  renderFilePreviews();
}

function renderFilePreviews() {
  let html = "";
  pendingImages.forEach((dataUrl, i) => { html += `<div class="img-preview"><img src="${dataUrl}"><button class="img-remove" data-type="img" data-idx="${i}">✕</button></div>`; });
  pendingFiles.forEach((f, i) => { html += `<div class="img-preview file-preview"><span class="file-icon">📄</span><span class="file-name">${f.name.length > 12 ? f.name.slice(0, 10) + '...' : f.name}</span><button class="img-remove" data-type="file" data-idx="${i}">✕</button></div>`; });
  imagePreviews.innerHTML = html;
  imagePreviews.querySelectorAll(".img-remove").forEach(btn => { btn.addEventListener("click", () => removeAttachment(btn.dataset.type, parseInt(btn.dataset.idx))); });
}

function fileToDataUrl(file) { return new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsDataURL(file); }); }
function fileToText(file) { return new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsText(file); }); }
function isImageFile(file) { return file.type.startsWith("image/"); }

broadcastInput.addEventListener("paste", async (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) { addImage(await fileToDataUrl(file)); addLog("已粘贴图片", "info"); }
    }
  }
});

fileInput.addEventListener("change", async () => {
  for (const file of fileInput.files) {
    if (isImageFile(file)) { addImage(await fileToDataUrl(file)); }
    else {
      try {
        const content = await fileToText(file);
        addTextFile(file.name, content);
        addLog(`已添加文件: ${file.name} (${(content.length / 1024).toFixed(1)}KB)`, "info");
      } catch { addLog(`无法读取文件: ${file.name}`, "error"); }
    }
  }
  fileInput.value = "";
});

broadcastInput.addEventListener("input", () => {
  broadcastInput.querySelectorAll("img").forEach(img => { if (img.src.startsWith("data:")) { addImage(img.src); img.remove(); } });
});

// ── 广播 ──
async function doBroadcast() {
  let text = broadcastInput.innerText.trim();
  const hasImages = pendingImages.length > 0;
  const hasFiles = pendingFiles.length > 0;
  if (!text && !hasImages && !hasFiles) return;
  if (!participants.length) { addLog("请先添加参与者", "error"); return; }
  if (hasFiles) {
    text += pendingFiles.map(f => `\n\n---\n📄 文件: ${f.name}\n\`\`\`\n${f.content}\n\`\`\``).join("");
  }
  btnSend.disabled = true; btnSend.textContent = "发送中...";
  hideConfirmPanel();
  const attachInfo = [];
  if (hasImages) attachInfo.push(`${pendingImages.length}张图`);
  if (hasFiles) attachInfo.push(`${pendingFiles.length}个文件`);
  addLog("广播: " + text.slice(0, 50) + (text.length > 50 ? "..." : "") + (attachInfo.length ? ` (+${attachInfo.join(", ")})` : ""));

  try {
    const r = await chrome.runtime.sendMessage({ type: "broadcast", text, images: hasImages ? pendingImages : undefined });
    if (r) {
      injectResults = {};
      for (const [id, v] of Object.entries(r)) {
        injectResults[id] = (v.status === "sent" || v.status === "inputted") ? "ok" : "failed";
        addLog(`${v.name}: ${v.status}${v.error ? " - " + v.error : ""}`, v.status === "sent" || v.status === "inputted" ? "success" : "error");
      }
    }
    broadcastInput.innerHTML = "";
    pendingImages = [];
    pendingFiles = [];
    renderFilePreviews();
    // 刷新状态
    const state = await chrome.runtime.sendMessage({ type: "getState" });
    if (state) { participants = state.participants; flowState = state.flowState; }
    renderParticipants();
    // 如果自动进入了 awaiting，开始轮询
    if (flowState === "awaiting_responses") {
      startStreamingPoll();
    }
  } catch (e) { addLog("失败: " + e.message, "error"); }
  btnSend.disabled = false; btnSend.textContent = "发送给全部";
}
btnSend.addEventListener("click", doBroadcast);
broadcastInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); doBroadcast(); } });

// ── 辩论模式切换 ──
let debateMode = "free";
$$(".mode-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    $$(".mode-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    debateMode = btn.dataset.mode;
  });
});

// ── 辩论 ──
btnDebate.addEventListener("click", async () => {
  if (participants.length < 2) { addLog("至少需要 2 个参与者", "error"); return; }
  const nextRound = getDebateRound() + 1;
  btnDebate.disabled = true; btnDebate.textContent = `第${nextRound}轮...`;
  hideConfirmPanel();
  const guidance = guidanceInput?.value?.trim() || "";
  addLog(`第${nextRound}轮辩论${guidance ? " (引导: " + guidance.slice(0, 30) + ")" : ""}`, "info");
  try {
    const concise = $("#concise-mode")?.checked || false;
    const r = await chrome.runtime.sendMessage({ type: "debateRound", style: debateMode, guidance, concise });
    if (r?.ok) {
      addLog(`第${nextRound}轮已发送`, "success");
      // 刷新状态
      const state = await chrome.runtime.sendMessage({ type: "getState" });
      if (state) { participants = state.participants; flowState = state.flowState; }
      renderParticipants();
      if (flowState === "awaiting_responses") startStreamingPoll();
      if (guidance && guidanceInput) guidanceInput.value = "";
    } else addLog(`失败: ${r?.error}`, "error");
  } catch (e) { addLog("失败: " + e.message, "error"); }
  btnDebate.disabled = false; btnDebate.textContent = `开始辩论（第${getDebateRound() + 1}轮）`;
});

// ── 辩论重试 ──
btnDebateRetry.addEventListener("click", async () => {
  stopStreamingPoll();
  hideConfirmPanel();
  btnDebate.disabled = false;
  btnDebate.textContent = `开始辩论（第${getDebateRound() + 1}轮）`;
  btnSend.disabled = false;
  btnSend.textContent = "发送给全部";
  await chrome.runtime.sendMessage({ type: "resetSession" });
  updateWizard("idle");
  addLog("已重置辩论状态，可以重试", "info");
});

// ── 上下文提炼 ──
$("#btn-ctx-fork").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true; btn.textContent = "⏳ AI 提炼中...";
  const preview = $("#ctx-fork-preview");
  preview.style.display = "none";
  addLog("正在读取对话并请求 AI 提炼摘要...", "info");
  const r = await chrome.runtime.sendMessage({ type: "contextForkActive" });
  if (r?.ok) {
    await navigator.clipboard.writeText(r.prompt);
    addLog(`已提炼 ${r.turns} 轮对话，摘要已复制到剪贴板 ✓`, "success");
    preview.style.display = "block";
    preview.textContent = r.prompt.slice(0, 300) + (r.prompt.length > 300 ? "..." : "");
  } else { addLog(`提炼失败: ${r?.error}`, "error"); }
  btn.disabled = false; btn.textContent = "📋 提炼当前页面并复制";
});

// ── 辩论总结 ──
btnSummary.addEventListener("click", async () => {
  const judgeId = judgeSelect.value;
  if (!judgeId) { addLog("请先选择裁判", "error"); return; }
  const ci = customInstruction?.value?.trim() || "";
  if (ci) chrome.storage.local.set({ lastCustomInstruction: ci });
  btnSummary.disabled = true; btnSummary.textContent = "总结中...";
  addLog("生成总结..." + (ci ? " (含自定义指令)" : ""), "info");
  try {
    const r = await chrome.runtime.sendMessage({ type: "summary", judgeId, customInstruction: ci });
    if (r?.ok) { addLog("总结已发送", "success"); startStreamingPoll(); }
    else addLog(`失败: ${r?.error}`, "error");
  } catch (e) { addLog("失败: " + e.message, "error"); }
  btnSummary.disabled = false; btnSummary.textContent = "输出总结";
});

// ── 常用指令 ──
presetSelect.addEventListener("change", () => {
  const v = presetSelect.value;
  if (BUILTIN_PRESETS[v]) customInstruction.value = BUILTIN_PRESETS[v];
  else if (v.startsWith("custom_")) chrome.storage.local.get("customPresets", d => { if (d.customPresets?.[v]) customInstruction.value = d.customPresets[v]; });
  presetSelect.value = "";
});

$("#btn-save-preset").addEventListener("click", async () => {
  const text = customInstruction.value.trim();
  if (!text) { addLog("请先输入指令", "error"); return; }
  const key = "custom_" + Date.now();
  const d = await chrome.storage.local.get("customPresets");
  const p = d.customPresets || {};
  p[key] = text;
  await chrome.storage.local.set({ customPresets: p });
  renderCustomPresets(p);
  addLog("已保存常用指令", "success");
});

function renderCustomPresets(presets) {
  presetSelect.querySelectorAll('option[value^="custom_"]').forEach(o => o.remove());
  for (const [k, t] of Object.entries(presets)) {
    const o = document.createElement("option");
    o.value = k; o.textContent = "📌 " + t.slice(0, 20) + (t.length > 20 ? "..." : "");
    presetSelect.appendChild(o);
  }
}

// ── 重置 ──
$("#btn-reset").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "resetSession" });
  stopStreamingPoll();
  hideConfirmPanel();
  addLog("会话已重置", "info");
  btnDebate.textContent = "开始辩论";
  updateWizard("idle");
  renderParticipants();
});

// ── 彻底重置 ──
$("#btn-hard-reset").addEventListener("click", async () => {
  for (const p of participants) {
    if (p.tabId) { try { await chrome.tabs.remove(p.tabId); } catch {} }
  }
  await chrome.runtime.sendMessage({ type: "hardReset" });
  stopStreamingPoll();
  hideConfirmPanel();
  participants = [];
  debateSession = {};
  flowState = "idle";
  injectResults = {};
  pendingImages = [];
  pendingFiles = [];
  renderFilePreviews();
  broadcastInput.innerHTML = "";
  btnDebate.textContent = "开始辩论";
  btnSend.disabled = false;
  btnSend.textContent = "发送给全部";
  btnSummary.disabled = false;
  btnSummary.textContent = "输出总结";
  updateWizard("idle");
  renderParticipants();
  addLog("已彻底重置，所有状态已清除", "success");
});

// ── Prompt 模板库 ──
const BUILTIN_TEMPLATES = [
  { id: "t_code_review", name: "代码审查", icon: "🔍", content: "请审查以下代码，关注：1) 潜在 bug 2) 性能问题 3) 安全隐患 4) 代码风格\n\n{{问题}}" },
  { id: "t_solution", name: "方案评估", icon: "⚖️", content: "请从技术可行性、成本、风险、可维护性等角度评估以下方案：\n\n{{问题}}" },
  { id: "t_translate", name: "翻译润色", icon: "🌐", content: "请将以下内容翻译为流畅地道的中文/英文，保持专业术语准确：\n\n{{问题}}" },
  { id: "t_brainstorm", name: "头脑风暴", icon: "💡", content: "请围绕以下主题进行发散思考，给出至少5个不同角度的创意或方案：\n\n{{问题}}" },
  { id: "t_swot", name: "SWOT分析", icon: "📊", content: "请对以下内容进行 SWOT 分析（优势、劣势、机会、威胁），用表格呈现：\n\n{{问题}}" },
  { id: "t_explain", name: "深入讲解", icon: "📖", content: "请用通俗易懂的方式深入解释以下概念，使用类比和具体例子：\n\n{{问题}}" },
  { id: "t_debug", name: "问题诊断", icon: "🐛", content: "以下代码/系统出现了问题，请分析可能的原因并给出修复方案：\n\n{{问题}}" },
  { id: "t_summary", name: "内容总结", icon: "📝", content: "请总结以下内容的核心要点，用结构化的方式呈现（要点不超过5条）：\n\n{{问题}}" },
];

const templateList = $("#template-list");

async function loadTemplates() {
  const data = await chrome.storage.local.get("userTemplates");
  const userTpls = data.userTemplates || [];
  const allTpls = [...BUILTIN_TEMPLATES, ...userTpls];
  templateList.innerHTML = allTpls.map(t => `
    <div class="tpl-item" data-id="${t.id}">
      <span class="tpl-icon">${t.icon || '📄'}</span>
      <span class="tpl-name">${t.name}</span>
      ${t.id.startsWith("t_user_") ? `<button class="tpl-del" data-id="${t.id}">✕</button>` : ''}
    </div>
  `).join("");
  templateList.querySelectorAll(".tpl-item").forEach(item => {
    item.addEventListener("click", (e) => {
      if (e.target.classList.contains("tpl-del")) return;
      const tpl = allTpls.find(t => t.id === item.dataset.id);
      if (!tpl) return;
      const currentText = broadcastInput.innerText.trim();
      setEditorText(tpl.content.replace("{{问题}}", currentText || "[在此输入具体内容]"));
      addLog(`已加载模板: ${tpl.name}`, "info");
    });
  });
  templateList.querySelectorAll(".tpl-del").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const data = await chrome.storage.local.get("userTemplates");
      const tpls = (data.userTemplates || []).filter(t => t.id !== btn.dataset.id);
      await chrome.storage.local.set({ userTemplates: tpls });
      loadTemplates();
      addLog("已删除模板", "info");
    });
  });
}

$("#btn-save-tpl").addEventListener("click", async () => {
  const name = $("#tpl-name").value.trim();
  const content = $("#tpl-content").value.trim();
  if (!name || !content) { addLog("请填写模板名称和内容", "error"); return; }
  const data = await chrome.storage.local.get("userTemplates");
  const tpls = data.userTemplates || [];
  tpls.push({ id: "t_user_" + Date.now(), name, icon: "📌", content });
  await chrome.storage.local.set({ userTemplates: tpls });
  $("#tpl-name").value = "";
  $("#tpl-content").value = "";
  loadTemplates();
  addLog(`已保存模板: ${name}`, "success");
});

loadTemplates();

// ── Prompt 优化 ──
const btnOptimize = $("#btn-optimize");
btnOptimize.addEventListener("click", async () => {
  const text = broadcastInput.innerText.trim();
  if (!text) { addLog("请先输入 Prompt", "error"); return; }
  if (!participants.length) { addLog("请先添加参与者", "error"); return; }
  const judge = participants.find(p => p.tabId);
  if (!judge) { addLog("没有在线参与者", "error"); return; }
  btnOptimize.disabled = true; btnOptimize.textContent = "⏳";
  addLog(`正在由 ${judge.name} 优化 Prompt...`, "info");
  const r = await chrome.runtime.sendMessage({ type: "optimizePrompt", text, judgeId: judge.id });
  if (!r?.ok) { addLog(`失败: ${r?.error}`, "error"); btnOptimize.disabled = false; btnOptimize.textContent = "✨ 优化"; return; }
  addLog("等待优化结果...", "info");
  await new Promise(resolve => setTimeout(resolve, 3000));
  for (let i = 0; i < 60; i++) {
    try {
      const s = await chrome.runtime.sendMessage({ type: "checkAllStreaming" });
      const judgeStatus = s[judge.id];
      if (judgeStatus && judgeStatus.status !== "streaming") break;
    } catch {}
    await new Promise(r => setTimeout(r, 2000));
  }
  const resp = await chrome.runtime.sendMessage({ type: "readOneResponse", participantId: judge.id });
  if (resp?.ok && resp.text) { setEditorText(resp.text.trim()); addLog("Prompt 已优化并填回输入框", "success"); }
  else { addLog("未读取到结果，请手动查看 AI 页面", "error"); }
  btnOptimize.disabled = false; btnOptimize.textContent = "✨ 优化";
});

// ── 辩论向导（FlowState 驱动） ──
const wizardEl = $("#debate-wizard");
function updateWizard(state) {
  if (!wizardEl) return;
  const steps = {
    idle: "① 先发送问题 → ② 等待回答完成 → ③ 点击辩论",
    broadcasting: "① ⏳ 发送中... → ② 等待回答 → ③ 辩论",
    awaiting_responses: "① ✅ 已发送 → ② ⏳ 等待回答中... → ③ 辩论",
    confirming: "① ✅ → ② ✅ 回答已收集 → <b>③ 请确认后开始辩论</b>",
    debating: "① ✅ → ② ✅ → ③ ⏳ 辩论进行中...",
    ready: "① ✅ 问题已发送 → ② ✅ 回答已完成 → <b>③ 现在可以辩论了！</b>",
    summary: "① ✅ → ② ✅ → ③ ✅ → 📝 总结中...",
  };
  wizardEl.innerHTML = steps[state] || steps.idle;
  // awaiting_responses 时显示手动确认按钮（防止轮询卡住时用户无法操作）
  btnManualReady.style.display = (state === "awaiting_responses") ? "" : "none";
}

// ── 通知权限 ──
if ("Notification" in window) Notification.requestPermission();

// ── 快捷键 ──
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === "D") { e.preventDefault(); btnDebate.click(); }
});
