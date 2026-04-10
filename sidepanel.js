// AI Arena — Side Panel v6.0 (状态机驱动)

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const logEl = $("#log"), listEl = $("#participant-list"), countEl = $("#participant-count");
const judgeSelect = $("#judge-select");
const broadcastInput = $("#broadcast-input"), btnSend = $("#btn-send");
const btnDebate = $("#btn-debate"), btnSummary = $("#btn-summary"), btnDebateRetry = $("#btn-debate-retry");
const guidanceInput = $("#guidance-input"), roundBadge = $("#round-badge");

let participants = [], debateSession = {}, flowState = "idle", streamingPollTimer = null;

function mergeParticipants(remote) {
  if (!remote) return;
  const localMap = {};
  for (const p of participants) localMap[p.id] = p;
  participants = remote.map(rp => {
    const local = localMap[rp.id];
    return { ...rp, _pollStatus: local?._pollStatus || null };
  });
}
let injectResults = {}; // { participantId: "ok" | "failed" }

// ── 状态标签映射 ──
const STATE_LABELS = {
  idle: "", waiting: "等待中", streaming: "生成中", ready: "已完成"
};
const STATE_ICONS = {
  idle: "", waiting: "🤔", streaming: "⏳", ready: "✅"
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
    listEl.innerHTML = '<div class="empty-hint">点击上方按钮添加参与者</div>';
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

      // 实时字数显示
      const charCount = p._textLength || 0;
      const charDisplay = charCount > 0 ? `<span class="p-chars">${charCount}字</span>` : '';

      // 有效回答状态（StateMachine 中已存储回复）
      const hasResponse = !!p.responsePreview;
      const readyBadge = hasResponse
        ? `<span class="p-ready-badge ready">✓</span>`
        : `<span class="p-ready-badge not-ready">✗</span>`;

      // 手动操作按钮
      const actionBtns = !gateActions ? [
        `<button class="p-btn p-send" data-id="${p.id}" title="手动发送提问">📤</button>`,
        `<button class="p-btn p-extract" data-id="${p.id}" title="手动提取回复">📥</button>`
      ].join('') : '';

      return `<div class="participant-item ${p.service}">
        <span class="p-status ${sc}"></span>
        <span class="p-name">${p.name}</span>
        ${readyBadge}
        ${stateLabel ? `<span class="p-state-badge ${pState.replace(/_/g, '-')}">${stateIcon} ${stateLabel}</span>` : ''}
        ${charDisplay}
        ${gateActions}
        ${actionBtns}
        <button class="p-btn p-remove" data-id="${p.id}">✕</button>
      </div>`;
    }).join("");

    // 事件绑定
    listEl.querySelectorAll(".p-remove").forEach(b => b.addEventListener("click", () => chrome.runtime.sendMessage({ type: "removeParticipant", id: b.dataset.id })));
    // 手动发送按钮
    listEl.querySelectorAll(".p-send").forEach(b => b.addEventListener("click", async () => {
      const id = b.dataset.id;
      const p = participants.find(p => p.id === id);
      b.textContent = "⏳"; b.disabled = true;
      addLog(`手动发送给 ${p?.name || id}...`, "info");
      const resp = await chrome.runtime.sendMessage({ type: "sendToOne", participantId: id });
      if (resp?.ok) {
        if (p) { p._pollStatus = null; p._textLength = 0; }
        addLog(`已发送给 ${p?.name || id}`, "success");
        renderParticipants();
        if (!streamingPollTimer) startStreamingPoll();
      } else {
        addLog(`发送失败: ${resp?.error || '未知错误'}`, "error");
      }
      b.textContent = "📤"; b.disabled = false;
    }));
    // 手动提取按钮
    listEl.querySelectorAll(".p-extract").forEach(b => b.addEventListener("click", async () => {
      const id = b.dataset.id;
      const p = participants.find(p => p.id === id);
      b.textContent = "⏳"; b.disabled = true;
      addLog(`手动提取 ${p?.name || id} 的回复...`, "info");
      const resp = await chrome.runtime.sendMessage({ type: "readOneResponse", participantId: id });
      if (resp?.ok && resp.text) {
        if (p) { p._pollStatus = "ready"; p._textLength = resp.text.length; }
        addLog(`${p?.name || id} 回复已提取 (${resp.text.length}字)`, "success");
        renderParticipants();
        // 检查是否所有人都 ready 了
        checkAllReadyAndConfirm();
      } else {
        addLog(`提取失败: ${resp?.error || '未读取到内容'}`, "error");
        b.textContent = "📥"; b.disabled = false;
      }
    }));

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

  // 辩论按钮状态：至少 2 个有效回答才能辩论
  const readyCount = participants.filter(p => !!p.responsePreview).length;
  if (btnDebate) {
    btnDebate.disabled = readyCount < 2;
    if (readyCount < 2) {
      btnDebate.title = `需要至少 2 个有效回答（当前 ${readyCount} 个）`;
    } else {
      btnDebate.title = `${readyCount} 个有效回答，可以开始辩论`;
    }
  }
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

