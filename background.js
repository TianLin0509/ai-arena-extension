// AI Arena — Background Service Worker v5.0 (精简版)

const SERVICES = {
  claude:   { url: "https://claude.ai/new",              name: "Claude" },
  gemini:   { url: "https://gemini.google.com/app",      name: "Gemini" },
  chatgpt:  { url: "https://chatgpt.com",                name: "ChatGPT" },
  deepseek: { url: "https://chat.deepseek.com",          name: "DeepSeek" },
  doubao:   { url: "https://www.doubao.com/chat",        name: "豆包" },
  qwen:     { url: "https://tongyi.aliyun.com/qianwen",  name: "通义千问" },
};

const PRESETS = {
  trio:     { name: "三巨头", services: ["claude", "gemini", "chatgpt"] },
  global:   { name: "中外对决", services: ["claude", "deepseek", "qwen"] },
  deep:     { name: "深度对抗", services: ["claude", "claude", "chatgpt"] },
  all:      { name: "全员集结", services: ["claude", "gemini", "chatgpt", "deepseek", "doubao", "qwen"] },
};

const DEBATE_STYLES = {
  free: { name: "自由辩论", prompt: "以下是其他 AI 对同一问题的回答，请分析他们的观点，指出你认同和不认同的地方，并给出你的改进回答。" },
  collab: { name: "群策群力", prompt: "以下是你的队友们对同一问题的回答。你们是协作关系，目标是共同得出最优方案。请：1) 吸收队友回答中的亮点和你没想到的角度；2) 补充你认为队友遗漏的重要内容；3) 整合所有人的优势，给出一个更完善的综合回答。不要攻击或否定队友，而是取长补短。" },
};

let participants = [];
let nextId = 1;
let debateSession = {
  originalQuestion: "",
  rounds: [],
  summaryText: "",
};

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// ── 右键菜单 ──
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "ai-arena-ask",
    title: "用 AI Arena 提问",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "ai-arena-ask" && info.selectionText) {
    chrome.runtime.sendMessage({ type: "contextMenuText", text: info.selectionText }).catch(() => {});
    if (tab?.windowId) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
});

// ── 消息处理 ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case "addParticipant":    addParticipant(msg.service).then(sendResponse); return true;
    case "removeParticipant": removeParticipant(msg.id).then(sendResponse); return true;
    case "loadPreset":        loadPreset(msg.presetId).then(sendResponse); return true;
    case "openAll":           handleOpenAll().then(sendResponse); return true;
    case "broadcast":         handleBroadcast(msg.text, msg.images).then(sendResponse); return true;
    case "debateRound":       handleDebateRound(msg.style, msg.guidance, msg.concise).then(sendResponse); return true;
    case "summary":           handleSummary(msg.judgeId, msg.customInstruction).then(sendResponse); return true;
    case "checkAllStreaming":  checkAllStreaming().then(sendResponse); return true;
    case "focusTab":          handleFocusTab(msg.id).then(sendResponse); return true;
    case "reconnect":         reconnectParticipant(msg.id).then(sendResponse); return true;
    case "readOneResponse":   readOneResponse(msg.participantId).then(sendResponse); return true;
    case "optimizePrompt":    handleOptimizePrompt(msg.text, msg.judgeId).then(sendResponse); return true;
    case "contextForkActive": handleContextForkActive().then(sendResponse); return true;
    case "exportSession":     sendResponse(exportSession()); return false;
    case "resetSession":      debateSession = { originalQuestion: "", rounds: [], summaryText: "" }; sendResponse({ ok: true }); return false;
    case "hardReset":         participants = []; nextId = 1; debateSession = { originalQuestion: "", rounds: [], summaryText: "" }; broadcastState(); sendResponse({ ok: true }); return false;
    case "getState":          sendResponse({ participants, debateSession }); return false;
  }
});

chrome.tabs.onRemoved.addListener((closedId) => {
  const p = participants.find(p => p.tabId === closedId);
  if (p) p.tabId = null;
});

// ── 参与者管理 ──

async function addParticipant(service) {
  const info = SERVICES[service];
  if (!info) return { ok: false };
  const count = participants.filter(p => p.service === service).length + 1;
  const id = `p${nextId++}`;
  const currentWindow = await chrome.windows.getCurrent();
  const tab = await chrome.tabs.create({ url: info.url, windowId: currentWindow.id, active: false });
  participants.push({ id, service, tabId: tab.id, name: `${info.name}-${count}` });
  notifyStatus(`已添加 ${info.name}-${count}`);
  broadcastState();
  return { ok: true, participants };
}

