// AI Arena — Content Script for gemini.google.com
// v4.8.47: IIFE + globalThis guard 防御重复注入（reload 扩展 / ensureContentScriptInjected 多次触发时不撞 const SITE 重复声明）
(function() {
if (globalThis.__AI_ARENA_CS_LOADED_gemini__) {
  console.log("[content-gemini] already loaded, skip duplicate injection");
  return;
}
globalThis.__AI_ARENA_CS_LOADED_gemini__ = true;

const SITE = "gemini";

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
  if (action === "response" && sels.length > 0) return options.all ? [] : null;
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
    if (msg.action === "ping") { sendResponse({ ready: true }); return false; }
    if (msg.action === "inject") { injectAndSend(msg.text).then(sendResponse).catch(e => sendResponse({ site: SITE, status: "error", error: e.message })); return true; }
    if (msg.action === "readResponse") {
      readLatestResponse().then(async text => {
        if (typeof postProcessBlobUrls === "function") { text = await postProcessBlobUrls(text); }
        const { hasRichContent, richTypes } = detectRichContent();
        // v4.6.8 F18: readResponse 返回 isStreaming 让 chat-bus pollOnce 判完成时纳入条件
        const streamingEl = queryBySelectors("streaming");
        const isStreaming = !!(streamingEl && streamingEl.getBoundingClientRect?.().width > 0);
        sendResponse({ site: SITE, text, hasRichContent, richTypes, isStreaming });
      }).catch(e => sendResponse({ site: SITE, text: "", error: e.message }));
      return true;
    }
    if (msg.action === "injectImages") { handleInjectImages(msg.images).then(sendResponse).catch(e => sendResponse({ status: "error", error: e.message })); return true; }
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
    if (msg.action === "readFullConversation") { sendResponse({ site: SITE, turns: readFullConversation() }); return false; }
  } catch (e) { sendResponse({ site: SITE, status: "error", error: e.message }); return false; }
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

async function robustInject(el, text) {
  el.focus();
  el.innerHTML = "";
  el.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(100);

  try {
    // v4.8.53: 长文本（>1500 字）跳过 paste — ChatGPT / Kimi 的 paste 处理器会把长文本
    //   自动转成 .txt 附件（截图证据：用户反馈"用户补充要求: 对于极化可重构: ..." 文件 card），
    //   导致 prompt 没作为文字发出去。throw 跳到 catch{} 走 execCommand insertText 路径。
    if (text.length > 1500) throw new Error("skip_paste_long_text");
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    await sleep(150);
    // v4.8.60: paste 是合成事件不会自动触发 input event，手动补一次让 React/ProseMirror 框架感知变化
    //   （DeepSeek/Kimi 等 React 框架靠 input event 检测变化 → 没接到 → button 仍 disabled）
    try { el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: text })); } catch (_) {}
    await sleep(50);
    if (el.innerText.trim().length > 0) return;
  } catch {}

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

  el.innerHTML = text.split("\n").map(line => `<p>${line || "<br>"}</p>`).join("");
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function injectAndSend(text) {
  try {
    const ready = await waitForUsableInput();
    if (!ready.ok) return { site: SITE, status: "error", error: ready.error };
    const el = ready.el;

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
    //   aria-disabled 检测兼容用 aria 而不是 .disabled 的框架
    for (let attempt = 0; attempt < 8; attempt++) {
      await sleep(400);
      try { el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "" })); } catch (_) {}
      const btn = queryBySelectors("sendButton");
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

// v4.8.28 F36: Gemini 第二次发问失败根因 — waitForUsableInput 只检查输入框 visible，
// 不检查 send button 是否 disabled。Gemini 第一次回答完成后 send button 仍处于
// "Stop" 状态几百毫秒~几秒（内部保存对话/生成 chat-id），此时 inject Enter 被 Gemini
// 静默丢弃。改为等待 send button enabled / 不存在 stop 按钮才算 ready
async function waitForUsableInput(timeoutMs = 20000) {
  const started = Date.now();
  let lastReason = "未找到输入框";
  while (Date.now() - started < timeoutMs) {
    if (isLoginBlocked()) return { ok: false, error: "需要登录" };
    const el = queryBySelectors("input");
    if (!el || !isVisibleInput(el)) {
      lastReason = "输入框未渲染";
      await sleep(300);
      continue;
    }
    // 检查输入框本身没被 disabled
    if (el.getAttribute("aria-disabled") === "true" || el.getAttribute("contenteditable") === "false") {
      lastReason = "输入框 disabled / contenteditable=false";
      await sleep(300);
      continue;
    }
    // 关键：检查页面没有 streaming 信号（Stop 按钮 / Stop response aria-label）
    // 注意 NOT 检查 send button disabled — 输入框为空时 send button 本来就 disabled 合理
    const stopBtn = document.querySelector(
      'button[aria-label*="Stop response" i], button[aria-label*="Stop generating" i], ' +
      'button[aria-label*="停止" i], [class*="stop-generating" i]'
    );
    if (stopBtn) {
      lastReason = "页面仍有 Stop 按钮 (上一条 streaming 中)";
      await sleep(300);
      continue;
    }
    // 检查 Gemini 内部 loading 指示器（model-response 内的 spinner / thinking-indicator）
    const stillLoading = document.querySelector(
      'model-response .loading-indicator, model-response .thinking-indicator, ' +
      'model-response mat-spinner, model-response .animate-spin'
    );
    if (stillLoading) {
      lastReason = "model-response loading/thinking 指示器仍在";
      await sleep(300);
      continue;
    }
    return { ok: true, el };
  }
  console.warn("[Gemini F36] waitForUsableInput 超时:", lastReason);
  return { ok: false, error: `输入框未就绪: ${lastReason}` };
}

