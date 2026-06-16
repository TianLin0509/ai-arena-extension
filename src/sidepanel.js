// AI Arena — Side Panel v3.0.0

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// v5.2.4-storage-p1: 统一渲染后台失败 — 优先按 ArenaError code 翻译大白话，回退到旧式 .error 字串。
function _formatErr(resp, fallback) {
  if (!resp) return fallback || "未知错误";
  const code = resp.code || resp.errorCode;
  if (code && typeof renderUserHint === "function") {
    return `[${code}] ${renderUserHint(code)}`;
  }
  return resp.error || fallback || "未知错误";
}

const logEl = $("#log"), listEl = $("#participant-list"), countEl = $("#participant-count");
const judgeSelect = $("#judge-select");
const broadcastInput = $("#broadcast-input"), btnSend = $("#btn-send");
const btnDebate = $("#btn-debate"), btnSummary = $("#btn-summary"), btnDebateRetry = $("#btn-debate-retry");
const guidanceInput = $("#guidance-input"), roundBadge = $("#round-badge");
// v4.9.x: PPT 工坊全量迁出 sidepanel，DOM 引用 / 独立 storage key / pptCustomPrompts 已删。
//         走 popup-tasks.js + background.js pptBuildPrompt 消息 + ppt-prompts.js 统一管线。
let participants = [], debateSession = {}, flowState = "idle", streamingPollTimer = null;

// v4.9.0.2 fix C1: sidepanel 端守门员命中处理（轻量 confirm，不引入 ChatModal 大改动）
//   返回 true = 已处理（命中并 confirm 完）→ 调用方应 return 不再走正常逻辑
//   返回 false = 未命中 → 调用方继续
function handleSensitiveInSidepanel(originalMsg, resp, textField) {
  if (!resp || resp.ok !== false || resp.reason !== "sensitive_blocked") return false;
  const { hits = [], masked = "" } = resp;
  const cats = [...new Set(hits.map(h => h.category))].join(" / ");
  const choice = window.confirm(
    `⚠ 守门员检测到 ${hits.length} 处敏感信息：${cats}\n\n` +
    `打码后预览：\n${masked.slice(0, 200)}${masked.length > 200 ? "..." : ""}\n\n` +
    `点【确定】= 自动打码后发送\n` +
    `点【取消】= 不发送，返回输入框修改`
  );
  if (choice) {
    chrome.runtime.sendMessage({ ...originalMsg, [textField]: masked, skipGatekeeper: true })
      .catch(() => {});
    addLog(`守门员: 已自动打码 ${hits.length} 处敏感信息后发送`, "warn");
  } else {
    addLog(`守门员: 检测到 ${hits.length} 处敏感信息，已取消发送`, "warn");
  }
  return true;
}

function mergeParticipants(remote) {
  if (!remote) return;
  const localMap = {};
  for (const p of participants) localMap[p.id] = p;
  participants = remote.map(rp => {
    const local = localMap[rp.id];
    // 保留本地瞬时字段（远端 StateMachine 不存这些）
    return {
      ...rp,
      _pollStatus: local?._pollStatus || null,
      _textLength: local?._textLength || (rp.response ? rp.response.length : 0),
    };
  });
}
let injectResults = {}; // { participantId: "ok" | "failed" }
// v5.0.8 perf: 渲染签名缓存 — schedulePollTick 每 500ms 触发 renderParticipants，绝大部分 tick
//   状态完全相同（_pollStatus / _textLength / responsePreview 都没变）；签名比对短路避免
//   重复 listEl.innerHTML 整列重建 + 重新 addEventListener。
let _lastParticipantsRenderSig = "";

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