// 检查是否所有参与者都 ready
function checkAllReadyAndConfirm() {
  const allReady = participants.length > 0 && participants.every(p => p._pollStatus === "ready");
  if (allReady) {
    stopStreamingPoll();
    addLog("所有 AI 回复已就绪，可以开始辩论", "success");
  }
}

// ── 标记驱动轮询（纯标记+字符数，无CSS选择器） ──
let pollStartTime = 0, pollErrorCount = 0, pollReadyCount = 0;
let pollDelayTimer = null;
let prevLengths = {}; // { participantId: number }
let pollNoMarkerReported = false;
const POLL_MAX_DURATION = 10 * 60 * 1000;
const POLL_MAX_ERRORS = 10;
const POLL_READY_THRESHOLD = 2;
const POLL_INITIAL_DELAY = 2000;
const POLL_INTERVAL = 250; // 0.25 秒轮询，字数实时刷新更流畅
let lastPromptLength = 0; // 用于动态计算无标记超时

// 根据 prompt 长度动态计算无标记超时（短问题60秒，长问题更久）
function getNoMarkerTimeout() {
  // 基础60秒 + 每100字符加5秒，上限300秒
  return Math.min(60000 + Math.floor(lastPromptLength / 100) * 5000, 300000);
}

function startStreamingPoll(promptLength) {
  stopStreamingPoll();
  pollStartTime = Date.now();
  pollErrorCount = 0;
  pollReadyCount = 0;
  prevLengths = {};
  pollNoMarkerReported = false;
  if (promptLength) lastPromptLength = promptLength;
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

          const p = participants.find(p => p.id === id);
          if (p) {
            p._textLength = v.textLength; // 实时字数
            if (lengthChanged) {
              p._pollStatus = "streaming";
            } else if (v.hasDone) {
              p._pollStatus = "ready";
            } else if (v.hasStart) {
              p._pollStatus = "streaming";
            } else {
              p._pollStatus = "waiting";
            }
          }
          if (p?._pollStatus !== "ready") allDone = false;
        }
        renderParticipants();

        // 动态超时：长时间无标记 → 提示异常
        const hasAnyStart = Object.values(s).some(v => v.hasStart);
        const noMarkerTimeout = getNoMarkerTimeout();
        if (!hasAnyStart && Date.now() - pollStartTime > noMarkerTimeout && !pollNoMarkerReported) {
          pollNoMarkerReported = true;
          addLog(`⚠️ ${Math.round(noMarkerTimeout/1000)}秒内未检测到标记，疑似异常，建议手动查看`, "error");
          // 不停止轮询，继续检测，用户可用手动确认按钮
        }

        if (allDone && hasOnline) {
          pollReadyCount++;
          if (pollReadyCount >= POLL_READY_THRESHOLD) {
            addLog("所有 AI 已回答完毕（标记确认），读取回复...", "success");
            stopStreamingPoll();
            await readAllResponses();
            if (Notification.permission === "granted") {
              try { new Notification("AI Arena", { body: "所有 AI 已回答完毕，可以开始辩论", icon: "icons/icon128.png" }); } catch {}
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
      if (streamingPollTimer !== null) schedulePollTick();
    }, POLL_INTERVAL);
}

function stopStreamingPoll() {
  if (pollDelayTimer) { clearTimeout(pollDelayTimer); pollDelayTimer = null; }
  if (streamingPollTimer) { clearTimeout(streamingPollTimer); }
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
  if (state) { mergeParticipants(state.participants); debateSession = state.debateSession; flowState = state.flowState; }
  renderParticipants();
}