function isVisibleInput(el) {
  const rect = el.getBoundingClientRect?.();
  return !!rect && rect.width > 50 && rect.height > 15 && getComputedStyle(el).visibility !== "hidden";
}

function isLoginBlocked() {
  const text = document.body?.innerText || "";
  const hasLogin = /登录|Sign in|Log in/i.test(text);
  return hasLogin && !document.querySelector("rich-textarea .ql-editor, .ql-editor[contenteditable='true'], [data-content-type='model']");
}

async function readLatestResponse() {
  // v6: streaming 检测已由 sidepanel 轮询负责，此处仅短暂等待 DOM 稳定
  await sleep(800);
  if (isLoginBlocked()) throw new Error("需要登录");

  // v4.6.3 F12: 优先锚定最新 model-response 容器再在其内查内容，防图片/canvas-only
  // 回答时 selector(".markdown") 跨轮匹配到前一轮 markdown 节点 → 返回上一轮残留文本。
  // v4.6.7 F16: thinking 阶段的 "Defining the Task" 等过渡文本会稳定 3+ tick 触发
  // polling 完成 → 推送噪音给 popup。修复：streaming 时不走 fallback；走 fallback 时
  // clone + remove thinking 子节点防 thinking 文本污染。
  const THINKING_SEL = 'thinking-tag, .thinking, [class*="thinking"], '
    + '.loading-indicator, .animate-spin, mat-spinner, '
    + '[class*="ProgressContainer"], [class*="thinking-indicator"]';
  const allModels = document.querySelectorAll("[data-content-type='model'], model-response");
  if (allModels.length > 0) {
    const last = allModels[allModels.length - 1];
    // v4.6.7 F16: 检测当前 model-response 是否仍在 streaming/thinking
    const stillStreaming = !!(
      last.querySelector(THINKING_SEL)
      || document.querySelector('button[aria-label*="Stop"], model-response .loading-indicator')
    );

    // 1) latest model-response 内的 markdown 子节点（即便 streaming，部分文字已稳定也能抓）
    const md = last.querySelector(".model-response-text .markdown, .response-container .markdown, .markdown");
    if (md) {
      const t = _extractEl(md).trim();
      if (t) return t;
    }
    // 2) v4.6.7 F16: 没 markdown 且仍 streaming → 返回空让 polling 继续等
    // 防 thinking 阶段 "Defining the Task" 等过渡内容稳定 3 tick 被判完成（实测截图证据）
    if (stillStreaming) return "";

    // 3) 没 markdown 且 streaming 已结束 → 整体抽取（image-only / canvas-only 等场景）
    //    clone 后排除 thinking 子节点防过渡内容污染
    const clone = last.cloneNode(true);
    clone.querySelectorAll(THINKING_SEL).forEach(el => el.remove());
    const full = (typeof extractTextWithFences === "function"
      ? extractTextWithFences(clone)
      : (clone.innerText || clone.textContent || "")
    ).trim();
    if (full) return full;

    // 4) 仍空 → 直接列出 img markdown（生成图回答常见情形）
    const imgs = last.querySelectorAll("img[src]");
    const realImgs = Array.from(imgs).filter(img => {
      const src = img.getAttribute("src") || "";
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      return (/^https?:|^data:image|^blob:/i.test(src)) && (w >= 60 || h >= 60);
    });
    if (realImgs.length) {
      return realImgs.map((img, i) => `![image-${i + 1}](${img.getAttribute("src")})`).join("\n\n");
    }
    // 5) canvas-only（图正在画） → 返回占位让 polling 继续等
    if (last.querySelector("canvas")) return "[正在生成图片...]";
  }

  // 兜底：旧 selector 路径（保留向后兼容，理论上不会执行到）
  const responses = queryBySelectors("response", { all: true });
  if (responses.length > 0) return _extractEl(responses[responses.length - 1]).trim();
  return "";
}

function readFullConversation() {
  const turns = [];
  // Gemini 的对话容器：每个 conversation-turn 包含 user 或 model
  const allTurns = document.querySelectorAll('user-query, model-response');
  allTurns.forEach(el => {
    const isUser = el.tagName.toLowerCase() === 'user-query';
    const text = el.innerText.trim();
    if (text) turns.push({ role: isUser ? 'user' : 'assistant', text });
  });
  // 备选：data-content-type
  if (!turns.length) {
    document.querySelectorAll('[data-content-type]').forEach(el => {
      const type = el.getAttribute('data-content-type');
      const text = el.innerText.trim();
      if (text) turns.push({ role: type === 'model' ? 'assistant' : 'user', text });
    });
  }
  return turns;
}

function findSendButton() {
  return queryBySelectors("sendButton");
}

function detectRichContent() {
  const types = [];
  // Gemini Canvas
  if (document.querySelector('[class*="canvas"], canvas[width][height]')) types.push("canvas");
  if (document.querySelectorAll("main img").length > 1) types.push("image");
  if (document.querySelector('code.language-mermaid')) types.push("mermaid");
  const imagesPending = (typeof countPendingImages === "function") ? countPendingImages() : 0;
  return { hasRichContent: types.length > 0, richTypes: types, imagesPending };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

})();  // v4.8.47 IIFE 防御重复注入 END