async function removeParticipant(id) {
  const idx = participants.findIndex(p => p.id === id);
  if (idx === -1) return { ok: false };
  const p = participants[idx];
  if (p.tabId) { try { await chrome.tabs.remove(p.tabId); } catch {} }
  participants.splice(idx, 1);
  notifyStatus(`已移除 ${p.name}`);
  broadcastState();
  return { ok: true, participants };
}

async function loadPreset(presetId) {
  const preset = PRESETS[presetId];
  if (!preset) return { ok: false };
  for (const p of [...participants]) {
    if (p.tabId) { try { await chrome.tabs.remove(p.tabId); } catch {} }
  }
  participants = [];
  for (const service of preset.services) await addParticipant(service);
  notifyStatus(`已加载预设「${preset.name}」`);
  await handleOpenAll();
  return { ok: true, participants };
}

// ── 打开全部（Tab 模式） ──

async function handleOpenAll() {
  if (participants.length === 0) { notifyStatus("请先添加参与者"); return { ok: false }; }
  const currentWindow = await chrome.windows.getCurrent();
  for (const p of participants) {
    if (p.tabId) { try { await chrome.tabs.get(p.tabId); continue; } catch { p.tabId = null; } }
    const tab = await chrome.tabs.create({ url: SERVICES[p.service].url, windowId: currentWindow.id, active: false });
    p.tabId = tab.id;
  }
  notifyStatus(`${participants.length} 个标签页已就绪`);
  broadcastState();
  return { ok: true, participants };
}

// ── 广播 ──

async function handleBroadcast(text, images) {
  debateSession.originalQuestion = text;
  debateSession.rounds = [];
  debateSession.summaryText = "";

  const results = {};
  await Promise.all(participants.map(async (p) => {
    if (!p.tabId) { results[p.id] = { name: p.name, status: "error", error: "未打开" }; return; }
    try {
      const ready = await waitForContentScript(p.tabId);
      if (!ready) { results[p.id] = { name: p.name, status: "error", error: "页面未就绪" }; return; }
      if (images && images.length > 0) {
        await chrome.tabs.sendMessage(p.tabId, { action: "injectImages", images });
        await new Promise(r => setTimeout(r, 800));
      }
      const result = await chrome.tabs.sendMessage(p.tabId, { action: "inject", text });
      results[p.id] = { name: p.name, ...result };
    } catch (e) { results[p.id] = { name: p.name, status: "error", error: e.message }; }
  }));
  notifyStatus("广播完成");
  broadcastState();
  return results;
}

// ── 辩论（默认自由辩论，锦标赛方式） ──

