// AI Arena — Content Script for claude.ai
// v4.8.47: IIFE + globalThis guard 防御重复注入（reload 扩展 / ensureContentScriptInjected 多次触发时不撞 const SITE 重复声明）
(function() {
if (globalThis.__AI_ARENA_CS_LOADED_claude__) {
  console.log("[content-claude] already loaded, skip duplicate injection");
  return;
}
globalThis.__AI_ARENA_CS_LOADED_claude__ = true;

const SITE = "claude";

// 选择器配置（启动时从 background 获取）
let selectors = null;
chrome.runtime.sendMessage({ type: "getSelectors", platform: SITE }, (resp) => {
  if (resp) selectors = resp;
});

// v2.1.0: marker 已移除

const _reportedFailures = new Set();
// 按优先级尝试选择器数组，返回第一个匹配的元素
function queryBySelectors(action, options = {}) {
  const sels = selectors?.[action] || [];
  for (const sel of sels) {
    const el = options.all ? document.querySelectorAll(sel) : document.querySelector(sel);
    if (options.all ? el.length > 0 : el) return el;
  }
  const heuristic = getHeuristicElement(action, options);
  if (heuristic) return heuristic;
  if (!_reportedFailures.has(action)) { _reportedFailures.add(action); chrome.runtime.sendMessage({ type: "selectorFailure", platform: SITE, action }).catch(() => {}); }
  return options.all ? [] : null;
}

function getHeuristicElement(action, options = {}) {
  if (action === "input") {
    const editables = [...document.querySelectorAll('[contenteditable="true"], textarea')];
    if (editables.length > 0) {
      return editables.reduce((best, el) => {
        const rect = el.getBoundingClientRect();
        const bestRect = best.getBoundingClientRect();
        return (rect.width * rect.height > bestRect.width * bestRect.height) ? el : best;
      });
    }
    return null;
  }
  if (action === "response") {
    // v4.5.4 F1: 无用户消息 DOM → 不在对话页，放弃 heuristic 防误抓装饰元素
    if (typeof hasUserMessageInDom === "function" && !hasUserMessageInDom()) return options.all ? [] : null;
    const blocks = document.querySelectorAll('div, article, section');
    for (let i = blocks.length - 1; i >= 0; i--) {
      const text = blocks[i].innerText?.trim();
      if (text && text.length > 100 && blocks[i].getBoundingClientRect().height > 50) {
        return options.all ? [blocks[i]] : blocks[i];
      }
    }
    return options.all ? [] : null;
  }
  if (action === "sendButton") {
    const btns = [...document.querySelectorAll("button")];
    return btns.filter(b => b.getBoundingClientRect().bottom > window.innerHeight - 150 && b.querySelector("svg")).pop() || null;
  }
  return options.all ? [] : null;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    if (msg.action === "ping") {
      sendResponse({ ready: true });
      return false;
    }
    if (msg.action === "inject") {
      injectAndSend(msg.text).then(sendResponse).catch(e => sendResponse({ site: SITE, status: "error", error: e.message }));
      return true;
    }
    if (msg.action === "readResponse") {
      readLatestResponse().then(async text => {
        if (typeof postProcessBlobUrls === "function") { text = await postProcessBlobUrls(text); }
        const { hasRichContent, richTypes } = detectRichContent();
        // v4.6.8 F18: readResponse 返回 isStreaming 让 chat-bus pollOnce 判完成时纳入条件
        // 防 ChatGPT/Claude 等复杂问题中"模型停顿规划下一段"时被 4.5s sameCount 误判完成
        const streamingEl = queryBySelectors("streaming");
        const isStreaming = !!(streamingEl && streamingEl.getBoundingClientRect?.().width > 0);
        sendResponse({ site: SITE, text, hasRichContent, richTypes, isStreaming });
      }).catch(e => sendResponse({ site: SITE, text: "", error: e.message }));
      return true;
    }
    if (msg.action === "injectImages") {
      handleInjectImages(msg.images).then(sendResponse).catch(e => sendResponse({ status: "error", error: e.message }));
      return true;
    }
    if (msg.action === "checkCompletion") {
      const text = getLastResponseText();
      const streamingEl = queryBySelectors("streaming");
      const isStreaming = !!(streamingEl && streamingEl.getBoundingClientRect?.().width > 0);
      sendResponse({
        site: SITE,
        textLength: text.length,
        isStreaming
      });
      return false;
    }
    if (msg.action === "readFullConversation") {
      sendResponse({ site: SITE, turns: readFullConversation() });
      return false;
    }
  } catch (e) {
    sendResponse({ site: SITE, status: "error", error: e.message });
    return false;
  }
});

function _extractEl(el) {
  if (!el) return "";
  return typeof extractTextWithFences === "function"
    ? extractTextWithFences(el)
    : (el.innerText || el.textContent || "");
}
function getLastResponseText() {
  const responses = queryBySelectors("response", { all: true });
  if (responses.length > 0) return _extractEl(responses[responses.length - 1]);
  return "";
}

