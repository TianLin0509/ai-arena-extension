// AI Arena — 群聊业务总线（背景脚本子模块）
// 由 background.js 通过 importScripts 加载，挂在 self.ChatBus

const ChatBus = (() => {
  // ── 状态 ──
  let popupWindowId = null;        // 当前 popup window id，null 表示未开
  let popupBounds = null;          // full 模式下的位置/尺寸（用户拖动后记忆）
  let popupMiniBounds = null;      // v4.8.15 F30: mini 模式下的位置/尺寸（独立记忆）
  let popupMode = "full";          // v4.8.15 F30: "full" | "mini"
  const chatLog = [];              // 最近 100 条消息
  const MAX_LOG = 100;
  const STORAGE_KEYS = {
    log: "chatLog",
    bounds: "chatPopupBounds",
    miniBounds: "chatPopupMiniBounds",  // F30
    mode: "popupMode",                  // F30
  };

  // ── 初始化：读 storage ──
  async function init() {
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.log, STORAGE_KEYS.bounds,
      STORAGE_KEYS.miniBounds, STORAGE_KEYS.mode,
    ]);
    if (Array.isArray(data[STORAGE_KEYS.log])) chatLog.push(...data[STORAGE_KEYS.log].slice(-MAX_LOG));
    // v4.8.37: sanity check — 清理 v4.8.36 之前 toggleMiniMode race 留下的污染数据
    //   popupBounds.height 应为 full 模式合理值；< 200 视为被 mini 大小（86）污染 → 丢弃
    //   popupMiniBounds.height > 150 已有 stale check（toggleMiniMode），此处 init 不再处理
    if (data[STORAGE_KEYS.bounds] && data[STORAGE_KEYS.bounds].height >= 200) {
      popupBounds = data[STORAGE_KEYS.bounds];
    } else if (data[STORAGE_KEYS.bounds]) {
      console.log("[chat-bus] v4.8.37 sanity: discard polluted popupBounds height=", data[STORAGE_KEYS.bounds].height);
      await chrome.storage.local.remove(STORAGE_KEYS.bounds).catch(() => {});
    }
    if (data[STORAGE_KEYS.miniBounds]) popupMiniBounds = data[STORAGE_KEYS.miniBounds];
    if (data[STORAGE_KEYS.mode] === "mini" || data[STORAGE_KEYS.mode] === "full") {
      popupMode = data[STORAGE_KEYS.mode];
    }
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
    // v4.8.33: 首次打开（无记忆 bounds）= 屏幕 80%×80% 居中，去掉 1100×720 封顶
    //          只影响 defaultBounds，用户拖动后仍走 popupBounds 记忆
    try {
      const displays = await chrome.system.display.getInfo();
      const primary = displays.find(d => d.isPrimary) || displays[0];
      const w = Math.round(primary.workArea.width * 0.8);
      const h = Math.round(primary.workArea.height * 0.8);
      return {
        left: primary.workArea.left + Math.round((primary.workArea.width - w) / 2),
        top: primary.workArea.top + Math.round((primary.workArea.height - h) / 2),
        width: w,
        height: h,
      };
    } catch {
      return { left: 100, top: 100, width: 1280, height: 800 };
    }
  }

  // v4.8.15 F30: mini 模式默认 bounds — 顶部居中，900x60
  async function defaultMiniBounds() {
    try {
      // 优先用 popup 当前所在屏，没有就主屏
      let display = null;
      if (popupWindowId != null) {
        try {
          const w = await chrome.windows.get(popupWindowId);
          const displays = await chrome.system.display.getInfo();
          display = displays.find(d =>
            w.left >= d.workArea.left && w.left < d.workArea.left + d.workArea.width
          ) || null;
        } catch {}
      }
      if (!display) {
        const displays = await chrome.system.display.getInfo();
        display = displays.find(d => d.isPrimary) || displays[0];
      }
      const width = Math.min(900, Math.round(display.workArea.width * 0.7));
      // v4.8.27: 60→78 / v4.8.30: 78→86（padding 16→24 + 控件底部不贴边 + AI logos）
      const height = 86;
      return {
        left: display.workArea.left + Math.round((display.workArea.width - width) / 2),
        top: display.workArea.top,
        width,
        height,
      };
    } catch {
      return { left: 200, top: 0, width: 900, height: 60 };
    }
  }

  // v4.8.15 F30: mini 模式 toggle — 由 popup-mini-mode.js 通过 miniModeToggle 消息触发
  // v4.8.37: 加 _modeSwitching flag 防 race —
  //   chrome.windows.update 触发的 onBoundsChanged 会异步调 rememberBounds，
  //   它读 popupMode 决定存哪个字段。如果切换中 popupMode 还是旧值，新 bounds
  //   会错存到旧 mode 字段（如 mini 大小 86 被记成 full bounds → 下次展开窗口变 86 高）。
  //   修复：切换期间 rememberBounds 跳过；切换结束 500ms 后才允许记录。
  let _modeSwitching = false;
  async function toggleMiniMode(mode) {
    const next = mode === "mini" ? "mini" : "full";
    if (popupWindowId == null) return { ok: false, error: "popup not open" };
    _modeSwitching = true;
    try {
      // 切换前先把当前模式的 bounds 记下来
      try {
        const w = await chrome.windows.get(popupWindowId);
        const curBounds = { left: w.left, top: w.top, width: w.width, height: w.height };
        if (popupMode === "full") {
          popupBounds = curBounds;
          await chrome.storage.local.set({ [STORAGE_KEYS.bounds]: popupBounds });
        } else {
          popupMiniBounds = curBounds;
          await chrome.storage.local.set({ [STORAGE_KEYS.miniBounds]: popupMiniBounds });
        }
      } catch {}
      // 切到目标 bounds
      let target;
      if (next === "mini") {
        // v4.8.27: 旧版 mini 默认高度 60，但实际经常被 Chrome 撑到 200+ 用户也未必拉低；
        //          新版 row flex 一行 78px 足够，若持久化的 height > 150 认为是脏数据，回退默认
        const stale = popupMiniBounds && popupMiniBounds.height > 150;
        target = (!stale && popupMiniBounds) || await defaultMiniBounds();
      } else {
        target = popupBounds || await defaultBounds();
      }
      try {
        await chrome.windows.update(popupWindowId, {
          state: "normal", focused: true,
          left: target.left, top: target.top,
          width: target.width, height: target.height,
        });
      } catch (e) {
        return { ok: false, error: e?.message || String(e) };
      }
      popupMode = next;
      await chrome.storage.local.set({ [STORAGE_KEYS.mode]: popupMode });
      // v4.8.19 F32: 已无 CDP attach，无需 detachAll
      return { ok: true, mode: popupMode, bounds: target };
    } finally {
      // v4.8.37: 延迟 500ms 释放，确保 chrome update 触发的 onBoundsChanged 已派发完毕
      setTimeout(() => { _modeSwitching = false; }, 500);
    }
  }

  function getPopupMode() { return popupMode; }

  // v4.8.31: mini 模式下 always-on-top — 监听其他窗口获焦时把 popup 拉回前台
  //   Chrome MV3 无原生 always-on-top API，只能用 windows.update({focused:true}) 模拟
  //   tradeoff: 会"瞬间抢焦点 → 浮到前台 → 立刻被用户实际操作窗口夺回"
  //   排除场景：用户主动 minimize popup → 尊重，不拉前
  let _refocusTimer = null;
  try {
    chrome.windows.onFocusChanged.addListener(async (newWinId) => {
      if (popupMode !== "mini") return;                              // 仅 mini 生效
      if (popupWindowId == null) return;
      if (newWinId === popupWindowId) return;                        // 自己获焦 → ignore
      if (newWinId === chrome.windows.WINDOW_ID_NONE) return;        // 失焦但无新窗口（桌面）

      // 检查 popup 状态：minimized → 用户主动收起，尊重；否则拉前
      try {
        const w = await chrome.windows.get(popupWindowId);
        if (w.state === "minimized") return;
      } catch { return; }

      // 防抖 250ms — 避免快速切换窗口时频繁抢焦点
      if (_refocusTimer) return;
      _refocusTimer = setTimeout(async () => {
        _refocusTimer = null;
        try {
          // 再次确认 popup 仍 normal（用户可能刚 minimize）
          const w2 = await chrome.windows.get(popupWindowId);
          if (w2.state === "minimized") return;
          await chrome.windows.update(popupWindowId, { focused: true });
        } catch {}
      }, 250);
    });
  } catch (_) {}

  // v4.8.28: mini 模式下 task-menu 打开时临时把窗口高度撑到 ~320 让菜单可见，关 menu 时还原
  // 注意：临时撑大期间不写 storage（保持 popupMiniBounds 是用户最终选定的 height）
  let _miniMenuPrevHeight = null;
  // v4.8.31: 删除 _miniSkippedServices 整套（v4.8.30 引入的 broadcast 过滤）
  //   原因：用户反馈"灰掉后消息仍发送"—— popup 端 broadcast 通常显式列 targets，过滤被绕过
  //   新方案：mini 头像点击 = removeParticipant（彻底退出 group），跟右栏 hero-slot ⋯→移除 共享逻辑
  async function miniMenuExpand(expand) {
    if (popupMode !== "mini" || popupWindowId == null) return { ok: false, error: "not in mini" };
    try {
      const w = await chrome.windows.get(popupWindowId);
      if (expand) {
        if (_miniMenuPrevHeight != null) return { ok: true, alreadyExpanded: true };
        _miniMenuPrevHeight = w.height;
        await chrome.windows.update(popupWindowId, {
          state: "normal",
          height: 340,                  // 撑高到容纳 task-menu（约 6-7 个 item × 32 + 子菜单空间）
        });
      } else {
        const restore = _miniMenuPrevHeight ?? 78;
        _miniMenuPrevHeight = null;
        await chrome.windows.update(popupWindowId, { state: "normal", height: restore });
      }
      return { ok: true };
    } catch (e) {
      _miniMenuPrevHeight = null;
      return { ok: false, error: e?.message || String(e) };
    }
  }

  function onWindowRemoved(windowId) {
    if (windowId === popupWindowId) popupWindowId = null;
  }

  // v4.8.15 F30: rememberBounds 按当前 mode 存到对应字段（不污染另一套）
  async function rememberBounds(windowId) {
    if (windowId !== popupWindowId) return;
    // v4.8.37: mode 切换期间跳过 — 防 chrome.windows.update 触发的 onBoundsChanged
    //   在 popupMode 还是旧值时记录新 bounds，导致 mini 大小被存到 full bounds（或反之）
    if (_modeSwitching) return;
    // v4.8.28: mini menu 撑高期间不写 mini bounds（撑高的 340 不是用户想要的）
    if (popupMode === "mini" && _miniMenuPrevHeight != null) return;
    try {
      const w = await chrome.windows.get(popupWindowId);
      const b = { left: w.left, top: w.top, width: w.width, height: w.height };
      if (popupMode === "mini") {
        popupMiniBounds = b;
        await chrome.storage.local.set({ [STORAGE_KEYS.miniBounds]: popupMiniBounds });
      } else {
        popupBounds = b;
        await chrome.storage.local.set({ [STORAGE_KEYS.bounds]: popupBounds });
      }
    } catch {}
  }

  // ── polling 调度器 ──
  // pollers: Map<participantId, { intervalId, lastText, sameCount, msgId }>
  const pollers = new Map();
  const POLL_INTERVAL_MS = 1500;
  const STREAM_DONE_THRESHOLD = 3;  // 连续 N 次相同视为完成
  // v4.5.5 F5: 全局 polling tick 上限，~5 分钟兜底防 imagesPending 抖动让 stableKey 永不稳定
  // 实测场景：mock readResponse 返回 text 不变但 imagesPending 0/1 抖动 → polling 跑 12s
  // 仍未完成，理论可无限跑。到达上限按当前文本强制 isDone:true 完成。
  const MAX_POLL_TICKS = 200;

  // v4.6.9 F19 / v4.6.10 调优: 兜底 watcher 机制 — polling 判完成后单 slot 监听最新一轮
  // 防 F18 streaming selector 失效 / AI 无 indicator / 完成后异步追加等场景
  // 发现 text 比 finalText 更长 → 用同 msgId 推 popup updateAIBubble 直接追加更新气泡
  // v4.6.10: 去掉 "15s 文本稳定 + non-streaming 提前停" 条件 — 用户反馈不需要省 CPU，
  // 让 watcher 跑满 60s 确保覆盖审核延迟 / 工具调用结果回传等晚到追加场景
  const watchers = new Map();  // service → { intervalId, msgId, lastText, startTs }
  const WATCH_INTERVAL_MS = 3000;
  const WATCH_MAX_DURATION_MS = 120000;  // 120s 总兜底（v4.6.11 从 60s 拉到 120s 覆盖更多审核延迟场景）
  const WATCH_MAX_SLOTS = 1;  // 只保留最新一轮防累积

  // v4.6.7 F17: 不再依赖 popupWindowId 做 silent return — MV3 SW 30s 空闲被回收时
  // ChatBus IIFE 销毁、popupWindowId 重建为 null，但 popup 窗口仍开着；
  // 老逻辑 `if (popupWindowId == null) return` 让 SW 重启后所有 chatStreamUpdate
  // 静默丢失 → popup 永远收不到消息。改为始终 broadcast，popup 开着自然收到。
  async function sendToPopup(payload) {
    try {
      await chrome.runtime.sendMessage(payload);
    } catch {}
  }

  // v4.6.7 F17: popup 启动时主动告知 SW 自己的 windowId
  // 让 focusPopup / openChatPopup 等依赖 popupWindowId 的功能在 SW 重启后仍可用
  function setPopupWindowId(id) {
    if (typeof id === "number" && id > 0) popupWindowId = id;
  }

  function newMsgId() {
    return `m${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  }

  function pushLog(entry) {
    chatLog.push(entry);
    while (chatLog.length > MAX_LOG) chatLog.shift();
    chrome.storage.local.set({ [STORAGE_KEYS.log]: chatLog }).catch(() => {});
  }

  // v4.8.36: 用户期望的 service 列表 → 实际可用列表 + 丢失列表
  //   targets 为空 → 默认全员，无丢失；
  //   targets 非空 → filter 后比较，丢失的 service 用于警告气泡（silent failure → fail loud）
  //   场景：移除 AI 后立刻发消息时 popup-roster.selected 尚未刷新；或 roster 选中了已离开的 service
  function _resolveTargetsWithSkipped(targets) {
    const allParticipants = StateMachine.participants || [];
    if (!targets?.length) {
      return { targetList: allParticipants, skippedServices: [] };
    }
    const availableServices = new Set(allParticipants.map(p => p.service));
    const targetList = allParticipants.filter(p => targets.includes(p.service));
    const skippedServices = targets.filter(s => !availableServices.has(s));
    return { targetList, skippedServices };
  }

  // v4.8.36: 9 个 AI 的展示名（用于警告气泡 — 该 service 已不在 StateMachine.participants）
  const SERVICE_DISPLAY_NAME = {
    claude: "Claude", gemini: "Gemini", chatgpt: "ChatGPT",
    deepseek: "DeepSeek", doubao: "豆包", qwen: "通义千问",
    kimi: "Kimi", yuanbao: "元宝", grok: "Grok",
  };

  function _emitSkippedWarning(msgId, skippedServices) {
    for (const svc of skippedServices) {
      const name = SERVICE_DISPLAY_NAME[svc] || svc;
      sendToPopup({
        type: "chatStreamUpdate", role: "ai", msgId,
        participantId: svc,
        text: `⚠ ${name} 已不在会话，本轮跳过 — 请检查参与者列表`,
        isDone: true,
        skipped: true,
      });
    }
  }

  async function broadcast(text, targets, images) {
    if (!text?.trim()) return { ok: false, error: "empty text" };

    // 决定目标参与者 + skipped 列表（v4.8.36 fail loud）
    const { targetList, skippedServices } = _resolveTargetsWithSkipped(targets);

    if (!targetList.length) {
      return { ok: false, error: "无可用参与者", skippedTargets: skippedServices };
    }

    // v4.5.4 F3: 同步 StateMachine — 否则 originalQuestion/p.response/lastSent/flowState 全是旧值，
    // popup "同时提问" 后立刻发起辩论会基于上一题的上下文，导致"回答不足"或上下文混乱
    try {
      if (StateMachine.debateSession) {
        StateMachine.debateSession.originalQuestion = text;
        StateMachine.debateSession.rounds = [];
        StateMachine.debateSession.summaryText = "";
      }
      targetList.forEach(p => {
        p.response = null;
        p.responsePreview = null;
        if (typeof StateMachine.setLastSent === "function") {
          StateMachine.setLastSent(p.id, text);
        }
      });
      if (typeof StateMachine.setFlowState === "function" && typeof FlowState !== "undefined") {
        StateMachine.setFlowState(FlowState.BROADCASTING);
      }
      StateMachine.save?.();
      StateMachine._broadcastStateUpdate?.();
    } catch (e) {
      console.warn("[chat-bus] broadcast SM sync fail:", e?.message);
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
    // v4.8.36: 对已离开的 service 创建警告气泡（fail loud）
    _emitSkippedWarning(msgId, skippedServices);
    return {
      ok: true, msgId,
      targets: targetList.map(p => p.service),
      skippedTargets: skippedServices,
    };
  }

  // 外部触发的轮次（辩论 / 总结 / 手动发送）：不再 inject（外部已 inject），只显示用户气泡+启动 polling
  // displayText = popup 用户气泡显示文本（如"⚔️ 第1轮辩论·自由"）
  // participantServices = 受影响的参与者 service id 列表（如 ["claude","gemini","chatgpt"]）
  // presetMsgId = v4.6.13 F20: 外部预生成 msgId（用于辩论 pending 占位 → 正式状态复用同气泡）
  function notifyRoundStart(displayText, participantServices, presetMsgId) {
    // v4.8.36: 复用 _resolveTargetsWithSkipped，对辩论/总结路径同样 fail loud
    const { targetList, skippedServices } = _resolveTargetsWithSkipped(participantServices);
    if (!targetList.length) return { ok: false, error: "无目标参与者", skippedTargets: skippedServices };

    const msgId = presetMsgId || newMsgId();
    pushLog({ role: "user", msgId, text: displayText, ts: Date.now() });
    sendToPopup({ type: "chatStreamUpdate", role: "user", msgId, text: displayText });

    for (const p of targetList) {
      sendToPopup({
        type: "chatStreamUpdate", role: "ai", msgId,
        participantId: p.service, text: "", isDone: false,
      });
      // 启动该 participant 的 polling（不 inject）
      if (pollers.has(p.service)) {
        const old = pollers.get(p.service);
        clearInterval(old.intervalId);
        releaseCDPFor(old, p.tabId);
      }
      // v4.5.6 F11: 记录上一轮已采纳回答 → pollOnce 拒绝残留
      const state = {
        lastText: "", sameCount: 0, msgId,
        prevAccepted: StateMachine.lastAcceptedByPid?.[p.id] || "",
        cdpAttached: false,
      };
      tryAttachCDPForPolling(state, p.tabId);
      state.intervalId = setInterval(() => pollOnce(p, state), POLL_INTERVAL_MS);
      pollers.set(p.service, state);
    }
    // v4.8.36: 对已离开的 service 创建警告气泡
    _emitSkippedWarning(msgId, skippedServices);
    return { ok: true, msgId, skippedTargets: skippedServices };
  }

  // v4.8.19 F32: 完全废弃 chrome.debugger 路线
  // bootstrap-main-world.js 在每个 AI tab 的 document_start 注入 visibility patch
  // SPA 永远以为自己在前台，DOM 树持续更新，content script 读取无障碍
  // 两个函数保留 no-op 以兼容 polling 里仍存在的调用位置
  function releaseCDPFor(_state, _tabId) { /* no-op (F32) */ }
  async function tryAttachCDPForPolling(_state, _tabId) { /* no-op (F32) */ }

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
    if (pollers.has(service)) {
      const old = pollers.get(service);
      clearInterval(old.intervalId);
      releaseCDPFor(old, tabId);
    }
    // v4.5.6 F11: 记录上一轮已采纳回答 → pollOnce 拒绝残留
    const state = {
      lastText: "", sameCount: 0, msgId,
      prevAccepted: StateMachine.lastAcceptedByPid?.[participant.id] || "",
      cdpAttached: false,
    };
    tryAttachCDPForPolling(state, tabId);
    state.intervalId = setInterval(() => pollOnce(participant, state), POLL_INTERVAL_MS);
    pollers.set(service, state);
  }

  async function pollOnce(participant, state) {
    const { tabId, service } = participant;
    try {
      // v4.5.5 F5: 全局 tick 上限兜底
      state.totalTicks = (state.totalTicks || 0) + 1;
      if (state.totalTicks >= MAX_POLL_TICKS) {
        clearInterval(state.intervalId);
        pollers.delete(service);
        releaseCDPFor(state, tabId);
        const finalText = state.lastText || "⚠ 超时 5 分钟未完成，已按当前内容强制结束";
        pushLog({
          role: "ai", msgId: state.msgId, participantId: service,
          text: finalText, ts: Date.now(), forcedTimeout: true,
        });
        sendToPopup({
          type: "chatStreamUpdate", role: "ai", msgId: state.msgId,
          participantId: service, text: finalText, isDone: true,
          forcedTimeout: true,
        });
        return;
      }

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
          releaseCDPFor(state, tabId);
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

      // v4.5.6 F11: 拒绝读到上一轮残留 — Kimi/Gemini 等 DOM 更新慢的平台，新对话发出后
      // 旧 assistant 气泡仍是 last DOM，前几 tick readResponse 抓到上一轮文本；老逻辑会
      // 连续 3 次相同→判完成→把残留推给 popup（截图证据：Kimi 第二轮气泡和第一轮一字不差）
      const prevAccepted = state.prevAccepted || "";
      const head100 = s => (s || "").trim().slice(0, 100);
      const isResidue = text && prevAccepted && (
        text === prevAccepted ||
        (head100(text).length >= 50 && head100(text) === head100(prevAccepted))
      );
      if (isResidue) {
        // 视为"新回答还没出现"，重置稳定计数但不算 empty（不超时）；
        // 也不 sendToPopup，避免气泡闪现旧内容
        state.lastStableKey = null;
        state.sameCount = 0;
        return;
      }

      // v4.3.3: stableKey 把 imagesPending 计入稳定性判定
      // → 文本停止变化但图还在加载时，stableKey 仍会变 → 不算 stable
      const imagesPending = r?.imagesPending || 0;
      const stableKey = `${text}|imgPending:${imagesPending}`;
      if (stableKey === state.lastStableKey) {
        state.sameCount++;
        // v4.6.8 F18: 完成判定加 !r.isStreaming — 让 polling 不再仅靠 4.5s 文本不变就判完成
        // 防 ChatGPT/Claude 等模型"输出第一段后停顿规划下一段"时被早判完成（截图证据：
        // 复杂技术问题 ChatGPT 输出 "我" 后停顿 4.5s → polling 误判 → 气泡卡在"我"）
        // streaming selector 失效时 isStreaming 退化为 false，行为同老版本，向后兼容
        if (state.sameCount >= STREAM_DONE_THRESHOLD && text.length > 0 && !r?.isStreaming) {
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
          // v4.8.10 F27-bugfix: 必须等 readOneResponse 写入 p.response 再 detach CDP
          // 之前立即 releaseCDPFor → readOneResponse 在 background throttle 下读到旧/空 DOM
          // → sanity check 拒绝 → setParticipantResponse 不被调 → p.response 仍为空
          // → handleDebateRound 检查 `if (p.response)` 全空 → 报"回答不足"
          // 截图证据：DeepSeek/千问 popup 显示"已完成"+ 文本（sendToPopup 路径），
          //          但 p.response 空（readOneResponse 失败），用户辩论时报错
          if (typeof readOneResponse === "function") {
            readOneResponse(participant.id)
              .catch(() => {})
              .finally(() => releaseCDPFor(state, tabId));
          } else {
            releaseCDPFor(state, tabId);
          }
          // v4.4.0: 如果当前 polling 完成的 AI 是 pendingSummary 的裁判，触发 finalize
          try {
            const ps = StateMachine.pendingSummary;
            if (ps && ps.judgeId === participant.id && text && typeof finalizeDebateSummary === "function") {
              StateMachine.setPendingSummary?.(null) ?? (StateMachine.pendingSummary = null);
              finalizeDebateSummary(text, ps).catch(e => console.warn("[chat-bus] finalize summary fail:", e?.message));
            }
          } catch (e) { console.warn("[chat-bus] pendingSummary check fail:", e?.message); }
          // v4.6.9 F19: 启动兜底 watcher 监听 60s，发现 text 追加用同 msgId 覆盖气泡
          // 防 F18 streaming selector 失效 / 完成后异步追加场景
          try { startWatch(participant, state.msgId, text); }
          catch (e) { console.warn("[chat-bus] startWatch fail:", e?.message); }
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
      releaseCDPFor(state, tabId);
      sendToPopup({
        type: "chatStreamUpdate", role: "ai", msgId: state.msgId,
        participantId: service, text: `⚠ ${participant.name} 已断开`,
        isDone: true,
      });
    }
  }

  function getLog() { return chatLog.slice(); }
  function clearLog() { chatLog.length = 0; chrome.storage.local.remove(STORAGE_KEYS.log); }

  // v4.6.6 F13: hardReset 时清所有 polling — 防旧 polling 下个 tick 调失效 tabId
  // 走 catch 分支推 "⚠ XX 已断开" 残留消息到 popup，造成"重置后不再同步"假象
  function clearAllPollers() {
    for (const [, state] of pollers) {
      try { clearInterval(state.intervalId); } catch (_) {}
    }
    pollers.clear();
    // v4.6.9 F19: 一并清 watchers 防失效 tabId 调用
    for (const [, state] of watchers) {
      try { clearInterval(state.intervalId); } catch (_) {}
    }
    watchers.clear();
    // v4.8.19 F32: 已无 CDP attach 需要 detach
  }

  // v4.6.9 F19: polling 判完成后启动兜底 watcher
  // 单 slot 限制：启动新 watch 时清掉旧 service 的 watcher 防累积
  function startWatch(participant, msgId, finalText) {
    const { service, tabId } = participant;
    // 单 slot：清掉所有现有 watchers
    if (watchers.size >= WATCH_MAX_SLOTS) {
      for (const [, st] of watchers) {
        try { clearInterval(st.intervalId); } catch (_) {}
      }
      watchers.clear();
    }
    const state = {
      msgId,
      lastText: finalText || "",
      startTs: Date.now(),
    };
    state.intervalId = setInterval(async () => {
      // 60s 总兜底（唯一停止条件 — v4.6.10 去掉了 15s 稳定提前停）
      if (Date.now() - state.startTs > WATCH_MAX_DURATION_MS) {
        clearInterval(state.intervalId);
        watchers.delete(service);
        return;
      }
      try {
        const r = await chrome.tabs.sendMessage(tabId, { action: "readResponse" });
        const text = (r?.text || "").trim();
        // 文本比上次长且非残留 → 追加更新（用同 msgId 让 popup updateAIBubble 直接覆盖气泡）
        if (text && text.length > state.lastText.length && text !== state.lastText) {
          state.lastText = text;
          sendToPopup({
            type: "chatStreamUpdate", role: "ai", msgId: state.msgId,
            participantId: service, text, isDone: true,
            hasRichContent: !!r?.hasRichContent, richTypes: r?.richTypes || [],
            watcherUpdate: true,
          });
          pushLog({
            role: "ai", msgId: state.msgId, participantId: service,
            text, ts: Date.now(), watcherUpdate: true,
          });
        }
        // v4.6.10: 文本不变也不停 watcher，继续跑满 60s 覆盖晚到追加
      } catch (_) {
        // tab 失效 / content script 失联 → 停 watcher
        clearInterval(state.intervalId);
        watchers.delete(service);
      }
    }, WATCH_INTERVAL_MS);
    watchers.set(service, state);
  }
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
      const state = pollers.get(service);
      try { clearInterval(state.intervalId); } catch (_) {}
      pollers.delete(service);
      // v4.8.9 F27: 跳过本轮也要 detach CDP
      const p = (StateMachine.participants || []).find(x => x.service === service);
      releaseCDPFor(state, p?.tabId);
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

  // v4.8.4 F24: 手动重新提取鲁棒化 — 复用 background.readOneResponse 的 5 道 sanity 保险
  // （v3.0 同款逻辑：超时保护 / 用户消息回显拒绝 / 上轮残留拒绝 / 平台错误识别 / 空文本告警）
  // + 5 次重试覆盖现代 SPA AI 网页 DOM 异步渲染（v3.0 当年单次足够，现在不够）
  // + 立刻推 loading 占位 (msgId 复用) 给用户瞬时反馈
  // + 失败时推明确错误气泡（不再静默推空气泡覆盖原内容）
  async function reextractOne(participantId) {
    // v4.3.13: participantId 既可能是 service 名（来自气泡 dataset），也可能是
    // participant.id（来自成员卡 ⋯ 菜单），两种都要支持
    const list = StateMachine.participants || [];
    const p = list.find(x => x.id === participantId)
           || list.find(x => x.service === participantId);
    if (!p || !p.tabId) return { ok: false, error: "未找到参与者" };

    const msgId = `manual_${Date.now()}`;
    // 立刻推 loading 占位（用同 msgId，成功 / 失败时覆盖更新）
    sendToPopup({
      type: "chatStreamUpdate", role: "ai", msgId,
      participantId: p.service, text: "🔄 正在重新提取…", isDone: false,
    });

    const MAX_RETRIES = 5;
    const RETRY_DELAY_MS = 1000;
    let lastError = "未读到内容";
    let succeeded = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        // 复用 background.readOneResponse — v3.0 同款 sanity check + setParticipantResponse
        const r = (typeof readOneResponse === "function")
          ? await readOneResponse(p.id)
          : { ok: false, error: "readOneResponse 不可用" };
        if (r?.ok && r?.text) { succeeded = r; break; }
        if (r?.error) lastError = r.error;
      } catch (e) {
        lastError = e?.message || lastError;
      }
      if (attempt < MAX_RETRIES - 1) {
        await new Promise(res => setTimeout(res, RETRY_DELAY_MS));
      }
    }

    if (succeeded) {
      // 成功后再读一次 chrome.tabs.sendMessage 拿富文本字段（readOneResponse 只返回 text）
      let richMeta = { hasRichContent: false, richTypes: [] };
      try {
        const r2 = await chrome.tabs.sendMessage(p.tabId, { action: "readResponse" });
        richMeta = { hasRichContent: !!r2?.hasRichContent, richTypes: r2?.richTypes || [] };
      } catch (_) {}
      sendToPopup({
        type: "chatStreamUpdate", role: "ai", msgId,
        participantId: p.service, text: succeeded.text, isDone: true,
        ...richMeta,
      });
      pushLog({
        role: "ai", msgId, participantId: p.service,
        text: succeeded.text, ts: Date.now(),
        ...richMeta,
      });
      try { StateMachine._broadcastStateUpdate?.(); } catch (_) {}
      return { ok: true, text: succeeded.text };
    }

    // 5 次都失败 → 推明确错误气泡告诉用户具体原因（不再静默推空气泡）
    sendToPopup({
      type: "chatStreamUpdate", role: "ai", msgId,
      participantId: p.service,
      text: `⚠ 重新提取失败：${lastError}\n\n请确认 ${p.name} 页面已出现 AI 回答，必要时刷新页面后再试。`,
      isDone: true,
    });
    return { ok: false, error: lastError };
  }

  // v4.3.0：把 popup 窗口拉回前端（添加 AI 窗口/排列窗口后调用，防止 popup 失焦）
  // v4.6.6 F15: drawAttention:true 强提示 — Chrome 88+ 收紧 SW 内 focused:true 政策
  // 没有强用户手势会被静默拒绝，drawAttention:true 至少让 taskbar 闪烁提示用户切回
  async function focusPopup() {
    if (popupWindowId == null) return { ok: false, error: "popup not open" };
    try {
      await chrome.windows.update(popupWindowId, { focused: true, drawAttention: true });
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
    clearAllPollers,
    setPopupWindowId,
    jumpToOrigin,
    reextractOne,
    skipParticipant,
    toggleMiniMode,  // v4.8.15 F30
    getPopupMode,    // v4.8.15 F30
    miniMenuExpand,  // v4.8.28
    // setMiniSkippedServices 在 v4.8.31 删除（mini 点击改 removeParticipant）
  };
})();

self.ChatBus = ChatBus;