async function handleDebateRound(style = "free", guidance = "", concise = false) {
  if (participants.length < 2) { notifyStatus("至少需要 2 个参与者"); return { ok: false, error: "参与者不足" }; }
  const styleConfig = DEBATE_STYLES[style] || DEBATE_STYLES.free;
  const roundNum = debateSession.rounds.length + 1;

  notifyStatus(`第${roundNum}轮：正在读取回答...`);
  const responses = {};
  await Promise.all(participants.map(async (p) => {
    if (!p.tabId) return;
    try {
      const result = await sendMessageWithTimeout(p.tabId, { action: "readResponse" });
      if (result?.text) responses[p.id] = { name: p.name, text: result.text };
      else notifyStatus(`${p.name} 回答为空`);
    } catch (e) { notifyStatus(`读取 ${p.name} 失败: ${e.message}`); }
  }));

  if (Object.keys(responses).length < 2) { notifyStatus("至少需要 2 个有效回答"); return { ok: false, error: "回答不足" }; }

  debateSession.rounds.push({ roundNum, style, guidance, responses: Object.fromEntries(Object.entries(responses).map(([id, r]) => [id, { name: r.name, text: r.text }])) });

  // 构建轮次感知的 prompt
  const isCollab = style === "collab";
  const roundHints = isCollab ? {
    1: "这是第1轮协作。请仔细阅读队友们的回答，找出各自的亮点和你没想到的角度。",
    2: "这是第2轮协作。队友们已经互相补充了一轮，请在此基础上进一步整合，查漏补缺。",
    3: "这是第3轮协作。方案已趋于成熟，请做最终打磨——精简冗余，强化核心结论，形成一份完整方案。",
  } : {
    1: "这是第1轮辩论。请仔细阅读其他参与者的初始回答，找出核心分歧和共识。",
    2: "这是第2轮辩论。经过上一轮交锋，请聚焦于仍存在分歧的关键点，深化你的论证或修正你的观点。",
    3: "这是第3轮辩论。辩论已进入深水区，请避免重复已达成共识的内容，集中攻克剩余分歧点，给出最终立场。",
  };
  const defaultHint = isCollab
    ? `这是第${roundNum}轮协作。请只补充新的见解，不要重复已有内容。`
    : `这是第${roundNum}轮辩论。请只针对仍有分歧的核心问题发表精炼观点。`;
  const roundHint = roundHints[roundNum] || defaultHint;

  const conciseRule = concise
    ? "\n\n⚠️ 简洁模式：请控制回答在 1000 字以内，用要点列表呈现核心观点，避免长篇大论。每个论点简明扼要。"
    : "";

  notifyStatus(`第${roundNum}轮：以「${styleConfig.name}」风格交叉发送...`);
  await Promise.all(Object.keys(responses).map(async (id) => {
    const p = participants.find(p => p.id === id);
    if (!p?.tabId) return;
    const othersText = Object.entries(responses).filter(([oid]) => oid !== id).map(([, r]) => `【${r.name} 的回答】:\n${r.text}`).join("\n\n");
    let debatePrompt = `${roundHint}\n\n${styleConfig.prompt}\n\n${othersText}${conciseRule}`;
    if (guidance) debatePrompt = `用户补充要求：${guidance}\n\n${debatePrompt}`;
    try { await chrome.tabs.sendMessage(p.tabId, { action: "inject", text: debatePrompt }); }
    catch (e) { notifyStatus(`注入 ${p.name} 失败: ${e.message}`); }
  }));

  notifyStatus(`第${roundNum}轮辩论已发送`);
  broadcastState();
  return { ok: true, roundNum };
}

// ── 辩论总结 ──