// v4.9.x: PPT_TEMPLATE_META 已迁至 ppt-prompts.js（统一来源），sidepanel 不再重复定义。

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
  // v5.0.8 perf: 签名比对短路 — 0.5s polling tick 90% 状态完全不变，跳过整列 innerHTML 重建
  //   关键字段：参与者数量/轮次/flow 状态 + 每个 p 的 service/tabId/_pollStatus/_textLength/
  //   responsePreview/userEdited/injectResults。任一变化才真正重渲。
  try {
    const sig = JSON.stringify({
      n: participants.length,
      r: debateSession?.rounds?.length || 0,
      f: flowState,
      p: participants.map(p => ([
        p.id, p.service, p.tabId,
        p._pollStatus || "", p._textLength || 0,
        // v5.0.8 fix: 用 responsePreview 头 20 字而非 !! — 防"内容变化但有无状态没变"
        //   的边缘场景下签名误命中（如第二轮辩论直接覆盖 responsePreview，没经过 null 中间态）
        p.responsePreview ? p.responsePreview.slice(0, 20) : "",
        !!p.userEdited,
        injectResults[p.id] || "",
      ])),
    });
    if (sig === _lastParticipantsRenderSig) return;
    _lastParticipantsRenderSig = sig;
  } catch (_) { /* JSON.stringify 失败兜底走重渲 */ }
  countEl.textContent = participants.length;
  const rounds = debateSession?.rounds?.length || 0;
  if (rounds > 0) { roundBadge.style.display = ""; roundBadge.textContent = `第${rounds}轮`; }
  else { roundBadge.style.display = "none"; }
  updateTaskState();

  if (!participants.length) {
    listEl.innerHTML = `<div class="empty-hint">
      <div class="empty-icon">⚡</div>
      <div class="empty-title">添加 AI 参与者</div>
      <div class="empty-desc">支持 Claude、GPT、Gemini 等 9 种 AI，在同一窗口中同步提问并展开多轮辩论</div>
      <div class="empty-actions">
        <span class="empty-chip claude" data-service="claude">+ Claude</span>
        <span class="empty-chip chatgpt" data-service="chatgpt">+ GPT</span>
        <span class="empty-chip gemini" data-service="gemini">+ Gemini</span>
      </div>
    </div>`;
    // 空状态芯片可点击
    listEl.querySelectorAll('.empty-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const screen = {
          width: window.screen.availWidth, height: window.screen.availHeight,
          left: window.screen.availLeft || 0, top: window.screen.availTop || 0,
        };
        chrome.runtime.sendMessage({ type: "addParticipant", service: chip.dataset.service, screen }, (r) => {
          // v5.2.23: 千问与其他 AI 互斥 — background 守卫拒绝时弹提示
          if (r?.error === "QWEN_INCOMPATIBLE" && r?.message) { try { alert(r.message); } catch (_) {} }
        });
      });
    });
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

      // 流式进度条
      const isStreamingNow = pState === "streaming" || pState === "waiting";
      const progressBar = isStreamingNow
        ? `<div class="stream-progress"><div class="stream-progress-bar" style="width:${Math.min(90, Math.max(15, (p._textLength || 0) / 10))}%"></div></div>`
        : '';

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
        `<button class="p-action-btn p-send" data-id="${p.id}" title="重新发送提问给该AI">↻</button>`,
        `<button class="p-action-btn p-extract" data-id="${p.id}" title="手动提取该AI的回复">⇣</button>`
      ].join('') : '';

      const metaParts = [
        p.tabId ? "已打开" : "离线",
        stateLabel ? `${stateIcon} ${stateLabel}` : "",
        charCount > 0 ? `${charCount}字` : ""
      ].filter(Boolean).join(" · ");

      return `<div class="participant-item ${p.service}" data-tab-id="${p.tabId || ''}" style="cursor:pointer">
        <div class="p-main">
          <div class="p-title-row">
            <span class="p-status ${sc}"></span>
            ${brandIcon(p.service)}
            <span class="p-name">${p.name}</span>
            ${readyBadge}
          </div>
          <div class="p-meta-row">
            <span>${metaParts || "等待操作"}</span>
          </div>
          ${progressBar}
          ${gateActions}
        </div>
        <div class="p-actions">
          ${actionBtns}
          <button class="p-btn p-remove" data-id="${p.id}" title="移除">✕</button>
        </div>
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
        addLog(`发送失败: ${_formatErr(resp, "未知错误")}`, "error");
      }
      b.textContent = "↻"; b.disabled = false;
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
        trackChars(resp.text.length, p?.service);
        addLog(`${p?.name || id} 回复已提取 (${resp.text.length}字)`, "success");
        renderParticipants();
        // 检查是否所有人都 ready 了
        checkAllReadyAndConfirm();
      } else {
        addLog(`提取失败: ${_formatErr(resp, "未读取到内容")}`, "error");
        b.textContent = "⇣"; b.disabled = false;
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

    // 点击参与者卡片 → 聚焦对应 tab
    listEl.querySelectorAll(".participant-item").forEach(card => {
      card.addEventListener("click", async (e) => {
        if (e.target.closest("button")) return;
        const tabId = parseInt(card.dataset.tabId);
        if (!tabId) return;
        try {
          const tab = await chrome.tabs.get(tabId);
          await chrome.windows.update(tab.windowId, { focused: true });
          await chrome.tabs.update(tabId, { active: true });
        } catch {}
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

// ── 无标记轮询（文本稳定 + streaming 状态） ──
let pollStartTime = 0, pollErrorCount = 0, pollReadyCount = 0;
let pollDelayTimer = null;
let prevLengths = {}; // { participantId: number }
let stableCounts = {}; // { participantId: consecutiveStablePolls }
let hasStreamedMap = {}; // { participantId: bool } — 必须观察到一次"流过"才允许判 ready
let pollActiveIds = null; // null = 全部在线参与者；Set = 只轮询本轮发送目标
const POLL_MAX_DURATION = 10 * 60 * 1000;
const POLL_MAX_ERRORS = 10;
const POLL_READY_THRESHOLD = 3; // 连续3次稳定才判定完成
const POLL_INITIAL_DELAY = 2000;
const POLL_INTERVAL = 500; // 0.5秒轮询（无标记后适当放慢）

function startStreamingPoll(activeIds = null) {
  stopStreamingPoll();
  pollStartTime = Date.now();
  pollErrorCount = 0;
  pollReadyCount = 0;
  prevLengths = {};
  stableCounts = {};
  hasStreamedMap = {};
  pollActiveIds = Array.isArray(activeIds) ? new Set(activeIds) : null;
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
          if (pollActiveIds && !pollActiveIds.has(id)) continue;
          if (v.status === "offline") continue;
          hasOnline = true;
          const prevLen = prevLengths[id] || 0;
          const lengthChanged = v.textLength !== prevLen;
          prevLengths[id] = v.textLength;

          const p = participants.find(p => p.id === id);
          if (p) {
            p._textLength = v.textLength;

            // 判定（v4.0.3-beta）：isStreaming 作为软信号——selector 有效时强约束（不允许在 streaming 中误判完成），
            // selector 失效时（永远 false）自动退化为只看 lengthChanged。
            if (v.textLength > 0) hasStreamedMap[id] = true;
            // isStreaming=true 时强制重置稳定计数：哪怕长度暂时不变，仍在流式中（AI 思考停顿等）
            if (v.isStreaming) {
              stableCounts[id] = 0;
            }

            if (v.textLength > 0 && !lengthChanged && !v.isStreaming) {
              // 文本非空 + 长度不变 + 非流式中 → 累计稳定次数
              stableCounts[id] = (stableCounts[id] || 0) + 1;
              if (stableCounts[id] >= POLL_READY_THRESHOLD && p._pollStatus !== "ready") {
                p._pollStatus = "ready";
                // 防 chat-bus 已完成同步过来：若 StateMachine 已有 response（chat-bus 抢先调过 readOneResponse），
                // 跳过自己的 readOneResponse 调用，避免 sanity check 因 prevResp 已存在而误判为"上轮残留"，导致状态回退
                if (p.response && p.response.trim().length > 0) {
                  addLog(`${p.name} 已由 popup 同步 (${p.response.length}字)`, "info");
                  p._textLength = p.response.length;
                  renderParticipants();
                  return;
                }
                chrome.runtime.sendMessage({ type: "readOneResponse", participantId: id }).then(resp => {
                  if (resp?.ok) {
                    if (resp.text) {
                      trackChars(resp.text.length, p.service);
                      // 同步更新本地 _textLength 以最终回复长度为准
                      const localP = participants.find(x => x.id === id);
                      if (localP) localP._textLength = resp.text.length;
                    }
                    addLog(`${p.name} 回复已自动提取`, "success");
                    chrome.runtime.sendMessage({ type: "getState" }).then(state => {
                      if (state) { mergeParticipants(state.participants); renderParticipants(); }
                    });
                  } else if (resp?.error) {
                    // sanity check 拒绝：回退状态、清稳定计数，让轮询继续观察
                    addLog(`${p.name}: ${resp.error}`, "error");
                    p._pollStatus = "waiting";
                    stableCounts[id] = 0;
                    hasStreamedMap[id] = false;
                    renderParticipants();
                  }
                }).catch(() => {});
              }
            } else if (lengthChanged || v.isStreaming) {
              // 长度变化 或 isStreaming=true → 仍在生成中
              stableCounts[id] = 0;
              p._pollStatus = v.textLength > 0 ? "streaming" : "waiting";
            } else {
              // textLength=0 且不变 → 还没开始，waiting
              stableCounts[id] = 0;
              p._pollStatus = "waiting";
            }
          }
          if (p?._pollStatus !== "ready") allDone = false;
        }
        renderParticipants();

        if (allDone && hasOnline) {
          pollReadyCount++;
          if (pollReadyCount >= 2) {
            addLog("所有 AI 已回答完毕，读取回复...", "success");
            const doneIds = pollActiveIds ? Array.from(pollActiveIds) : null;
            stopStreamingPoll();
            await readAllResponses(doneIds);
            if (Notification.permission === "granted") {
              try { new Notification("AI圆桌派", { body: "所有 AI 已回答完毕", icon: "icons/icon128.png" }); } catch {}
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
  pollActiveIds = null;
}

// 读取本轮目标参与者的回复；未传 activeIds 时读取全部参与者
async function readAllResponses(activeIds = null) {
  const activeSet = Array.isArray(activeIds) ? new Set(activeIds) : activeIds;
  for (const p of participants) {
    if (activeSet && !activeSet.has(p.id)) continue;
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

// v5.0.8 perf: 删除 5s setInterval 兜底 — 旧版每 5s 唤醒 SW 拉 getState，多数情况是无用功
//   （stateUpdate 主动推送已覆盖所有真实状态变化）。改成可见性事件驱动：用户切走 sidepanel
//   再切回时单次刷新，避免持续轮询拖累 SW idle 回收。
//   兜底保留：document.visibilitychange + window.focus 都触发一次 getState。
async function _refreshFromBackground() {
  try {
    const r = await chrome.runtime.sendMessage({ type: "getState" });
    if (r) {
      mergeParticipants(r.participants); debateSession = r.debateSession || {};
      flowState = r.flowState || "idle";
      if (!streamingPollTimer) renderParticipants();
    }
  } catch {}
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) _refreshFromBackground();
});
window.addEventListener("focus", _refreshFromBackground);

// ── 窗口模式切换 ──
$$(".mode-opt").forEach(btn => {
  btn.addEventListener("click", async () => {
    $$(".mode-opt").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const mode = btn.dataset.mode;
    await chrome.runtime.sendMessage({ type: "setWindowMode", mode });
    addLog(`切换到${mode === "tiled" ? "并列" : "Tab"}模式`, "info");
    // 并列模式下自动排列已有窗口
    if (mode === "tiled" && participants.length > 0) {
      // v5.0.40: 用 getCurrentScreenInfo（chrome.windows.getCurrent 真实窗口位置）定位物理屏，
      //   不再用裸 window.screen.width —— 后者在多屏 / 某些 chrome 版本会返回 desktop union 宽，
      //   使每个 AI 窗口偏宽、最右窗口（含关闭按钮 ✕）被推出屏幕外。与「添加参与者」路径对齐。
      const screen = await getCurrentScreenInfo();
      const r = await chrome.runtime.sendMessage({ type: "arrangeWindows", screen });
      if (r?.ok) addLog("窗口已排列", "success");
    }
  });
});


// ── 当前任务 tabs ──
function setActiveTask(task) {
  $$(".task-tab").forEach(btn => btn.classList.toggle("active", btn.dataset.task === task));
  $$(".task-panel").forEach(panel => panel.classList.toggle("active", panel.dataset.taskPanel === task));
}

$$(".task-tab").forEach(btn => {
  btn.addEventListener("click", () => setActiveTask(btn.dataset.task));
});

// ── 添加参与者 ──
// 报告 sidepanel 当前所在 chrome window 的 bounds 给 background（用于推断真实物理屏）
async function getCurrentScreenInfo() {
  // 优先用 chrome.windows.getCurrent，因为 sidepanel 的 window.screen 在某些 chrome 版本会
  // 返回全 desktop union 而非真实所在屏；getCurrent 拿到 sidepanel 附着的 chrome window
  // 的 left/top/width/height，background 再据此找物理屏。
  try {
    const w = await chrome.windows.getCurrent();
    if (w && typeof w.left === "number") {
      return {
        width: w.width,
        height: w.height,
        left: w.left,
        top: w.top,
        // 同时报告 window.screen 作为 fallback 信号
        screenAvailWidth: window.screen.availWidth,
        screenAvailHeight: window.screen.availHeight,
        screenAvailLeft: window.screen.availLeft || 0,
        screenAvailTop: window.screen.availTop || 0,
      };
    }
  } catch {}
  // fallback：用 window.screen
  return {
    width: window.screen.availWidth,
    height: window.screen.availHeight,
    left: window.screen.availLeft || 0,
    top: window.screen.availTop || 0,
  };
}

$$(".btn-add").forEach(b => b.addEventListener("click", async () => {
  if (participants.length >= 3) { addLog("最多 3 个参与者", "error"); return; }
  addLog(`添加 ${b.dataset.service}...`);
  const screen = await getCurrentScreenInfo();
  // v5.2.23: 千问与其他 AI 互斥 — background 守卫拒绝时弹提示
  const r = await chrome.runtime.sendMessage({ type: "addParticipant", service: b.dataset.service, screen });
  if (r?.error === "QWEN_INCOMPATIBLE" && r?.message) { try { alert(r.message); } catch (_) {} }
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

// v5.0.8 perf: input 事件 debounce 100ms — 纯文字快速输入时不需要每键击都扫整个 contenteditable
//   找 img；仅当用户停顿 100ms+ 时才触发扫描（粘贴图片场景仍及时处理）
let _inputImgScanTimer = null;
broadcastInput.addEventListener("input", () => {
  if (_inputImgScanTimer) clearTimeout(_inputImgScanTimer);
  _inputImgScanTimer = setTimeout(() => {
    _inputImgScanTimer = null;
    broadcastInput.querySelectorAll("img").forEach(img => { if (img.src.startsWith("data:")) { addImage(img.src); img.remove(); } });
  }, 100);
});

// ── 广播 ──
async function doBroadcast() {
  if (btnSend.disabled) return;
  let text = broadcastInput.innerText.trim();
  const hasImages = pendingImages.length > 0;
  const hasFiles = pendingFiles.length > 0;
  if (!text && !hasImages && !hasFiles) return;
  if (!participants.length) { addLog("请先添加参与者", "error"); return; }
  if (hasFiles) {
    text += pendingFiles.map(f => `\n\n---\n📄 文件: ${f.name}\n\`\`\`\n${f.content}\n\`\`\``).join("");
  }
  btnSend.disabled = true; btnSend.innerHTML = '<span class="btn-spinner btn-dark-spinner"></span> 发送中...';
  // 重置所有参与者的轮询状态
  participants.forEach(p => { p._pollStatus = null; p._textLength = 0; });
  renderParticipants();
  const attachInfo = [];
  if (hasImages) attachInfo.push(`${pendingImages.length}张图`);
  if (hasFiles) attachInfo.push(`${pendingFiles.length}个文件`);
  addLog("广播: " + text.slice(0, 50) + (text.length > 50 ? "..." : "") + (attachInfo.length ? ` (+${attachInfo.join(", ")})` : ""));
  trackConversation(participants.length);

  try {
    const broadcastMsg = { type: "broadcast", text, images: hasImages ? pendingImages : undefined };
    const r = await chrome.runtime.sendMessage(broadcastMsg);
    // v4.9.0.2 fix C1: 守门员命中 → 轻量 confirm 处理（自动打码后发 / 取消）
    if (handleSensitiveInSidepanel(broadcastMsg, r, "text")) {
      btnSend.disabled = false; btnSend.innerHTML = "发送";
      return;
    }
    if (r) {
      injectResults = {};
      for (const [id, v] of Object.entries(r)) {
        injectResults[id] = (v.status === "sent" || v.status === "inputted") ? "ok" : "failed";
        const errHint = (v.code || v.error) ? " - " + _formatErr(v, "") : "";
        addLog(`${v.name}: ${v.status}${errHint}`, v.status === "sent" || v.status === "inputted" ? "success" : "error");
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
      startStreamingPoll();
    }
  } catch (e) { addLog("失败: " + e.message, "error"); }
  btnSend.disabled = false; btnSend.innerHTML = '发送给全部';
}
btnSend.addEventListener("click", doBroadcast);
broadcastInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); doBroadcast(); } });