// 健壮注入：优先模拟粘贴 → execCommand → innerHTML 兜底
async function robustInject(el, text) {
  el.focus();
  // 清空现有内容
  el.innerHTML = "";
  el.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(100);

  // 方法1: 模拟粘贴（最能触发框架状态更新）
  try {
    // v4.8.53: 长文本（>1500 字）跳过 paste — ChatGPT / Kimi 的 paste 处理器会把长文本
    //   自动转成 .txt 附件（截图证据：用户反馈"用户补充要求: 对于极化可重构: ..." 文件 card），
    //   导致 prompt 没作为文字发出去。throw 跳到 catch{} 走 execCommand insertText 路径。
    if (text.length > 1500) throw new Error("skip_paste_long_text");
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    const pasteEvent = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(pasteEvent);
    await sleep(150);
    // v4.8.60: paste 合成事件不自动触发 input event，手动补让 React/ProseMirror 框架感知
    try { el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: text })); } catch (_) {}
    await sleep(50);
    if (el.innerText.trim().length > 0) return;
  } catch {}

  // 方法2: execCommand（广泛兼容）
  try {
    el.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, text);
    await sleep(150);
    // v4.8.60: execCommand insertText 在某些浏览器版本下不自动触发 input event，补一次
    try { el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text })); } catch (_) {}
    await sleep(50);
    if (el.innerText.trim().length > 0) return;
  } catch {}

  // 方法3: innerHTML 兜底
  const paragraphs = text.split("\n").map(line => `<p>${line || "<br>"}</p>`).join("");
  el.innerHTML = paragraphs;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function injectAndSend(text) {
  try {
    const el = queryBySelectors("input");
    if (!el) return { site: SITE, status: "error", error: "未找到输入框" };

    await robustInject(el, text);

    for (let i = 0; i < 15; i++) {
      await sleep(200);
      const current = (el.tagName === "TEXTAREA" ? el.value : el.innerText).trim();
      if (current.length >= text.length * 0.3) break;
    }

    el.focus();
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    await sleep(50);
    el.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    await sleep(50);
    el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));

    await sleep(500);
    const remaining = (el.tagName === "TEXTAREA" ? el.value : el.innerText).trim();
    if (remaining.length < text.length * 0.3) return { site: SITE, status: "sent" };

    // v4.8.60: fallback retry 加强 — 3 次 300ms → 8 次 400ms = 3.2s；加 input event 触发 React state 刷新；
    //   aria-disabled 检测兼容 DeepSeek/Kimi 等用 aria 而不是 .disabled 的框架
    for (let attempt = 0; attempt < 8; attempt++) {
      await sleep(400);
      try { el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "" })); } catch (_) {}
      const btn = findSendButton();
      const disabled = btn && (btn.disabled || btn.getAttribute("aria-disabled") === "true");
      if (btn && !disabled) { btn.click(); return { site: SITE, status: "sent" }; }
    }

    // v4.8.60: fail-soft 替代 v4.8.50 fail-loud — Enter 可能已触发发送（input 残留只是 React 异步清空慢），
    //   返回 sent 让 chat-bus 启 polling 兜底；polling EMPTY_TIMEOUT_TICKS (45s) 未读到才真正报错
    //   背景：fail-loud 对 DeepSeek/Kimi React 同步慢的场景误报，user 看到"注入失败"但消息已发 → 错失提取
    return { site: SITE, status: "sent", inject_warning: "button stayed disabled after 8 retries — polling will verify" };
  } catch (e) {
    return { site: SITE, status: "error", error: e.message };
  }
}

async function readLatestResponse() {
  // v6: streaming 检测已由 sidepanel 轮询负责，此处仅短暂等待 DOM 稳定
  await sleep(500);

  // 多策略读取最后一条 AI 回答
  const text = getLastAssistantText();
  return text;
}

// v4.8.27 F35: 清理 Claude 回答的 sr-only / thinking 噪音
// 截图证据："Claude responded: 1+1=2Thinking about...1+1=2" 三段被拼一起
// 1. "Claude responded:" 是 sr-only 截图 aria-label，应剥离
// 2. thinking summary 是 Claude 思考过程，用户不需要看（默认折叠在 UI 上）
// 3. 真正回答可能在 .prose 或某个 final 容器
function cleanClaudeText(raw) {
  if (!raw) return "";
  let t = raw;
  // 剥离开头的 sr-only "Claude responded:" / "Reply:" / 类似前缀
  t = t.replace(/^(Claude\s+(responded|replied|said|response):?\s*|Reply\s*:?\s*)/i, "");
  return t.trim();
}