async function handleSummary(judgeId, customInstruction = "") {
  if (participants.length < 2) { notifyStatus("至少需要 2 个参与者"); return { ok: false }; }
  const judge = participants.find(p => p.id === judgeId);
  if (!judge?.tabId) { notifyStatus("裁判未打开"); return { ok: false }; }

  notifyStatus("正在读取各参与者回答...");
  const responses = {};
  await Promise.all(participants.map(async (p) => {
    if (!p.tabId) return;
    try {
      const result = await chrome.tabs.sendMessage(p.tabId, { action: "readResponse" });
      if (result?.text) responses[p.id] = { name: p.name, text: result.text };
    } catch {}
  }));

  if (Object.keys(responses).length < 2) { notifyStatus("回答不足"); return { ok: false }; }

  let historySection = "";
  if (debateSession.rounds.length > 0) {
    historySection = "\n\n## 辩论历史摘要\n";
    for (const round of debateSession.rounds) {
      historySection += `\n### 第${round.roundNum}轮（${DEBATE_STYLES[round.style]?.name || round.style}）\n`;
      if (round.guidance) historySection += `用户引导：${round.guidance}\n`;
    }
    historySection += "\n（以上为辩论过程，以下为各方最终观点）\n";
  }

  const allText = Object.values(responses).map(r => `【${r.name} 的观点】:\n${r.text}`).join("\n\n");

  let summaryPrompt = `你是一场多 AI 辩论的最终裁判。${debateSession.originalQuestion ? `原始问题是：「${debateSession.originalQuestion}」\n` : ""}以下是各 AI 的讨论记录（经过 ${debateSession.rounds.length} 轮辩论）。
${historySection}
${allText}

请你作为裁判，给出结构化的最终总结：

## 共识结论
各方一致认同的核心观点

## 分歧焦点
仍存在争议的地方，列出各方立场

## 最终裁定
综合各方观点后，你认为最准确、最完整的结论是什么

## 实操建议
基于以上讨论，给出可落地的建议

## 标注规则
请对每个结论标注共识度：
- 🟢 全员共识：所有参与者都明确支持此观点
- 🟡 多数认同：多数参与者支持，少数持保留意见
- 🔴 存在争议：参与者之间有明确分歧，列出各方立场
- 💡 独家洞察：仅一方提出但有价值的独特视角

要求：客观公正，不偏袒任何一方，重点是综合各家之长得出最优答案。`;

  if (customInstruction.trim()) summaryPrompt += `\n\n## 额外要求\n${customInstruction.trim()}`;

  notifyStatus(`正在由 ${judge.name} 总结...`);
  try {
    await chrome.tabs.sendMessage(judge.tabId, { action: "inject", text: summaryPrompt });
    const tab = await chrome.tabs.get(judge.tabId);
    await chrome.tabs.update(judge.tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    notifyStatus(`总结已发送给 ${judge.name}`);
    return { ok: true };
  } catch (e) { notifyStatus(`总结失败: ${e.message}`); return { ok: false }; }
}

// ── 上下文提炼 ──

async function handleContextForkActive() {
  const SUPPORTED = [
    "claude.ai", "gemini.google.com", "chatgpt.com",
    "chat.deepseek.com", "www.doubao.com", "tongyi.aliyun.com"
  ];

  const allActive = await chrome.tabs.query({ active: true });
  let activeTab = allActive.find(t => SUPPORTED.some(s => (t.url || "").includes(s)));

  if (!activeTab) {
    const allTabs = await chrome.tabs.query({});
    activeTab = allTabs.find(t => SUPPORTED.some(s => (t.url || "").includes(s)));
  }

  if (!activeTab) return { ok: false, error: "未找到已打开的 AI 站点标签页（Claude/Gemini/ChatGPT/DeepSeek/豆包/千问）" };

  const siteName = SUPPORTED.find(s => (activeTab.url || "").includes(s));

  let turns = [];
  try {
    const r = await chrome.tabs.sendMessage(activeTab.id, { action: "readFullConversation" });
    turns = r?.turns || [];
  } catch (e) {
    return { ok: false, error: "读取对话失败，请确认页面已加载完成: " + e.message };
  }
  if (!turns.length) return { ok: false, error: "未读取到对话内容，请确认页面已有对话" };

  const MAX_AI_LEN = 800;
  let history = "";
  let roundCount = 0;
  for (const t of turns) {
    if (t.role === "user") {
      history += `【用户】: ${t.text}\n\n`;
      roundCount++;
    } else {
      const text = t.text.length > MAX_AI_LEN ? t.text.slice(0, MAX_AI_LEN) + "...（截断）" : t.text;
      history += `【AI】: ${text}\n\n`;
    }
  }

  const summarizePrompt = `请将以下对话历史压缩成一段简洁的"上下文接力摘要"，供我粘贴到新的对话窗口继续讨论。

要求：
1. 保留所有关键结论、决策、代码片段、专有名词
2. 去掉寒暄、重复、废话
3. 输出格式：先一句话说明"我们在讨论什么"，再用要点列出关键信息，最后一句"请在此基础上继续"
4. 总长度控制在 500 字以内
5. 只输出摘要本身，不要加任何解释

对话历史如下：

${history.trim()}`;

  notifyStatus("正在注入总结请求...");
  try {
    await chrome.tabs.sendMessage(activeTab.id, { action: "inject", text: summarizePrompt });
  } catch (e) {
    return { ok: false, error: "注入失败: " + e.message };
  }

  notifyStatus("等待 AI 生成摘要...");
  await new Promise(r => setTimeout(r, 3000));
  for (let i = 0; i < 60; i++) {
    try {
      const s = await chrome.tabs.sendMessage(activeTab.id, { action: "checkStreaming" });
      if (!s.streaming) break;
    } catch {}
    await new Promise(r => setTimeout(r, 1500));
  }
  await new Promise(r => setTimeout(r, 500));

  let summary = "";
  try {
    const r = await chrome.tabs.sendMessage(activeTab.id, { action: "readResponse" });
    summary = r?.text?.trim() || "";
  } catch (e) {
    return { ok: false, error: "读取摘要失败: " + e.message };
  }
  if (!summary) return { ok: false, error: "AI 未返回摘要内容" };

  return { ok: true, prompt: summary, turns: roundCount, site: siteName };
}

// ── Prompt 优化 ──

async function handleOptimizePrompt(text, judgeId) {
  const judge = participants.find(p => p.id === judgeId);
  if (!judge?.tabId) return { ok: false, error: "请选择优化器" };

  const optimizePrompt = `请优化以下 prompt，使其更清晰、更具体、更能引导出高质量回答。只输出优化后的 prompt，不需要解释：

原始 prompt：
${text}`;

  try {
    await chrome.tabs.sendMessage(judge.tabId, { action: "inject", text: optimizePrompt });
    notifyStatus(`已发送 Prompt 优化请求给 ${judge.name}`);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ── 离线重连 ──

async function reconnectParticipant(id) {
  const p = participants.find(p => p.id === id);
  if (!p) return { ok: false };
  const info = SERVICES[p.service];
  if (!info) return { ok: false };
  const currentWindow = await chrome.windows.getCurrent();
  const tab = await chrome.tabs.create({ url: info.url, windowId: currentWindow.id, active: false });
  p.tabId = tab.id;
  notifyStatus(`已重连 ${p.name}`);
  broadcastState();
  return { ok: true };
}

// ── 读取单个回答 ──

async function readOneResponse(participantId) {
  const p = participants.find(p => p.id === participantId);
  if (!p?.tabId) return { ok: false, text: "" };
  try {
    const r = await chrome.tabs.sendMessage(p.tabId, { action: "readResponse" });
    return { ok: true, text: r?.text || "" };
  } catch (e) { return { ok: false, text: "", error: e.message }; }
}

// ── 导出 ──

function exportSession() {
  let md = `# AI Arena 辩论记录\n\n`;
  md += `**时间**: ${new Date().toLocaleString("zh-CN")}\n`;
  md += `**参与者**: ${participants.map(p => p.name).join(", ")}\n\n`;

  if (debateSession.originalQuestion) {
    md += `## 原始问题\n\n${debateSession.originalQuestion}\n\n`;
  }

  for (const round of debateSession.rounds) {
    const styleName = DEBATE_STYLES[round.style]?.name || round.style;
    md += `## 第${round.roundNum}轮 (${styleName})\n\n`;
    if (round.guidance) md += `> 用户引导：${round.guidance}\n\n`;
    for (const [pId, data] of Object.entries(round.responses)) {
      const name = (typeof data === "object" && data.name) ? data.name : (participants.find(p => p.id === pId)?.name || pId);
      const text = (typeof data === "object") ? data.text : data;
      md += `### ${name}\n\n${text}\n\n`;
    }
    md += `---\n\n`;
  }

  return { ok: true, markdown: md };
}

// ── Tab 切换 ──

async function handleFocusTab(id) {
  const p = participants.find(p => p.id === id);
  if (!p?.tabId) return { ok: false };
  try {
    const tab = await chrome.tabs.get(p.tabId);
    await chrome.tabs.update(p.tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return { ok: true };
  } catch { p.tabId = null; return { ok: false }; }
}

// ── 流式状态 ──

async function checkAllStreaming() {
  const statuses = {};
  await Promise.all(participants.map(async (p) => {
    if (!p.tabId) { statuses[p.id] = { name: p.name, status: "offline" }; return; }
    try {
      const r = await chrome.tabs.sendMessage(p.tabId, { action: "checkStreaming" });
      statuses[p.id] = { name: p.name, status: r.streaming ? "streaming" : "ready" };
    } catch { statuses[p.id] = { name: p.name, status: "offline" }; }
  }));
  return statuses;
}

// ── 工具函数 ──

async function waitForContentScript(tabId, maxRetries = 12) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await chrome.tabs.sendMessage(tabId, { action: "ping" });
      return true;
    } catch (e) {
      // 标签页已关闭，无需重试
      if (e.message && (e.message.includes("No tab") || e.message.includes("removed"))) return false;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return false;
}

// 带超时的 sendMessage 包装
async function sendMessageWithTimeout(tabId, msg, timeoutMs = 90000) {
  return Promise.race([
    chrome.tabs.sendMessage(tabId, msg),
    new Promise((_, reject) => setTimeout(() => reject(new Error("消息超时")), timeoutMs))
  ]);
}

function notifyStatus(message) { chrome.runtime.sendMessage({ type: "status", message }).catch(() => {}); }
function broadcastState() { chrome.runtime.sendMessage({ type: "stateUpdate", participants, debateSession }).catch(() => {}); }
