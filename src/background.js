// AI Arena — Background Service Worker v3.0.0

// 从 sidepanel 缓存的屏幕尺寸；双屏时用于判断 AI 窗口应放到哪块屏幕。
let lastKnownScreen = { width: 1920, height: 1080, left: 0, top: 0 };

importScripts("selectors-config.js", "state-machine.js", "debate-engine.js", "chat-bus.js");

const SERVICES = {
  claude:   { url: "https://claude.ai/new",              name: "Claude" },
  gemini:   { url: "https://gemini.google.com/app",      name: "Gemini" },
  chatgpt:  { url: "https://chatgpt.com",                name: "ChatGPT" },
  deepseek: { url: "https://chat.deepseek.com",          name: "DeepSeek" },
  doubao:   { url: "https://www.doubao.com/chat",        name: "豆包" },
  qwen:     { url: "https://www.qianwen.com",             name: "千问" },
  kimi:     { url: "https://www.kimi.com",               name: "Kimi" },
  yuanbao:  { url: "https://yuanbao.tencent.com/chat",   name: "元宝" },
  grok:     { url: "https://grok.com",                   name: "Grok" },
};

const MAX_PARTICIPANTS = 3;
const _removingTabs = new Set();
let windowMode = "tiled"; // "tab" | "tiled"
chrome.storage.local.get("windowMode", (d) => { if (d.windowMode) windowMode = d.windowMode; });

// ── 初始化 ──
const initPromise = Promise.all([StateMachine.init(), ChatBus.init()]);

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

// 页面导航后重新注入 + 自动重连
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;
  const p = StateMachine.getParticipantByTabId(tabId);
  if (!p) return;

  injectVisibilityOverride(tabId);

  setTimeout(async () => {
    try {
      await sendMessageWithTimeout(tabId, { action: "ping" }, 3000);
    } catch {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["inject-images.js", `content-${p.service}.js`]
        });
        notifyStatus(`${p.name} 已自动重连`);
      } catch (e) {
        console.warn(`[Arena] Auto-reconnect failed for ${p.name}:`, e.message);
      }
    }
  }, 2000);
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
chrome.windows.onRemoved.addListener((windowId) => {
  ChatBus.onWindowRemoved(windowId);
});
chrome.windows.onBoundsChanged?.addListener((win) => {
  ChatBus.rememberBounds(win.id);
});