// 在 .font-claude-message 容器内提取真正回答，跳过 thinking 折叠块
function _extractClaudeResponse(container) {
  if (!container) return "";
  // Claude UI 把 thinking 放在 <details> 或 [data-state="open"] 折叠区
  // 复制一份 DOM，剥离 thinking 节点后再 innerText
  const clone = container.cloneNode(true);
  // 移除 thinking summary（多种可能选择器）
  clone.querySelectorAll([
    "details",
    "[aria-label*='Thinking' i]",
    "[aria-label*='思考' i]",
    "[data-testid*='thinking' i]",
    "button[aria-expanded]",  // 折叠展开按钮
    ".sr-only",  // 屏幕阅读器专用文本（含 "Claude responded:" 等）
    "[aria-hidden='false'].sr-only",
  ].join(", ")).forEach(el => el.remove());

  // 也移除带 "Thinking about" 文本开头的标题/按钮
  clone.querySelectorAll("h1, h2, h3, h4, button, summary").forEach(el => {
    const t = (el.innerText || "").trim();
    if (/^(Thinking|思考|Pondering|Considering)\b/i.test(t)) el.remove();
  });

  const text = typeof extractTextWithFences === "function"
    ? extractTextWithFences(clone)
    : (clone.innerText || clone.textContent || "");
  return cleanClaudeText(text);
}

function getLastAssistantText() {
  // 优先策略：用容器 + cleanup（剥 thinking 和 sr-only）
  const claudeMsgs = document.querySelectorAll(".font-claude-message");
  if (claudeMsgs.length > 0) {
    const r = _extractClaudeResponse(claudeMsgs[claudeMsgs.length - 1]);
    if (r) return r;
  }

  const testIdMsgs = document.querySelectorAll("[data-testid='chat-message-content']");
  if (testIdMsgs.length > 0) {
    const r = _extractClaudeResponse(testIdMsgs[testIdMsgs.length - 1]);
    if (r) return r;
  }

  // 选择器配置兜底
  const responses = queryBySelectors("response", { all: true });
  if (responses.length > 0) return cleanClaudeText(_extractEl(responses[responses.length - 1]));

  const streamContainers = document.querySelectorAll("[data-is-streaming]");
  if (streamContainers.length > 0) {
    const last = streamContainers[streamContainers.length - 1];
    const r = _extractClaudeResponse(last);
    if (r) return r;
  }

  const proseBlocks = document.querySelectorAll(".prose, .markdown");
  if (proseBlocks.length > 0) return cleanClaudeText(_extractEl(proseBlocks[proseBlocks.length - 1]));

  const allBlocks = document.querySelectorAll('[class*="message"], [class*="response"], [class*="assistant"]');
  for (let i = allBlocks.length - 1; i >= 0; i--) {
    const text = cleanClaudeText(_extractEl(allBlocks[i]));
    if (text.length > 50) return text;
  }

  return "";
}

function readFullConversation() {
  try {
    const turns = [];

    // 策略 1: data-testid（旧版）
    const userMsgs = document.querySelectorAll('[data-testid="human-turn"]');
    const aiMsgs = document.querySelectorAll('[data-testid="chat-message-content"]');
    if (userMsgs.length > 0 || aiMsgs.length > 0) {
      const len = Math.max(userMsgs.length, aiMsgs.length);
      for (let i = 0; i < len; i++) {
        if (userMsgs[i]) turns.push({ role: "user", text: userMsgs[i].innerText.trim() });
        if (aiMsgs[i]) turns.push({ role: "assistant", text: aiMsgs[i].innerText.trim() });
      }
      return turns;
    }

    // 策略 2: 通用 — 遍历对话流中的所有轮次
    // Claude 页面通常是 user/assistant 交替的 div 块
    const allTurns = document.querySelectorAll('[data-testid="human-turn"], .font-claude-message, [data-is-streaming]');
    if (allTurns.length > 0) {
      allTurns.forEach(el => {
        const isUser = el.matches('[data-testid="human-turn"]') || el.closest('[data-testid="human-turn"]');
        turns.push({
          role: isUser ? "user" : "assistant",
          text: el.innerText.trim()
        });
      });
      return turns;
    }

    // 策略 3: 最后兜底 — 获取整个对话区域的文本
    const chatArea = document.querySelector('[class*="conversation"], [class*="chat"], main');
    if (chatArea) {
      turns.push({ role: "assistant", text: chatArea.innerText.trim().slice(-2000) });
    }

    return turns;
  } catch { return []; }
}

function findSendButton() {
  return queryBySelectors("sendButton");
}

function detectRichContent() {
  const types = [];
  // Claude Artifact
  if (document.querySelector('[class*="artifact"], iframe[src*="artifact"]')) types.push("artifact");
  // 多图
  const imgs = document.querySelectorAll("main img, [role='main'] img");
  if (imgs.length > 1) types.push("image");
  // Mermaid（Claude 偶尔嵌 mermaid）
  if (document.querySelector('code.language-mermaid, [class*="mermaid"]')) types.push("mermaid");
  const imagesPending = (typeof countPendingImages === "function") ? countPendingImages() : 0;
  return { hasRichContent: types.length > 0, richTypes: types, imagesPending };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

})();  // v4.8.47 IIFE 防御重复注入 END