// v4.9.x: PPT 制作 block 已整体迁出（setPptPrompt / sendPptPromptToChatGPT 已删）。

function updateTaskState() {
  const el = $("#task-state");
  if (!el) return;
  const readyCount = participants.filter(p => !!p.responsePreview).length;
  const labels = {
    idle: participants.length ? `${participants.length} 个参与者` : "准备就绪",
    broadcasting: "正在发送",
    awaiting_responses: `等待回复 ${readyCount}/${participants.length}`,
    debating: "辩论中",
    summary: "总结中"
  };
  el.textContent = labels[flowState] || "准备就绪";
}

// v4.9.x: PPT 工坊所有按钮事件（btnPptCopy / btnPptImageMenu / pptTemplateMenu /
//         btnPptxPrompt / pptPromptBox input / btnPptStart / btnPptSaveMenu / pptSaveMenu）
//         + document.click 关菜单逻辑 已整体删除，迁至 popup-tasks.js。

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
  if (btnDebate.disabled) return;
  if (participants.length < 2) { addLog("至少需要 2 个参与者", "error"); return; }
  const nextRound = getDebateRound() + 1;
  btnDebate.disabled = true; btnDebate.innerHTML = `<span class="btn-spinner"></span> 第${nextRound}轮...`;
  // 重置所有参与者的轮询状态（新一轮开始）
  participants.forEach(p => { p._pollStatus = null; p._textLength = 0; });
  renderParticipants();
  const guidance = guidanceInput?.value?.trim() || "";
  addLog(`第${nextRound}轮辩论${guidance ? " (引导: " + guidance.slice(0, 30) + ")" : ""}`, "info");
  trackDebateRound();
  try {
    const concise = $("#concise-mode")?.checked || false;
    // v4.8.38: needsConfirm 路径 — handleDebateRound 探测到 polling 中的 AI 会先返回提示
    const debateMsg = { type: "debateRound", style: debateMode, guidance, concise };
    let r = await chrome.runtime.sendMessage(debateMsg);
    // v4.9.0.2 fix C1: 守门员命中（guidance 含敏感词）
    if (handleSensitiveInSidepanel(debateMsg, r, "guidance")) {
      btnDebate.disabled = false; btnDebate.innerHTML = `开始辩论（第${getDebateRound() + 1}轮）`;
      return;
    }
    if (r?.needsConfirm) {
      if (window.confirm(r.message)) {
        r = await chrome.runtime.sendMessage({ type: "debateRound", style: debateMode, guidance, concise, force: true });
      } else {
        addLog(`已取消（${r.pollingNames?.length || 0} 个 AI 仍在回答中）`, "info");
        btnDebate.disabled = false; btnDebate.innerHTML = `开始辩论（第${getDebateRound() + 1}轮）`;
        return;
      }
    }
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
      if (flowState === "awaiting_responses") startStreamingPoll(r.activeIds || null);
      if (guidance && guidanceInput) guidanceInput.value = "";
    } else addLog(`失败: ${r?.error}`, "error");
  } catch (e) { addLog("失败: " + e.message, "error"); }
  btnDebate.disabled = false; btnDebate.innerHTML = `开始辩论（第${getDebateRound() + 1}轮）`;
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
  btnSummary.disabled = true; btnSummary.innerHTML = '<span class="btn-spinner"></span> 总结中...';
  addLog("生成总结...", "info");
  try {
    const summaryMsg = { type: "summary", judgeId };
    const r = await chrome.runtime.sendMessage(summaryMsg);
    // v4.9.0.2 fix C1: 防御性接守门员（当前 sidepanel summary 不带 customInstruction 巧合安全，
    // 但一旦 v4.9.1 加可编辑 customInstruction 立即生效）
    if (handleSensitiveInSidepanel(summaryMsg, r, "customInstruction")) {
      btnSummary.disabled = false; btnSummary.innerHTML = '输出总结';
      return;
    }
    if (r?.ok) { addLog("总结已发送", "success"); startStreamingPoll(); }
    else addLog(`失败: ${r?.error}`, "error");
  } catch (e) { addLog("失败: " + e.message, "error"); }
  btnSummary.disabled = false; btnSummary.innerHTML = '输出总结';
});