// ── 消息监听 ──
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "status") addLog(msg.message);
  if (msg.type === "stateUpdate") {
    mergeParticipants(msg.participants);
    debateSession = msg.debateSession || {};
    flowState = msg.flowState || "idle";
    renderParticipants();
  }
  if (msg.type === "selectorWarning") {
    addLog(msg.message, "info");
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
    if (r) { mergeParticipants(r.participants); debateSession = r.debateSession || {}; flowState = r.flowState || "idle"; renderParticipants(); }
  } catch {}
})();

// 定期刷新
setInterval(async () => {
  try {
    const r = await chrome.runtime.sendMessage({ type: "getState" });
    if (r) {
      mergeParticipants(r.participants); debateSession = r.debateSession || {};
      flowState = r.flowState || "idle";
      if (!streamingPollTimer) renderParticipants();
    }
  } catch {}
}, 5000);

// ── 添加参与者 ──
$$(".btn-add").forEach(b => b.addEventListener("click", async () => {
  if (participants.length >= 3) { addLog("最多 3 个参与者", "error"); return; }
  addLog(`添加 ${b.dataset.service}...`);
  await chrome.runtime.sendMessage({ type: "addParticipant", service: b.dataset.service });
}));

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
  // 重置所有参与者的轮询状态
  participants.forEach(p => { p._pollStatus = null; p._textLength = 0; });
  renderParticipants();
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
    if (state) { mergeParticipants(state.participants); flowState = state.flowState; }
    renderParticipants();
    // 如果自动进入了 awaiting，开始轮询
    if (flowState === "awaiting_responses") {
      startStreamingPoll(text.length);
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
  // 重置所有参与者的轮询状态（新一轮开始）
  participants.forEach(p => { p._pollStatus = null; p._textLength = 0; });
  renderParticipants();
  const guidance = guidanceInput?.value?.trim() || "";
  addLog(`第${nextRound}轮辩论${guidance ? " (引导: " + guidance.slice(0, 30) + ")" : ""}`, "info");
  try {
    const concise = $("#concise-mode")?.checked || false;
    const r = await chrome.runtime.sendMessage({ type: "debateRound", style: debateMode, guidance, concise });
    if (r?.ok) {
      addLog(`第${nextRound}轮已发送`, "success");
      // Mark non-active participants as ready so poll doesn't hang waiting for them
      if (r.activeIds) {
        participants.forEach(p => {
          if (!r.activeIds.includes(p.id)) {
            p._pollStatus = "ready";
            p._textLength = 0;
          }
        });
      }
      // 刷新状态
      const state = await chrome.runtime.sendMessage({ type: "getState" });
      if (state) { mergeParticipants(state.participants); flowState = state.flowState; }
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
  btnDebate.disabled = false;
  btnDebate.textContent = `开始辩论（第${getDebateRound() + 1}轮）`;
  btnSend.disabled = false;
  btnSend.textContent = "发送给全部";
  await chrome.runtime.sendMessage({ type: "resetSession" });
  addLog("已重置辩论状态，可以重试", "info");
});

// ── 辩论总结 ──
btnSummary.addEventListener("click", async () => {
  const judgeId = judgeSelect.value;
  if (!judgeId) { addLog("请先选择裁判", "error"); return; }
  btnSummary.disabled = true; btnSummary.textContent = "总结中...";
  addLog("生成总结...", "info");
  try {
    const r = await chrome.runtime.sendMessage({ type: "summary", judgeId });
    if (r?.ok) { addLog("总结已发送", "success"); startStreamingPoll(); }
    else addLog(`失败: ${r?.error}`, "error");
  } catch (e) { addLog("失败: " + e.message, "error"); }
  btnSummary.disabled = false; btnSummary.textContent = "输出总结";
});

// ── 重置 ──
$("#btn-reset").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "resetSession" });
  stopStreamingPoll();
  addLog("会话已重置", "info");
  btnDebate.textContent = "开始辩论";
  renderParticipants();
});

// ── 彻底重置 ──
$("#btn-hard-reset").addEventListener("click", async () => {
  for (const p of participants) {
    if (p.tabId) { try { await chrome.tabs.remove(p.tabId); } catch {} }
  }
  await chrome.runtime.sendMessage({ type: "hardReset" });
  stopStreamingPoll();
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
  renderParticipants();
  addLog("已彻底重置，所有状态已清除", "success");
});


// ── 通知权限 ──
if ("Notification" in window) Notification.requestPermission();

// ── 快捷键 ──
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === "D") { e.preventDefault(); btnDebate.click(); }
});
