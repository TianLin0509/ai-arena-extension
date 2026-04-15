// AI Arena — Background Service Worker v1.0.0
importScripts("selectors-config.js", "state-machine.js", "debate-engine.js");

const SERVICES = {
  claude:   { url: "https://claude.ai/new",              name: "Claude" },
  gemini:   { url: "https://gemini.google.com/app",      name: "Gemini" },
  chatgpt:  { url: "https://chatgpt.com",                name: "ChatGPT" },
  deepseek: { url: "https://chat.deepseek.com",          name: "DeepSeek" },
  doubao:   { url: "https://www.doubao.com/chat",        name: "豆包" },
  qwen:     { url: "https://tongyi.aliyun.com/qianwen",  name: "通义千问" },
};

const MAX_PARTICIPANTS = 3;
const _removingTabs = new Set();
let windowMode = "tab"; // "tab" | "tiled"

// ── 初始化 ──
const initPromise = StateMachine.init();

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// ── 右键菜单 ──
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "ai-arena-ask", title: "用 AI Arena 提问", contexts: ["selection"] });
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "ai-arena-ask" && info.selectionText) {
    chrome.runtime.sendMessage({ type: "contextMenuText", text: info.selectionText }).catch(() => {});
    if (tab?.windowId) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
});

// ── 强制后台标签页保持"可见"──
// DNR 已剥离 CSP，chrome.scripting.executeScript 可以注入 MAIN world
async function injectVisibilityOverride(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        if (document._arenaVisibilityPatched) return;
        document._arenaVisibilityPatched = true;
        Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
        Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
        document.addEventListener('visibilitychange', e => e.stopImmediatePropagation(), true);
      }
    });
  } catch {}
}

// 页面导航后重新注入
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    const p = StateMachine.participants.find(p => p.tabId === tabId);
    if (p) injectVisibilityOverride(tabId);
  }
});

// ── 标签页关闭 → 直接移除参与者 ──
chrome.tabs.onRemoved.addListener((closedId) => {
  if (_removingTabs.delete(closedId)) return; // We initiated this removal
  const p = StateMachine.participants.find(p => p.tabId === closedId);
  if (p) {
    StateMachine.removeParticipant(p.id);
    notifyStatus(`${p.name} 标签页已关闭，已移除`);
    StateMachine._broadcastStateUpdate();
  }
});

// ── 消息处理 ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  initPromise.then(async () => {
    try {
      switch (msg.type) {
        case "addParticipant":    sendResponse(await addParticipant(msg.service)); break;
        case "removeParticipant": sendResponse(await removeParticipant(msg.id)); break;
        case "broadcast":         sendResponse(await handleBroadcast(msg.text, msg.images)); break;
        case "debateRound":       sendResponse(await handleDebateRound(msg.style, msg.guidance, msg.concise)); break;
        case "summary":           sendResponse(await handleSummary(msg.judgeId, msg.customInstruction)); break;
        case "checkAllCompletion": sendResponse(await checkAllCompletion()); break;
        case "focusTab":          sendResponse(await handleFocusTab(msg.id)); break;
        case "readOneResponse":   sendResponse(await readOneResponse(msg.participantId)); break;
        case "exportSession":     sendResponse(exportSession()); break;
        case "getState":          sendResponse(StateMachine.getFullState()); break;
        case "getSelectors":      sendResponse(DEFAULT_SELECTORS[msg.platform] || {}); break;
        case "setWindowMode":     windowMode = msg.mode; sendResponse({ ok: true }); break;
        case "arrangeWindows":    sendResponse(await arrangeWindows()); break;

        // ── 手动操作 ──
        case "sendToOne":
          sendResponse(await sendToOneParticipant(msg.participantId));
          break;
        case "retryInject":
          sendResponse(await retryInjectParticipant(msg.id));
          break;
        case "resetSession":
          StateMachine.resetSession();
          notifyStatus("会话已重置");
          sendResponse({ ok: true });
          break;
        case "hardReset":
          StateMachine.hardReset();
          notifyStatus("已彻底重置");
          sendResponse({ ok: true });
          break;

        default: sendResponse({ ok: false, error: "Unknown message type" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  });
  return true;
});

// ── 参与者管理 ──