// ── 导出 ──
$("#btn-export").addEventListener("click", async () => {
  try {
    const r = await chrome.runtime.sendMessage({ type: "exportSession" });
    if (!r?.ok || !r.markdown) { addLog("无辩论记录可导出", "error"); return; }
    await navigator.clipboard.writeText(r.markdown);
    addLog("辩论记录已复制到剪贴板", "success");
    const blob = new Blob([r.markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai-arena-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    addLog("Markdown 文件已下载", "success");
  } catch (e) { addLog("导出失败: " + e.message, "error"); }
});

// ── 重置 ──
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


// ── 统计（本次 + 历史累计） ──
const STATS_KEY = "arena_lifetime_stats";
let lifetimeStats = { conversations: 0, debates: 0, totalChars: 0, models: {} };
let sessionStats = { conversations: 0, debates: 0, totalChars: 0, models: {} };

// 模型品牌色映射
const SERVICE_COLORS = {
  claude: "#d4a574", gemini: "#4285f4", chatgpt: "#10a37f",
  deepseek: "#4d6bfe", doubao: "#ff6a3d", qwen: "#6236ff",
  kimi: "#5b6af0", yuanbao: "#0052d9", grok: "#888888"
};
const SERVICE_NAMES = {
  claude: "Claude", gemini: "Gemini", chatgpt: "GPT",
  deepseek: "DeepSeek", doubao: "豆包", qwen: "千问",
  kimi: "Kimi", yuanbao: "元宝", grok: "Grok"
};
const BRAND_ICONS = {
  claude: "icons/brands/claude.svg", gemini: "icons/brands/gemini.svg",
  chatgpt: "icons/brands/openai.svg", deepseek: "icons/brands/deepseek.svg",
  doubao: "icons/brands/doubao.svg", qwen: "icons/brands/qwen.svg",
  kimi: "icons/brands/kimi.svg", yuanbao: "icons/brands/yuanbao.svg",
  grok: "icons/brands/grok.svg"
};
function brandIcon(service) {
  const src = BRAND_ICONS[service] || "";
  return src ? `<img class="brand-icon" src="${src}" alt="">` : "";
}

// 字数→Token 估算（中文~1.5 token/字，英文~1.3 token/word，取 1.4 均值）
function charsToTokens(chars) { return Math.round(chars * 1.4); }
function fmtTokens(tokens) { return tokens >= 10000 ? (tokens / 10000).toFixed(1) + '万' : tokens.toLocaleString(); }

async function loadStats() {
  const data = await chrome.storage.local.get(STATS_KEY);
  if (data[STATS_KEY]) {
    lifetimeStats = data[STATS_KEY];
    // 兼容旧数据（无 models 字段）
    if (!lifetimeStats.models) lifetimeStats.models = {};
  }
  renderStats();
}

function saveStats() {
  chrome.storage.local.set({ [STATS_KEY]: lifetimeStats });
  renderStats();
}

function renderStats() {
  // 本次
  $("#stat-s-conversations").textContent = sessionStats.conversations;
  $("#stat-s-debates").textContent = sessionStats.debates;
  $("#stat-s-tokens").textContent = fmtTokens(charsToTokens(sessionStats.totalChars));
  // 历史累计
  $("#stat-l-conversations").textContent = lifetimeStats.conversations;
  $("#stat-l-debates").textContent = lifetimeStats.debates;
  $("#stat-l-tokens").textContent = fmtTokens(charsToTokens(lifetimeStats.totalChars));
  // 分模型
  renderPerModelStats();
}

function renderPerModelStats() {
  const listEl = $("#models-list");
  const models = lifetimeStats.models;
  const entries = Object.entries(models);
  if (!entries.length) {
    listEl.innerHTML = '<div class="empty-hint">暂无模型统计数据</div>';
    return;
  }
  // 按 Token 量降序
  entries.sort((a, b) => (b[1].chars || 0) - (a[1].chars || 0));
  const totalChars = entries.reduce((sum, [, v]) => sum + (v.chars || 0), 0);

  listEl.innerHTML = entries.map(([service, data], i) => {
    const tokenCount = charsToTokens(data.chars || 0);
    const rounds = data.rounds || 0;
    const avgPerRound = rounds > 0 ? Math.round(charsToTokens(data.chars || 0) / rounds) : 0;
    const color = SERVICE_COLORS[service] || "#888";
    const name = SERVICE_NAMES[service] || service;
    const pct = totalChars > 0 ? ((data.chars || 0) / totalChars * 100).toFixed(0) : 0;
    const rankClass = i === 0 ? "rank-1" : i === 1 ? "rank-2" : i === 2 ? "rank-3" : "";
  return `<div class="model-row">
      <span class="model-rank ${rankClass}">#${i + 1}</span>
      ${brandIcon(service)}
      <span class="model-name">${name}</span>
      <span class="model-stat"><span class="val">${fmtTokens(tokenCount)}</span> <span class="lbl">总Token</span></span>
      <span class="model-stat"><span class="val">${avgPerRound.toLocaleString()}</span> <span class="lbl">均/轮</span></span>
      <span class="model-stat" style="min-width:34px"><span class="val">${pct}%</span></span>
    </div>`;
  }).join("");
}

// 广播：对话次数 = 参与者数量（每个AI算一次对话）
function trackConversation(participantCount) {
  sessionStats.conversations += participantCount;
  lifetimeStats.conversations += participantCount;
  saveStats();
}
// 辩论：+1 轮（与参与者数无关）
function trackDebateRound() {
  sessionStats.debates++;
  lifetimeStats.debates++;
  saveStats();
}
// 回复字数累加（per-model）
function trackChars(charCount, service) {
  sessionStats.totalChars += charCount;
  lifetimeStats.totalChars += charCount;
  if (service) {
    if (!sessionStats.models[service]) sessionStats.models[service] = { chars: 0, rounds: 0 };
    sessionStats.models[service].chars += charCount;
    sessionStats.models[service].rounds++;
    if (!lifetimeStats.models[service]) lifetimeStats.models[service] = { chars: 0, rounds: 0 };
    lifetimeStats.models[service].chars += charCount;
    lifetimeStats.models[service].rounds++;
  }
  saveStats();
}

// Tab 切换
$$(".stats-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    $$(".stats-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    $("#stats-session").style.display = tab === "session" ? "" : "none";
    $("#stats-lifetime").style.display = tab === "lifetime" ? "" : "none";
    $("#stats-models").style.display = tab === "models" ? "" : "none";
  });
});

