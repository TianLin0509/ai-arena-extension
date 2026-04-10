// AI Arena — Background Service Worker v6.0 (状态机驱动)
importScripts("selectors-config.js", "selector-manager.js", "state-machine.js", "debate-engine.js");

const SERVICES = {
  claude:   { url: "https://claude.ai/new",              name: "Claude" },
  gemini:   { url: "https://gemini.google.com/app",      name: "Gemini" },
  chatgpt:  { url: "https://chatgpt.com",                name: "ChatGPT" },
  deepseek: { url: "https://chat.deepseek.com",          name: "DeepSeek" },
  doubao:   { url: "https://www.doubao.com/chat",        name: "豆包" },
  qwen:     { url: "https://tongyi.aliyun.com/qianwen",  name: "通义千问" },
};

const MAX_PARTICIPANTS = 3;

// ── 初始化 ──
const initPromise = Promise.all([StateMachine.init(), SelectorManager.init()]);

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

// ── 激活标签页以触发后台标签页 DOM 渲染 ──
// AI 平台在后台标签页暂停渲染，需要短暂激活来刷新 DOM
async function activateTabsBriefly() {
  const tabs = StateMachine.participants.filter(p => p.tabId).map(p => p.tabId);
  if (tabs.length === 0) return;
  const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  for (const tabId of tabs) {
    try { await chrome.tabs.update(tabId, { active: true }); } catch {}
    await new Promise(r => setTimeout(r, 30));
  }
  if (currentTab?.id) {
    try { await chrome.tabs.update(currentTab.id, { active: true }); } catch {}
  }
}

// ── 标签页关闭 → 直接移除参与者 ──
chrome.tabs.onRemoved.addListener((closedId) => {
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
        case "activateTabs":      activateTabsBriefly().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false })); break;
        case "focusTab":          sendResponse(await handleFocusTab(msg.id)); break;
        case "readOneResponse":   sendResponse(await readOneResponse(msg.participantId)); break;
        case "exportSession":     sendResponse(exportSession()); break;
        case "getState":          sendResponse(StateMachine.getFullState()); break;
        case "getSelectors":      sendResponse(SelectorManager.getAllForPlatform(msg.platform)); break;
        case "selectorFailure":   SelectorManager.reportFailure(msg.platform, msg.action); sendResponse({ ok: true }); break;

        // ── 半自动门控操作 ──
        case "retryInject":
          sendResponse(await retryInjectParticipant(msg.id));
          break;
        case "manualPaste":
          StateMachine.setParticipantManualResponse(msg.id, msg.text);
          sendResponse({ ok: true });
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
  const currentWindow = await chrome.windows.getCurrent();
  const tab = await chrome.tabs.create({ url: info.url, windowId: currentWindow.id, active: false });
  StateMachine.addParticipant(id, service, tab.id, `${info.name}-${count}`);
  notifyStatus(`已添加 ${info.name}-${count}`);
  StateMachine._broadcastStateUpdate();
  return { ok: true, participants: StateMachine.getFullState().participants };
}

async function removeParticipant(id) {
  const p = StateMachine.getParticipant(id);
  if (!p) return { ok: false };
  if (p.tabId) { try { await chrome.tabs.remove(p.tabId); } catch {} }
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
    p.manualResponse = null;
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
      p.manualResponse = null;
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

  return { ok: true, roundNum };
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

// ── 工具函数 ──

async function waitForContentScript(tabId, maxRetries = 12) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await chrome.tabs.sendMessage(tabId, { action: "ping" });
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