async function addParticipant(service) {
  if (StateMachine.participants.length >= MAX_PARTICIPANTS) {
    notifyStatus(`最多 ${MAX_PARTICIPANTS} 个参与者`);
    return { ok: false, error: `最多 ${MAX_PARTICIPANTS} 个参与者` };
  }
  const info = SERVICES[service];
  if (!info) return { ok: false };
  const count = StateMachine.participants.filter(p => p.service === service).length + 1;
  const id = `p${StateMachine.nextId++}`;

  let tabId;
  if (windowMode === "tiled") {
    // 并列模式：每个 AI 开独立窗口
    const win = await chrome.windows.create({ url: info.url, state: "normal", focused: false });
    tabId = win.tabs[0].id;
  } else {
    // Tab 模式：同一窗口的不同标签页
    const currentWindow = await chrome.windows.getCurrent();
    const tab = await chrome.tabs.create({ url: info.url, windowId: currentWindow.id, active: false });
    tabId = tab.id;
  }

  StateMachine.addParticipant(id, service, tabId, `${info.name}-${count}`);
  notifyStatus(`已添加 ${info.name}-${count}`);
  StateMachine._broadcastStateUpdate();

  // 并列模式下自动排列窗口
  if (windowMode === "tiled") {
    // 等页面稍微加载后再排列
    setTimeout(() => arrangeWindows().catch(() => {}), 500);
  }

  return { ok: true, participants: StateMachine.getFullState().participants };
}

async function removeParticipant(id) {
  const p = StateMachine.getParticipant(id);
  if (!p) return { ok: false };
  if (p.tabId) { _removingTabs.add(p.tabId); try { await chrome.tabs.remove(p.tabId); } catch {} }
  StateMachine.removeParticipant(id);
  notifyStatus(`已移除 ${p.name}`);
  StateMachine._broadcastStateUpdate();
  return { ok: true, participants: StateMachine.getFullState().participants };
}

// ── 广播（状态机驱动） ──

async function handleBroadcast(text, images) {
  nextMarkerRound(); // 递增标记轮次，防止跨轮污染
  StateMachine.debateSession.originalQuestion = text;
  StateMachine.debateSession.rounds = [];
  StateMachine.debateSession.summaryText = "";
  StateMachine.setFlowState(FlowState.BROADCASTING);

  StateMachine.participants.forEach(p => {
    p.response = null;
    p.responsePreview = null;
  });
  StateMachine.save();
  StateMachine._broadcastStateUpdate();

  const results = {};
  await Promise.all(StateMachine.participants.map(async (p) => {
    if (!p.tabId) {
      results[p.id] = { name: p.name, status: "error", error: "未打开" };
      return;
    }
    try {
      const ready = await waitForContentScript(p.tabId);
      if (!ready) {
        results[p.id] = { name: p.name, status: "error", error: "页面未就绪" };
        return;
      }
      if (images && images.length > 0) {
        await chrome.tabs.sendMessage(p.tabId, { action: "injectImages", images });
      }
      const result = await chrome.tabs.sendMessage(p.tabId, { action: "inject", text: text + buildMarkerInstruction() });
      results[p.id] = { name: p.name, ...result };
    } catch (e) {
      results[p.id] = { name: p.name, status: "error", error: e.message };
    }
  }));

  StateMachine.save();
  StateMachine._broadcastStateUpdate();

  const allOk = Object.values(results).every(r => r.status === "sent" || r.status === "inputted");
  if (allOk) {
    StateMachine.setFlowState(FlowState.AWAITING_RESPONSES);
    notifyStatus("广播完成，等待回复...");
    // 唤醒所有 AI 标签页，确保后台标签页恢复 DOM 渲染
  } else {
    notifyStatus("部分发送失败，请处理后继续");
  }

  return results;
}