loadStats();
// v4.9.x: loadPptCustomPrompts() 调用已删，PPT 工坊迁至 popup。

// ── 通知权限 ──
if ("Notification" in window) Notification.requestPermission();

// ── 动态预览浮窗 ──
const dynamicTip = $("#dynamic-tip");

function truncateMiddle(text, maxLen = 300) {
  if (text.length <= maxLen) return text;
  const half = Math.floor((maxLen - 3) / 2);
  return text.slice(0, half) + "\n…\n" + text.slice(-half);
}

function buildBroadcastPreview() {
  let text = broadcastInput.innerText.trim();
  if (!text && !pendingImages.length && !pendingFiles.length) return "（空内容）";
  if (pendingFiles.length > 0) text += pendingFiles.map(f => `\n\n📄 文件: ${f.name}`).join("");
  if (pendingImages.length > 0) text += `\n\n🖼️ ${pendingImages.length}张图片`;
  return truncateMiddle(text, 500);
}

function buildDebatePreview() {
  const round = getDebateRound() + 1;
  const style = debateMode === "free" ? "⚔️ 自由辩论" : "🤝 群策群力";
  const guidance = guidanceInput?.value?.trim();
  const concise = $("#concise-mode")?.checked;
  const readyNames = participants.filter(p => !!p.responsePreview).map(p => p.name);
  let text = `第${round}轮 ${style}\n参与者: ${readyNames.join(", ") || "（无就绪回答）"}`;
  if (guidance) text += `\n引导: ${guidance}`;
  if (concise) text += "\n📏 简洁模式（≤1000字）";
  text += "\n\n各AI将收到其他参与者的回答，并按辩论风格回应";
  return text;
}