// ── 消息处理 ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  initPromise.then(async () => {
    try {
      switch (msg.type) {
        case "addParticipant":
          if (msg.screen) lastKnownScreen = msg.screen;
          sendResponse(await addParticipant(msg.service)); break;
        case "removeParticipant": sendResponse(await removeParticipant(msg.id)); break;
        case "broadcast":         sendResponse(await handleBroadcast(msg.text, msg.images)); break;
        case "debateRound":       sendResponse(await handleDebateRound(msg.style, msg.guidance, msg.concise)); break;
        case "summary":           sendResponse(await handleSummary(msg.judgeId, msg.customInstruction)); break;
        case "checkAllCompletion": sendResponse(await checkAllCompletion()); break;
        case "focusTab":          sendResponse(await handleFocusTab(msg.id)); break;
        case "readOneResponse":   sendResponse(await readOneResponse(msg.participantId)); break;
        case "sendPromptToService": sendResponse(await sendPromptToService(msg.service || "chatgpt", msg.text || "")); break;
        case "exportSession":     sendResponse(exportSession()); break;
        case "getState":          sendResponse(StateMachine.getFullState()); break;
        case "getSelectors":      sendResponse(DEFAULT_SELECTORS[msg.platform] || {}); break;
        case "setWindowMode":     windowMode = msg.mode; chrome.storage.local.set({ windowMode: msg.mode }); sendResponse({ ok: true }); break;
        case "arrangeWindows":
          if (msg.screen) lastKnownScreen = msg.screen;
          sendResponse(await arrangeWindows(msg.screen || lastKnownScreen));
          break;
        case "openChatPopup":
          sendResponse(await ChatBus.openChatPopup()); break;
        case "chatBroadcast":
          sendResponse(await ChatBus.broadcast(msg.text, msg.targets || [], msg.images || [])); break;
        case "chatRestoreLog":
          sendResponse({ messages: ChatBus.getLog() }); break;
        case "chatClear":
          ChatBus.clearLog(); sendResponse({ ok: true }); break;
        case "chatJumpToOrigin":
          sendResponse(await ChatBus.jumpToOrigin(msg.participantId)); break;
        case "chatReextractOne":
          sendResponse(await ChatBus.reextractOne(msg.participantId)); break;

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
    const isFirst = StateMachine.participants.length === 0;
    const targetLayout = await getAiTargetLayout(lastKnownScreen);
    const win = await chrome.windows.create({
      url: info.url,
      state: "normal",
      focused: false,
      ...windowBoundsForCreate(targetLayout.screen)
    });
    tabId = win.tabs[0].id;
    // 双屏时 AI 窗口放到另一屏，sidepanel 保留在用户当前屏；单屏沿用旧体验。
    if (isFirst && !targetLayout.isDifferentDisplay) chrome.sidePanel.open({ windowId: win.id }).catch(() => {});
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
    // 记录"刚发给该 p 的 prompt"——readOneResponse 用此校验防把用户消息当成 AI 回复
    StateMachine.setLastSent(p.id, text);
    const tryInject = async () => {
      const ready = await waitForContentScript(p.tabId);
      if (!ready) return { name: p.name, status: "error", error: "页面未就绪" };
      if (images && images.length > 0) {
        await chrome.tabs.sendMessage(p.tabId, { action: "injectImages", images });
      }
      const result = await chrome.tabs.sendMessage(p.tabId, { action: "inject", text });
      return { name: p.name, ...result };
    };
    try {
      const r = await tryInject();
      if (r.status === "error") {
        await new Promise(ok => setTimeout(ok, 2000));
        results[p.id] = await tryInject();
      } else {
        results[p.id] = r;
      }
    } catch (e) {
      try {
        await new Promise(ok => setTimeout(ok, 2000));
        results[p.id] = await tryInject();
      } catch (e2) {
        results[p.id] = { name: p.name, status: "error", error: e2.message };
      }
    }
  }));

  StateMachine.save();
  StateMachine._broadcastStateUpdate();

  const allOk = Object.values(results).every(r => r.status === "sent" || r.status === "inputted");
  const anyOk = Object.values(results).some(r => r.status === "sent" || r.status === "inputted");
  if (allOk) {
    StateMachine.setFlowState(FlowState.AWAITING_RESPONSES);
    notifyStatus("广播完成，等待回复...");
    // 唤醒所有 AI 标签页，确保后台标签页恢复 DOM 渲染
  } else {
    StateMachine.setFlowState(anyOk ? FlowState.AWAITING_RESPONSES : FlowState.IDLE);
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
    const result = await chrome.tabs.sendMessage(p.tabId, { action: "inject", text });
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
      text = StateMachine.debateSession.originalQuestion || "";
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
    // 记录"刚发给该 p 的 prompt"——sanity check 用
    StateMachine.setLastSent(participantId, text);
    const result = await chrome.tabs.sendMessage(p.tabId, { action: "inject", text });
    return { ok: result.status !== "error", result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── 向指定服务单独发送任意 prompt（PPT 制作默认 ChatGPT） ──
async function sendPromptToService(service, text) {
  const prompt = (text || "").trim();
  if (!prompt) return { ok: false, error: "prompt 为空" };
  const p = StateMachine.participants.find(x => x.service === service);
  if (!p?.tabId) return { ok: false, error: `未找到已打开的 ${SERVICES[service]?.name || service} 参与者` };

  try {
    const ready = await waitForContentScript(p.tabId);
    if (!ready) return { ok: false, error: "页面未就绪" };

    p.response = null;
    p.responsePreview = null;
    StateMachine.setLastSent(p.id, prompt);
    StateMachine.setFlowState(FlowState.BROADCASTING);
    StateMachine.save();
    StateMachine._broadcastStateUpdate();

    const result = await chrome.tabs.sendMessage(p.tabId, { action: "inject", text: prompt });
    if (result.status === "error") return { ok: false, error: result.error || "注入失败" };

    StateMachine.setFlowState(FlowState.AWAITING_RESPONSES);
    notifyStatus(`已发送给 ${p.name}`);
    return { ok: true, participantId: p.id, name: p.name, result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── 辩论（状态机驱动） ──

async function handleDebateRound(style = "free", guidance = "", concise = false) {
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
  StateMachine.setFlowState(FlowState.BROADCASTING);
  notifyStatus(`第${roundNum}轮：以「${DEBATE_STYLES[style]?.name || style}」风格交叉发送...`);

  const sendResults = {};
  await Promise.all(Object.keys(responses).map(async (id) => {
    const p = StateMachine.getParticipant(id);
    if (!p?.tabId) return;
    const prompt = DebateEngine.buildDebatePrompt(id, responses, style, roundNum, guidance, concise);
    // 记录"刚发给该 p 的 prompt"——sanity check 用
    StateMachine.setLastSent(id, prompt);
    try {
      sendResults[id] = await chrome.tabs.sendMessage(p.tabId, { action: "inject", text: prompt });
    } catch (e) {
      await new Promise(ok => setTimeout(ok, 2000));
      try {
        sendResults[id] = await chrome.tabs.sendMessage(p.tabId, { action: "inject", text: prompt });
      } catch (e2) {
        sendResults[id] = { site: p.service, status: "error", error: e2.message };
        notifyStatus(`注入 ${p.name} 失败: ${e2.message}`);
      }
    }
  }));

  const sentIds = Object.entries(sendResults)
    .filter(([, r]) => r?.status === "sent" || r?.status === "inputted")
    .map(([id]) => id);

  if (sentIds.length >= 2) {
    StateMachine.debateSession.rounds.push({
      roundNum, style, guidance,
      responses: Object.fromEntries(Object.entries(responses).map(([id, r]) => [id, { name: r.name, text: r.text }]))
    });

    StateMachine.participants.forEach(p => {
      if (sentIds.includes(p.id)) {
        p.response = null;
        p.responsePreview = null;
      }
    });
  }

  StateMachine.save();
  StateMachine.setFlowState(sentIds.length > 0 ? FlowState.AWAITING_RESPONSES : FlowState.IDLE);
  if (sentIds.length < 2) {
    notifyStatus("辩论发送失败：有效接收方不足");
    return { ok: false, error: "有效接收方不足", roundNum, activeIds: sentIds, results: sendResults };
  }
  notifyStatus(`第${roundNum}轮辩论已发送`);

  // 同步 popup 群聊：显示用户气泡 + 启动 polling 给每个参与者
  try {
    const styleName = DEBATE_STYLES[style]?.name || style;
    const guidanceSuffix = guidance ? `：${guidance}` : "";
    const displayText = `⚔️ 第${roundNum}轮辩论·${styleName}${guidanceSuffix}`;
    const services = sentIds.map(id => StateMachine.getParticipant(id)?.service).filter(Boolean);
    ChatBus.notifyRoundStart(displayText, services);
  } catch (e) { console.warn("[chat-bus] notifyRoundStart failed:", e.message); }

  return { ok: true, roundNum, activeIds: sentIds, results: sendResults };
}

// ── 辩论总结 ──

async function handleSummary(judgeId, customInstruction = "") {
  if (StateMachine.participants.length < 2) { notifyStatus("至少需要 2 个参与者"); return { ok: false, error: "参与者不足" }; }
  const judge = StateMachine.getParticipant(judgeId);
  if (!judge?.tabId) { notifyStatus("裁判未打开"); return { ok: false, error: "裁判未打开" }; }

  const responses = {};
  for (const p of StateMachine.participants) {
    if (p.response) {
      responses[p.id] = { name: p.name, text: p.response };
    }
  }
  if (Object.keys(responses).length < 2) { notifyStatus("回答不足"); return { ok: false, error: "回答不足" }; }

  const prompt = DebateEngine.buildSummaryPrompt(
    StateMachine.debateSession.originalQuestion,
    StateMachine.debateSession.rounds,
    responses,
    customInstruction
  );

  StateMachine.setFlowState(FlowState.SUMMARY);
  notifyStatus(`正在由 ${judge.name} 总结...`);
  try {
    StateMachine.setLastSent(judge.id, prompt);
    const result = await chrome.tabs.sendMessage(judge.tabId, { action: "inject", text: prompt });
    if (result?.status === "error") {
      const error = result.error || "注入失败";
      notifyStatus(`总结失败: ${error}`);
      return { ok: false, error };
    }
    const tab = await chrome.tabs.get(judge.tabId);
    await chrome.tabs.update(judge.tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    notifyStatus(`总结已发送给 ${judge.name}`);
    // 同步 popup 群聊
    try {
      const displayText = `📋 裁判总结请求 → ${judge.name}${customInstruction ? '：' + customInstruction : ''}`;
      ChatBus.notifyRoundStart(displayText, [judge.service]);
    } catch (e) { console.warn("[chat-bus] notifyRoundStart failed:", e.message); }
    return { ok: true, result };
  } catch (e) { notifyStatus(`总结失败: ${e.message}`); return { ok: false, error: e.message }; }
}

// ── 无标记完成检测（文本稳定 + stop button 消失） ──

async function checkAllCompletion() {
  const statuses = {};
  await Promise.all(StateMachine.participants.map(async (p) => {
    if (!p.tabId) { statuses[p.id] = { name: p.name, status: "offline", textLength: 0, isStreaming: false }; return; }
    try {
      const r = await chrome.tabs.sendMessage(p.tabId, { action: "checkCompletion" });
      statuses[p.id] = { name: p.name, textLength: r.textLength || 0, isStreaming: !!r.isStreaming };
    } catch { statuses[p.id] = { name: p.name, status: "offline", textLength: 0, isStreaming: false }; }
  }));
  return statuses;
}

// ── 读取单个回答 ──

async function readOneResponse(participantId) {
  const p = StateMachine.getParticipant(participantId);
  if (!p?.tabId) return { ok: false, text: "" };
  try {
      const r = await sendMessageWithTimeout(p.tabId, { action: "readResponse" }, 30000);
      if (r?.error) {
        return { ok: false, text: "", error: r.error };
      }
      const text = r?.text || "";
      if (!text.trim()) {
        return { ok: false, text: "", error: "未读到有效回复" };
      }
      if (isInvalidAiResponse(text)) {
        return { ok: false, text: "", error: "读到平台错误或登录提示，不作为有效回复" };
      }
      if (text) {
      // sanity check：拒绝读到用户刚发的 prompt 或上轮残留
      const sent = StateMachine.lastSentByPid?.[participantId] || "";
      const prevResp = StateMachine.lastAcceptedByPid?.[participantId] || p.response || "";
      const head = (s) => (s || "").trim().slice(0, 100);
      if (sent && text === sent) {
        return { ok: false, text: "", error: "疑似读到用户消息（与 prompt 完全相同），请手动提取" };
      }
      if (sent && head(text).length >= 50 && head(text) === head(sent)) {
        return { ok: false, text: "", error: "疑似读到用户消息（前100字与 prompt 相同），请手动提取" };
      }
      if (prevResp && text === prevResp) {
        return { ok: false, text: "", error: "疑似读到上一轮残留回复，请等待新回复或手动提取" };
      }
      StateMachine.setParticipantResponse(p.id, text);
    }
    return { ok: true, text };
  } catch (e) {
    return { ok: false, text: "", error: e.message };
  }
}

function isInvalidAiResponse(text) {
  return /Something went wrong while generating the response|please contact us through our help center|感谢你试用 ChatGPT|登录或注册，以获取更智能的回复|需要登录|Sign in to continue/i.test(text || "");
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
  const initialResponses = StateMachine.participants.filter(p => p.response);
  if (initialResponses.length > 0) {
    md += `## 各 AI 回答\n\n`;
    for (const p of initialResponses) {
      md += `### ${p.name}\n\n${p.response}\n\n`;
    }
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
async function arrangeWindows(screen = lastKnownScreen) {
  if (windowMode !== "tiled") return { ok: false, error: "非并列模式" };
  const parts = StateMachine.participants.filter(p => p.tabId);
  if (parts.length === 0) return { ok: false, error: "无参与者" };

  const targetLayout = await getAiTargetLayout(screen);
  const targetScreen = targetLayout.screen;
  const screenW = targetScreen.width;
  const screenH = targetScreen.height;
  const screenLeft = targetScreen.left;
  const screenTop = targetScreen.top;

  // 反转顺序：第一个添加的参与者放最右边（带侧边栏）
  const ordered = [...parts].reverse();
  const n = ordered.length;
  // Win10/11 窗口有 ~7px 隐形边框（阴影），补偿后窗口视觉上无缝拼接
  const border = 7;
  const perW = Math.floor(screenW / n);

  for (let i = 0; i < n; i++) {
    const tab = await chrome.tabs.get(ordered[i].tabId).catch(() => null);
    if (!tab) continue;
    const winId = tab.windowId;
    const isLast = i === n - 1;
    const baseLeft = screenLeft + i * perW;
    const baseW = isLast ? screenW - i * perW : perW;
    await chrome.windows.update(winId, {
      left: baseLeft - border,
      top: screenTop,
      width: baseW + border * 2,
      height: screenH,
      state: "normal",
      focused: true
    });
  }

  // 最右侧窗口（第一个添加的参与者）打开侧边栏
  const lastTab = await chrome.tabs.get(ordered[n - 1].tabId).catch(() => null);
  if (lastTab && !targetLayout.isDifferentDisplay) {
    await chrome.sidePanel.open({ windowId: lastTab.windowId }).catch(() => {});
  }

  return { ok: true, screen: targetScreen, displayId: targetLayout.displayId, isDifferentDisplay: targetLayout.isDifferentDisplay };
}

async function getAiTargetLayout(sidepanelScreen = lastKnownScreen) {
  const fallback = normalizeScreen(sidepanelScreen);
  try {
    if (!chrome.system?.display?.getInfo) {
      return { screen: fallback, displayId: null, isDifferentDisplay: false };
    }
    const displays = await chrome.system.display.getInfo();
    const normalized = displays
      .map(d => ({ id: d.id, screen: normalizeScreen(d.workArea || d.bounds), isPrimary: !!d.isPrimary }))
      .filter(d => d.screen.width > 0 && d.screen.height > 0);

    // 找到 sidepanel 所在屏（current display）
    const current = findDisplayForScreen(fallback, normalized) || normalized.find(d => d.isPrimary) || normalized[0];
    const currentScreen = current?.screen || fallback;

    // 自动：副屏优先 + 不存在真副屏则回退同屏
    if (normalized.length < 2) {
      return { screen: currentScreen, displayId: current?.id || null, isDifferentDisplay: false };
    }

    // 检测"真副屏"：(1) 与 current 屏物理不重叠 AND (2) 该 display 上至少存在一个用户 chrome window
    // 条件 (2) 用于排除 Chrome 在 Windows 上偶尔报告的虚拟显示器（HDR/远程桌面/旧设备缓存）—
    // 这些 display 物理上不存在，自然没有任何窗口会落在其上。
    const allWindows = await chrome.windows.getAll().catch(() => []);
    function hasUserWindow(displayScreen) {
      return allWindows.some(w => {
        if (typeof w.left !== "number" || typeof w.width !== "number") return false;
        const cx = w.left + w.width / 2;
        const cy = w.top + w.height / 2;
        return cx >= displayScreen.left
          && cx < displayScreen.left + displayScreen.width
          && cy >= displayScreen.top
          && cy < displayScreen.top + displayScreen.height;
      });
    }

    const others = normalized.filter(d =>
      d.id !== current.id
      && !overlapsDisplay(d.screen, currentScreen)
      && hasUserWindow(d.screen)
    );
    if (others.length === 0) {
      // 没有"既不重叠 又有真实 window"的副屏 → 视为单屏环境，用当前屏
      return { screen: currentScreen, displayId: current?.id || null, isDifferentDisplay: false };
    }
    const currentCenter = centerOf(currentScreen);
    const target = others.sort((a, b) => distance(centerOf(a.screen), currentCenter) - distance(centerOf(b.screen), currentCenter))[0];
    return { screen: target.screen, displayId: target.id, isDifferentDisplay: true };
  } catch (e) {
    console.warn("[Arena] system.display unavailable, falling back to current screen:", e?.message || e);
    return { screen: fallback, displayId: null, isDifferentDisplay: false };
  }
}

// 判断两个 screen rect 是否物理重叠（用于过滤虚假副屏）
// 真副屏 = 完全不重叠（物理上水平/垂直分离）。任何重叠（哪怕 1 像素）都视为虚假副屏。
function overlapsDisplay(a, b) {
  const ax2 = a.left + a.width, ay2 = a.top + a.height;
  const bx2 = b.left + b.width, by2 = b.top + b.height;
  const overlapW = Math.max(0, Math.min(ax2, bx2) - Math.max(a.left, b.left));
  const overlapH = Math.max(0, Math.min(ay2, by2) - Math.max(a.top, b.top));
  return overlapW > 0 && overlapH > 0;
}

function normalizeScreen(screen = {}) {
  const width = Math.max(300, Math.round(screen.width || screen.availWidth || 1920));
  const height = Math.max(300, Math.round(screen.height || screen.availHeight || 1080));
  return {
    left: Math.round(screen.left ?? screen.availLeft ?? 0),
    top: Math.round(screen.top ?? screen.availTop ?? 0),
    width,
    height
  };
}

function windowBoundsForCreate(screen) {
  const s = normalizeScreen(screen);
  return {
    left: s.left,
    top: s.top,
    width: Math.max(500, Math.min(s.width, 1200)),
    height: Math.max(500, s.height)
  };
}

function findDisplayForScreen(screen, displays) {
  const point = centerOf(screen);
  const contains = displays.find(d => (
    point.x >= d.screen.left &&
    point.x < d.screen.left + d.screen.width &&
    point.y >= d.screen.top &&
    point.y < d.screen.top + d.screen.height
  ));
  if (contains) return contains;

  return displays
    .map(d => ({ display: d, overlap: overlapArea(screen, d.screen) }))
    .sort((a, b) => b.overlap - a.overlap)[0]?.display || null;
}

function centerOf(screen) {
  return { x: screen.left + screen.width / 2, y: screen.top + screen.height / 2 };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function overlapArea(a, b) {
  const left = Math.max(a.left, b.left);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const top = Math.max(a.top, b.top);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
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