async function retryInjectParticipant(id) {
  const p = StateMachine.getParticipant(id);
  if (!p || !p.tabId) return { ok: false, error: "参与者无效" };
  try {
    const ready = await waitForContentScript(p.tabId);
    if (!ready) {
      return { ok: false, error: "页面未就绪" };
    }
    const text = StateMachine.debateSession.originalQuestion;
    const result = await chrome.tabs.sendMessage(p.tabId, { action: "inject", text: text + buildMarkerInstruction() });
    const success = result.status !== "error";
    return { ok: success, result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── 手动发送给单个参与者（根据当前阶段自动构建 prompt） ──
async function sendToOneParticipant(participantId) {
  const p = StateMachine.getParticipant(participantId);
  if (!p?.tabId) return { ok: false, error: "参与者无效" };

  try {
    const ready = await waitForContentScript(p.tabId);
    if (!ready) return { ok: false, error: "页面未就绪" };

    let text;
    const rounds = StateMachine.debateSession.rounds;
    if (rounds.length === 0) {
      // 初始广播阶段：发原始问题
      text = (StateMachine.debateSession.originalQuestion || "") + buildMarkerInstruction();
    } else {
      // 辩论阶段：构建该参与者的辩论 prompt
      const lastRound = rounds[rounds.length - 1];
      const responses = lastRound.responses || {};
      text = DebateEngine.buildDebatePrompt(
        participantId, responses, lastRound.style || "free",
        lastRound.roundNum, lastRound.guidance || "", false
      );
    }

    if (!text) return { ok: false, error: "无可发送内容" };
    const result = await chrome.tabs.sendMessage(p.tabId, { action: "inject", text });
    return { ok: result.status !== "error", result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── 辩论（状态机驱动） ──

async function handleDebateRound(style = "free", guidance = "", concise = false) {
  nextMarkerRound(); // 递增标记轮次
  if (StateMachine.participants.length < 2) {
    notifyStatus("至少需要 2 个参与者");
    return { ok: false, error: "参与者不足" };
  }

  const responses = {};
  for (const p of StateMachine.participants) {
    if (p.response) {
      responses[p.id] = { name: p.name, text: p.response };
    }
  }

  if (Object.keys(responses).length < 2) {
    notifyStatus("至少需要 2 个有效回答");
    return { ok: false, error: "回答不足" };
  }

  const roundNum = StateMachine.debateSession.rounds.length + 1;
  StateMachine.debateSession.rounds.push({
    roundNum, style, guidance,
    responses: Object.fromEntries(Object.entries(responses).map(([id, r]) => [id, { name: r.name, text: r.text }]))
  });

  StateMachine.participants.forEach(p => {
    if (responses[p.id]) {
      p.response = null;
      p.responsePreview = null;
    }
  });
  StateMachine.setFlowState(FlowState.BROADCASTING);
  notifyStatus(`第${roundNum}轮：以「${DEBATE_STYLES[style]?.name || style}」风格交叉发送...`);

  await Promise.all(Object.keys(responses).map(async (id) => {
    const p = StateMachine.getParticipant(id);
    if (!p?.tabId) return;
    const prompt = DebateEngine.buildDebatePrompt(id, responses, style, roundNum, guidance, concise);
    try {
      await chrome.tabs.sendMessage(p.tabId, { action: "inject", text: prompt });
    } catch (e) {
      notifyStatus(`注入 ${p.name} 失败: ${e.message}`);
    }
  }));

  StateMachine.save();
  StateMachine.setFlowState(FlowState.AWAITING_RESPONSES);
  notifyStatus(`第${roundNum}轮辩论已发送`);

  return { ok: true, roundNum, activeIds: Object.keys(responses) };
}

// ── 辩论总结 ──

async function handleSummary(judgeId, customInstruction = "") {
  nextMarkerRound();
  if (StateMachine.participants.length < 2) { notifyStatus("至少需要 2 个参与者"); return { ok: false }; }
  const judge = StateMachine.getParticipant(judgeId);
  if (!judge?.tabId) { notifyStatus("裁判未打开"); return { ok: false }; }

  const responses = {};
  for (const p of StateMachine.participants) {
    if (p.response) {
      responses[p.id] = { name: p.name, text: p.response };
    }
  }
  if (Object.keys(responses).length < 2) { notifyStatus("回答不足"); return { ok: false }; }

  const prompt = DebateEngine.buildSummaryPrompt(
    StateMachine.debateSession.originalQuestion,
    StateMachine.debateSession.rounds,
    responses,
    customInstruction
  );

  StateMachine.setFlowState(FlowState.SUMMARY);
  notifyStatus(`正在由 ${judge.name} 总结...`);
  try {
    await chrome.tabs.sendMessage(judge.tabId, { action: "inject", text: prompt });
    const tab = await chrome.tabs.get(judge.tabId);
    await chrome.tabs.update(judge.tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    notifyStatus(`总结已发送给 ${judge.name}`);
    return { ok: true };
  } catch (e) { notifyStatus(`总结失败: ${e.message}`); return { ok: false }; }
}

// ── 标记驱动的完成检测 ──

async function checkAllCompletion() {
  const startMarker = currentStartMarker();
  const doneMarker = currentDoneMarker();
  const statuses = {};
  await Promise.all(StateMachine.participants.map(async (p) => {
    if (!p.tabId) { statuses[p.id] = { name: p.name, status: "offline", hasStart: false, hasDone: false, textLength: 0 }; return; }
    try {
      const r = await chrome.tabs.sendMessage(p.tabId, { action: "checkCompletion", startMarker, doneMarker });
      statuses[p.id] = { name: p.name, hasStart: r.hasStart || false, hasDone: r.hasDone || false, textLength: r.textLength || 0 };
    } catch { statuses[p.id] = { name: p.name, status: "offline", hasStart: false, hasDone: false, textLength: 0 }; }
  }));
  return statuses;
}

// ── 读取单个回答 ──

async function readOneResponse(participantId) {
  const p = StateMachine.getParticipant(participantId);
  if (!p?.tabId) return { ok: false, text: "" };
  try {
    const r = await sendMessageWithTimeout(p.tabId, { action: "readResponse" }, 30000);
    const text = r?.text || "";
    if (text) {
      StateMachine.setParticipantResponse(p.id, stripMarkers(text));
    }
    return { ok: true, text: stripMarkers(text) };
  } catch (e) {
    return { ok: false, text: "", error: e.message };
  }
}

// ── Tab 切换 ──

async function handleFocusTab(id) {
  const p = StateMachine.getParticipant(id);
  if (!p?.tabId) return { ok: false };
  try {
    const tab = await chrome.tabs.get(p.tabId);
    await chrome.tabs.update(p.tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return { ok: true };
  } catch { p.tabId = null; StateMachine.save(); return { ok: false }; }
}

// ── 导出 ──

function exportSession() {
  let md = `# AI Arena 辩论记录\n\n`;
  md += `**时间**: ${new Date().toLocaleString("zh-CN")}\n`;
  md += `**参与者**: ${StateMachine.participants.map(p => p.name).join(", ")}\n\n`;
  if (StateMachine.debateSession.originalQuestion) {
    md += `## 原始问题\n\n${StateMachine.debateSession.originalQuestion}\n\n`;
  }
  for (const round of StateMachine.debateSession.rounds) {
    const styleName = DEBATE_STYLES[round.style]?.name || round.style;
    md += `## 第${round.roundNum}轮 (${styleName})\n\n`;
    if (round.guidance) md += `> 用户引导：${round.guidance}\n\n`;
    for (const [pId, data] of Object.entries(round.responses)) {
      const name = data.name || (StateMachine.getParticipant(pId)?.name || pId);
      md += `### ${name}\n\n${data.text}\n\n`;
    }
    md += `---\n\n`;
  }
  return { ok: true, markdown: md };
}

// ── 并列模式：排列窗口 ──
async function arrangeWindows() {
  if (windowMode !== "tiled") return { ok: false, error: "非并列模式" };
  const parts = StateMachine.participants.filter(p => p.tabId);
  if (parts.length === 0) return { ok: false, error: "无参与者" };

  // 获取屏幕尺寸
  const displays = await chrome.system.display.getInfo();
  const primary = displays[0];
  const { width: screenW, height: screenH } = primary.workArea;

  // 反转顺序：第一个添加的参与者放最右边（带侧边栏）
  const ordered = [...parts].reverse();
  const n = ordered.length;
  const sidePanelWidth = 420;
  const availW = screenW - sidePanelWidth;
  const perW = Math.floor(availW / n);

  // 排列每个参与者窗口（依次 focused:true 确保拉到前台）
  for (let i = 0; i < n; i++) {
    const tab = await chrome.tabs.get(ordered[i].tabId).catch(() => null);
    if (!tab) continue;
    const winId = tab.windowId;
    const isLast = i === n - 1;
    await chrome.windows.update(winId, {
      left: primary.workArea.left + i * perW,
      top: primary.workArea.top,
      width: isLast ? perW + sidePanelWidth : perW,
      height: screenH,
      state: "normal",
      focused: true // 依次聚焦，确保每个窗口都在前台层
    });
  }

  // 最右侧窗口（第一个添加的参与者）打开侧边栏
  const lastTab = await chrome.tabs.get(ordered[n - 1].tabId).catch(() => null);
  if (lastTab) {
    await chrome.sidePanel.open({ windowId: lastTab.windowId }).catch(() => {});
  }

  return { ok: true };
}

// ── 工具函数 ──

async function waitForContentScript(tabId, maxRetries = 12) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await chrome.tabs.sendMessage(tabId, { action: "ping" });
      await injectVisibilityOverride(tabId);
      return true;
    } catch (e) {
      if (e.message && (e.message.includes("No tab") || e.message.includes("removed"))) return false;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return false;
}

async function sendMessageWithTimeout(tabId, msg, timeoutMs = 90000) {
  return Promise.race([
    chrome.tabs.sendMessage(tabId, msg),
    new Promise((_, reject) => setTimeout(() => reject(new Error("消息超时")), timeoutMs))
  ]);
}

function notifyStatus(message) { chrome.runtime.sendMessage({ type: "status", message }).catch(() => {}); }