let dynamicTipTimer = null;

function showDynamicTip(target, content) {
  clearTimeout(dynamicTipTimer);
  dynamicTip.textContent = content;
  const rect = target.getBoundingClientRect();
  dynamicTip.style.left = Math.max(4, rect.left) + "px";
  dynamicTip.style.top = (rect.top - dynamicTip.offsetHeight - 8) + "px";
  dynamicTip.classList.add("visible");
  requestAnimationFrame(() => {
    dynamicTip.style.top = (rect.top - dynamicTip.offsetHeight - 8) + "px";
  });
}

function hideDynamicTipDelayed() {
  dynamicTipTimer = setTimeout(() => dynamicTip.classList.remove("visible"), 300);
}

function hideDynamicTipNow() {
  clearTimeout(dynamicTipTimer);
  dynamicTip.classList.remove("visible");
}

dynamicTip.addEventListener("mouseenter", () => clearTimeout(dynamicTipTimer));
dynamicTip.addEventListener("mouseleave", hideDynamicTipNow);

btnSend.addEventListener("mouseenter", () => showDynamicTip(btnSend, buildBroadcastPreview()));
btnSend.addEventListener("mouseleave", hideDynamicTipDelayed);
btnDebate.addEventListener("mouseenter", () => showDynamicTip(btnDebate, buildDebatePreview()));
btnDebate.addEventListener("mouseleave", hideDynamicTipDelayed);

