// AI Arena — 群聊业务总线（背景脚本子模块）
// 由 background.js 通过 importScripts 加载，挂在 self.ChatBus

const ChatBus = (() => {
  // ── 状态 ──
  let popupWindowId = null;        // 当前 popup window id，null 表示未开
  let popupBounds = null;          // 用户拖动后记忆的位置/尺寸
  const chatLog = [];              // 最近 100 条消息
  const MAX_LOG = 100;
  const STORAGE_KEYS = { log: "chatLog", bounds: "chatPopupBounds" };

  // ── 初始化：读 storage ──
  async function init() {
    const data = await chrome.storage.local.get([STORAGE_KEYS.log, STORAGE_KEYS.bounds]);
    if (Array.isArray(data[STORAGE_KEYS.log])) chatLog.push(...data[STORAGE_KEYS.log].slice(-MAX_LOG));
    if (data[STORAGE_KEYS.bounds]) popupBounds = data[STORAGE_KEYS.bounds];
  }

  // ── popup 生命周期 ──
  async function openChatPopup() {
    if (popupWindowId != null) {
      try {
        await chrome.windows.update(popupWindowId, { focused: true });
        return { ok: true, reused: true, windowId: popupWindowId };
      } catch {
        popupWindowId = null;  // window 已被关
      }
    }
    const bounds = popupBounds || await defaultBounds();
    const w = await chrome.windows.create({
      url: chrome.runtime.getURL("popup.html"),
      type: "popup",
      ...bounds,
    });
    popupWindowId = w.id;
    return { ok: true, reused: false, windowId: w.id };
  }

  async function defaultBounds() {
    try {
      const displays = await chrome.system.display.getInfo();
      const primary = displays.find(d => d.isPrimary) || displays[0];
      const w = Math.min(1100, Math.round(primary.workArea.width * 0.7));
      const h = Math.min(720, Math.round(primary.workArea.height * 0.85));
      return {
        left: primary.workArea.left + primary.workArea.width - w - 20,
        top: primary.workArea.top + 40,
        width: w,
        height: h,
      };
    } catch {
      return { left: 100, top: 100, width: 1100, height: 720 };
    }
  }

  function onWindowRemoved(windowId) {
    if (windowId === popupWindowId) popupWindowId = null;
  }

  async function rememberBounds(windowId) {
    if (windowId !== popupWindowId) return;
    try {
      const w = await chrome.windows.get(popupWindowId);
      popupBounds = { left: w.left, top: w.top, width: w.width, height: w.height };
      await chrome.storage.local.set({ [STORAGE_KEYS.bounds]: popupBounds });
    } catch {}
  }

  // ── polling 调度器 ──
  // pollers: Map<participantId, { intervalId, lastText, sameCount, msgId }>
  const pollers = new Map();
  const POLL_INTERVAL_MS = 1500;
  const STREAM_DONE_THRESHOLD = 3;  // 连续 N 次相同视为完成

  async function sendToPopup(payload) {
    if (popupWindowId == null) return;
    try {
      // popup 没有 tabId，只能广播到所有 runtime context
      await chrome.runtime.sendMessage(payload);
    } catch {}
  }

  function newMsgId() {
    return `m${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  }

  function pushLog(entry) {
    chatLog.push(entry);
    while (chatLog.length > MAX_LOG) chatLog.shift();
    chrome.storage.local.set({ [STORAGE_KEYS.log]: chatLog }).catch(() => {});
  }

  async function broadcast(text, targets, images) {
    if (!text?.trim()) return { ok: false, error: "empty text" };

    // 决定目标参与者
    const allParticipants = StateMachine.participants || [];
    const targetList = targets?.length
      ? allParticipants.filter(p => targets.includes(p.service))
      : allParticipants;

    if (!targetList.length) {
      return { ok: false, error: "无可用参与者" };
    }

    const msgId = newMsgId();
    const userEntry = { role: "user", msgId, text, ts: Date.now() };
    pushLog(userEntry);
    sendToPopup({ type: "chatStreamUpdate", role: "user", msgId, text });

    // 对每个目标 AI: 注入 + 启动 polling
    for (const p of targetList) {
      sendToPopup({
        type: "chatStreamUpdate", role: "ai", msgId,
        participantId: p.service, text: "", isDone: false,
      });
      injectAndPoll(p, msgId, text);
    }
    return { ok: true, msgId, targets: targetList.map(p => p.service) };
  }

  // 外部触发的轮次（辩论 / 总结 / 手动发送）：不再 inject（外部已 inject），只显示用户气泡+启动 polling
  // displayText = popup 用户气泡显示文本（如"⚔️ 第1轮辩论·自由"）
  // participantServices = 受影响的参与者 service id 列表（如 ["claude","gemini","chatgpt"]）
  function notifyRoundStart(displayText, participantServices) {
    const allParticipants = StateMachine.participants || [];
    const targetList = participantServices?.length
      ? allParticipants.filter(p => participantServices.includes(p.service))
      : allParticipants;
    if (!targetList.length) return { ok: false, error: "无目标参与者" };

    const msgId = newMsgId();
    pushLog({ role: "user", msgId, text: displayText, ts: Date.now() });
    sendToPopup({ type: "chatStreamUpdate", role: "user", msgId, text: displayText });

    for (const p of targetList) {
      sendToPopup({
        type: "chatStreamUpdate", role: "ai", msgId,
        participantId: p.service, text: "", isDone: false,
      });
      // 启动该 participant 的 polling（不 inject）
      if (pollers.has(p.service)) clearInterval(pollers.get(p.service).intervalId);
      const state = { lastText: "", sameCount: 0, msgId };
      state.intervalId = setInterval(() => pollOnce(p, state), POLL_INTERVAL_MS);
      pollers.set(p.service, state);
    }
    return { ok: true, msgId };
  }

  async function injectAndPoll(participant, msgId, text) {
    const { tabId, service } = participant;
    try {
      await chrome.tabs.sendMessage(tabId, { action: "inject", text });
    } catch (e) {
      sendToPopup({
        type: "chatStreamUpdate", role: "ai", msgId,
        participantId: service, text: `⚠ ${participant.name} 注入失败: ${e.message}`,
        isDone: true,
      });
      return;
    }
    // 启动 polling
    if (pollers.has(service)) clearInterval(pollers.get(service).intervalId);
    const state = { lastText: "", sameCount: 0, msgId };
    state.intervalId = setInterval(() => pollOnce(participant, state), POLL_INTERVAL_MS);
    pollers.set(service, state);
  }

  async function pollOnce(participant, state) {
    const { tabId, service } = participant;
    try {
      const r = await chrome.tabs.sendMessage(tabId, { action: "readResponse" });
      const text = (r?.text || "").trim();
      const hasRich = !!r?.hasRichContent;
      const richTypes = r?.richTypes || [];

      // v4.3.2: 空文本超时保护——某些 AI（ChatGPT 生图等）readResponse 持续返回 "",
      // 旧逻辑 `text.length > 0` 永远不真 → polling 卡死。
      // 现在：空文本累计 EMPTY_TIMEOUT_TICKS 次（每 tick 1.5s）后放弃并标记"未提取到内容"
      // v4.3.3: 但如果有图还在加载（imagesPending>0），不算 empty timeout
      const EMPTY_TIMEOUT_TICKS = 30; // ~45 秒
      if (text === "" && !(r?.imagesPending > 0)) {
        state.emptyCount = (state.emptyCount || 0) + 1;
        if (state.emptyCount >= EMPTY_TIMEOUT_TICKS) {
          clearInterval(state.intervalId);
          pollers.delete(service);
          const fallbackText = "⚠ 未提取到内容，请点击气泡的 🔄 重新提取或 ⏭ 跳过本轮。";
          pushLog({
            role: "ai", msgId: state.msgId, participantId: service,
            text: fallbackText, ts: Date.now(), emptyTimeout: true,
          });
          sendToPopup({
            type: "chatStreamUpdate", role: "ai", msgId: state.msgId,
            participantId: service, text: fallbackText, isDone: true,
            emptyTimeout: true,
          });
          return;
        }
      } else {
        state.emptyCount = 0;
      }

      // v4.3.3: stableKey 把 imagesPending 计入稳定性判定
      // → 文本停止变化但图还在加载时，stableKey 仍会变 → 不算 stable
      const imagesPending = r?.imagesPending || 0;
      const stableKey = `${text}|imgPending:${imagesPending}`;
      if (stableKey === state.lastStableKey) {
        state.sameCount++;
        if (state.sameCount >= STREAM_DONE_THRESHOLD && text.length > 0) {
          // 完成
          clearInterval(state.intervalId);
          pollers.delete(service);
          pushLog({
            role: "ai", msgId: state.msgId, participantId: service,
            text, ts: Date.now(), hasRichContent: hasRich, richTypes,
          });
          sendToPopup({
            type: "chatStreamUpdate", role: "ai", msgId: state.msgId,
            participantId: service, text, isDone: true,
            hasRichContent: hasRich, richTypes,
          });
          if (typeof readOneResponse === "function") {
            readOneResponse(participant.id).catch(() => {});
          }
        }
      } else {
        state.lastStableKey = stableKey;
        state.lastText = text;
        state.sameCount = 0;
        sendToPopup({
          type: "chatStreamUpdate", role: "ai", msgId: state.msgId,
          participantId: service, text, isDone: false,
        });
      }
    } catch (e) {
      // tab 关闭或 content script 失联
      clearInterval(state.intervalId);
      pollers.delete(service);
      sendToPopup({
        type: "chatStreamUpdate", role: "ai", msgId: state.msgId,
        participantId: service, text: `⚠ ${participant.name} 已断开`,
        isDone: true,
      });
    }
  }

  function getLog() { return chatLog.slice(); }
  function clearLog() { chatLog.length = 0; chrome.storage.local.remove(STORAGE_KEYS.log); }
  async function jumpToOrigin(participantId) {
    const p = (StateMachine.participants || []).find(x => x.service === participantId);
    if (!p || !p.tabId) return { ok: false, error: "未找到参与者标签页" };
    try {
      const tab = await chrome.tabs.get(p.tabId);
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(p.tabId, { active: true });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // v4.3.0：跳过本轮某 AI — 停 polling，标记为"已跳过"，让"等全部完成"判定不卡住
  function skipParticipant(participantId, msgId) {
    const service = participantId;
    if (pollers.has(service)) {
      try { clearInterval(pollers.get(service).intervalId); } catch (_) {}
      pollers.delete(service);
    }
    // 通知 popup（保险：popup 主动改 UI 已经做过，这里是兜底广播）
    sendToPopup({
      type: "chatStreamUpdate", role: "ai",
      msgId: msgId || `skip_${Date.now()}`,
      participantId, text: "⏭ 已跳过本轮", isDone: true,
      skipped: true,
    });
    // 写入 log 让历史目录看得到
    pushLog({
      role: "ai", msgId: msgId || `skip_${Date.now()}`,
      participantId, text: "⏭ 已跳过本轮",
      ts: Date.now(), skipped: true,
    });
    return { ok: true };
  }

  async function reextractOne(participantId) {
    const p = (StateMachine.participants || []).find(x => x.service === participantId);
    if (!p || !p.tabId) return { ok: false, error: "未找到参与者" };
    try {
      const r = await chrome.tabs.sendMessage(p.tabId, { action: "readResponse" });
      const text = (r?.text || "").trim();
      const msgId = `manual_${Date.now()}`;
      sendToPopup({
        type: "chatStreamUpdate", role: "ai", msgId,
        participantId, text, isDone: true,
        hasRichContent: !!r?.hasRichContent, richTypes: r?.richTypes || [],
      });
      pushLog({
        role: "ai", msgId, participantId,
        text, ts: Date.now(),
        hasRichContent: !!r?.hasRichContent, richTypes: r?.richTypes || [],
      });
      return { ok: true, text };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // v4.3.0：把 popup 窗口拉回前端（添加 AI 窗口/排列窗口后调用，防止 popup 失焦）
  async function focusPopup() {
    if (popupWindowId == null) return { ok: false, error: "popup not open" };
    try {
      await chrome.windows.update(popupWindowId, { focused: true, drawAttention: false });
      return { ok: true };
    } catch (e) {
      popupWindowId = null;
      return { ok: false, error: e.message };
    }
  }

  return {
    init,
    openChatPopup,
    focusPopup,
    onWindowRemoved,
    rememberBounds,
    broadcast,
    notifyRoundStart,
    getLog,
    clearLog,
    jumpToOrigin,
    reextractOne,
    skipParticipant,
  };
})();

self.ChatBus = ChatBus;