// ── 打开群聊窗口 ──
document.getElementById("btn-open-chat")?.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "openChatPopup" }, (resp) => {
    if (chrome.runtime.lastError || !resp?.ok) {
      console.warn("打开群聊失败:", chrome.runtime.lastError);
    }
  });
});

// ── 快捷键 ──
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === "D") { e.preventDefault(); btnDebate.click(); }
});

// ── 主题切换 ──
(function initTheme() {
  const btnTheme = $("#btn-theme");
  const themeMenu = $("#theme-menu");
  if (!btnTheme || !themeMenu) return;

  chrome.storage.local.get("uiTheme", (d) => {
    const theme = d.uiTheme || "C";
    document.body.setAttribute("data-theme", theme);
    updateThemeActive(theme);
  });

  btnTheme.addEventListener("click", (e) => {
    e.stopPropagation();
    themeMenu.classList.toggle("open");
  });

  themeMenu.querySelectorAll(".theme-menu-item").forEach(item => {
    item.addEventListener("click", () => {
      const theme = item.dataset.theme;
      document.body.setAttribute("data-theme", theme);
      chrome.storage.local.set({ uiTheme: theme });
      updateThemeActive(theme);
      themeMenu.classList.remove("open");
    });
  });

  document.addEventListener("click", () => themeMenu.classList.remove("open"));

  function updateThemeActive(theme) {
    themeMenu.querySelectorAll(".theme-menu-item").forEach(i => {
      i.classList.toggle("active", i.dataset.theme === theme);
    });
  }
})();
