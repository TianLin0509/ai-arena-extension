// AI Arena — Content Script for kimi.moonshot.cn
// v4.8.47: IIFE + globalThis guard 防御重复注入（reload 扩展 / ensureContentScriptInjected 多次触发时不撞 const SITE 重复声明）
(function() {
if (globalThis.__AI_ARENA_CS_LOADED_kimi__) {
  console.log("[content-kimi] already loaded, skip duplicate injection");
  return;
}
globalThis.__AI_ARENA_CS_LOADED_kimi__ = true;

const SITE = "kimi";

let selectors = null;
chrome.runtime.sendMessage({ type: "getSelectors", platform: SITE }, (resp) => {
  if (resp) selectors = resp;
});

// v2.1.0: marker 已移除

const _reportedFailures = new Set();
function queryBySelectors(action, options = {}) {
  const sels = selectors?.[action] || [];
  for (const sel of sels) {
    let el;
    // v5.0.64: 非法选择器（远程下发笔误/老内核不支持新语法）跳过该条，不炸整个 action
    try { el = options.all ? document.querySelectorAll(sel) : document.querySelector(sel); }
    catch (_) { continue; }
    if (options.all ? el.length > 0 : el) return el;
  }
  const heuristic = getHeuristicElement(action, options);
  if (heuristic) return heuristic;
  if (!_reportedFailures.has(action)) { _reportedFailures.add(action); chrome.runtime.sendMessage({ type: "selectorFailure", platform: SITE, action }).catch(() => {}); }
  return options.all ? [] : null;
}

function getHeuristicElement(action, options = {}) {
  if (action === "input") {
    const editables = [...document.querySelectorAll('[role="textbox"], [contenteditable], textarea')];
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
    // v4.5.4 F1: 当前页没有用户消息 DOM → 不可能是对话页面（多半是登录页/首页/空会话），
    // 直接放弃 heuristic，避免抓到主页装饰文本（实测 408 字符 ![activity image]...）当 AI 回答
    if (!hasUserMessageInDom()) return options.all ? [] : null;
    const blocks = document.querySelectorAll('div, article, section');
    const block = globalThis.ArenaShared?.findReadableBlock?.(blocks, { minTextLength: 100, minHeight: 50, limit: 80 });
    return options.all ? (block ? [block] : []) : block;
  }
  if (action === "sendButton") {
    const btns = [...document.querySelectorAll("button")];
    return btns.filter(b => b.getBoundingClientRect().bottom > window.innerHeight - 150 && b.querySelector("svg")).pop() || null;
  }
  return options.all ? [] : null;
}

// v5.2.20: streaming 判定改用 ArenaShared.detectStreaming（限定最新回答容器 + 视口可见，
//   不再全文档 querySelector + 裸 width>0），修第二/三轮起 isStreaming 误卡 true 导致提取拖延/超时。
function _detectStreaming() {
  const rs = queryBySelectors("response", { all: true });
  const latest = rs && rs.length ? latestResponseElement(rs) : null;
  return globalThis.ArenaShared?.detectStreaming?.(selectors?.streaming || [], latest, window, document) || false;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    if (msg.action === "ping") { sendResponse({ ready: true }); return false; }
    if (msg.action === "inject") {
      // v5.0.16: 发送失败时清 cursor 锚点 → 提取回退尾部候选，防错误基准截掉真实新回答
      const respondInject = (result) => {
        if (!result || result.status !== "sent") { try { globalThis.ArenaShared?.clearResponseCursorAnchor?.(SITE); } catch (_) {} }
        sendResponse(result);
      };
      // v5.0.65: injectToken 幂等去重 — 超时重试附着在飞首试，防同一 prompt 双发
      const _run = () => injectAndSend(msg.text);
      const _exec = globalThis.ArenaShared?.dedupInject ? globalThis.ArenaShared.dedupInject(msg.injectToken, _run) : _run();
      _exec.then(respondInject).catch(e => respondInject({ site: SITE, status: "error", error: e.message }));
      return true;
    }
    if (msg.action === "readResponse") {
      readLatestResponse().then(async text => {
        if (typeof postProcessBlobUrls === "function") { text = await postProcessBlobUrls(text); }
        // v5.0.20: imagesPending 一并透传 — 旧版被解构丢弃，pollOnce 的"图片加载中不算空超时"保护失效
        const { hasRichContent, richTypes, imagesPending } = detectRichContent();
        // v4.6.8 F18: readResponse 返回 isStreaming 让 chat-bus pollOnce 判完成时纳入条件
        const isStreaming = _detectStreaming();
        // v5.0.20: 同文本省略 — 与 SW 上次收到的一致时只回 sameText 不整段回传
        const t = (text || "").trim();
        const h = globalThis.ArenaShared?.textHash?.(t) || null;
        if (msg.knownHash && h && h === msg.knownHash) {
          sendResponse({ site: SITE, sameText: true, hasRichContent, richTypes, imagesPending, isStreaming });
          return;
        }
        sendResponse({ site: SITE, text: t, textHash: h, hasRichContent, richTypes, imagesPending, isStreaming });
      }).catch(e => sendResponse({ site: SITE, text: "", error: e.message }));
      return true;
    }
    if (msg.action === "injectImages") { handleInjectImages(msg.images).then(sendResponse).catch(e => sendResponse({ status: "error", error: e.message })); return true; }
    if (msg.action === "checkCompletion") {
      const text = getLastResponseText();
      const isStreaming = _detectStreaming();
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
  // v5.2.12: 优先 extractTextSafe（fenced 损坏自动回退 textContent，鲁棒 ≥ v1.0）
  if (typeof extractTextSafe === "function") return extractTextSafe(el);
  if (typeof extractTextWithFences === "function") return extractTextWithFences(el);
  return el.textContent || el.innerText || "";
}

function latestResponseElement(elements) {
  const picked = globalThis.ArenaShared?.getLatestResponseCandidate?.(elements, SITE);
  if (picked) return picked;
  if (globalThis.ArenaShared?.hasResponseCursor?.(SITE)) return null;
  if (!elements || !elements.length) return null;
  return globalThis.ArenaShared?.getLastNonEmpty?.(elements) || elements[elements.length - 1];
}

function rememberCurrentResponseCursor() {
  // v5.0.16: 只用站点自身 response 选择器建锚点，且与提取同源（indexOf 可直接命中）。
  //   旧版追加的广谱通配（[class*='assistant'] / [class*='response'] 等）会把侧边栏、
  //   设置按钮等无关元素收进候选，锚点可能落在对话区之后，把真实新回答整体过滤掉。
  try {
    globalThis.ArenaShared?.rememberResponseCursor?.(SITE, queryBySelectors("response", { all: true }));
  } catch (_) {}
}

function getLastResponseText() {
  const responses = queryBySelectors("response", { all: true });
  // v5.2.6: 取最后一个有内容的（兜底末位空容器：streaming / spacer / 装饰）
  if (responses.length > 0) {
    const _last = latestResponseElement(responses);
    return _extractEl(_last);
  }
  return "";
}

async function robustInject(el, text) {
  el.focus();
  if (el.tagName === "TEXTAREA") {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    if (nativeSetter) nativeSetter.call(el, text);
    else el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  el.innerHTML = "";
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
  // v5.2.17: 安全注入（多方审查 Codex 高危）— 杜绝 innerHTML 拼接用户 prompt（防 < > & 被解析篡改/XSS）
  if (globalThis.ArenaShared?.setEditableLines) {
    globalThis.ArenaShared.setEditableLines(el, text);
  } else {
    el.innerHTML = "";
    text.split("\n").forEach(line => { const p = document.createElement("p"); if (line) p.textContent = line; else p.appendChild(document.createElement("br")); el.appendChild(p); });
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

async function injectAndSend(text) {
  try {
    rememberCurrentResponseCursor();
    const el = queryBySelectors("input");
    if (!el) return { site: SITE, status: "error", error: "未找到输入框", code: "INJECT_NO_INPUT", snapshot: { service: SITE, stage: "injecting", hitSelectors: { input: null }, domTextLen: 0, bootstrapReady: !!globalThis.__arenaBootstrap, pageUrl: location.href } };

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
  await sleep(500);
  // v4.3.8: 直接 hardcoded Kimi 当前 DOM 结构 — 不依赖异步加载的 selectors
  // 顺序：精确 selector → markdown 通配 → heuristic 大文本块
  // v5.2.6: helper 改用 getLastNonEmpty — 1 处改 4 个 fallback selector 全受益
  const tryGet = (sel) => {
    const els = document.querySelectorAll(sel);
    if (!els.length) return null;
    return latestResponseElement(els);
  };
  const direct = tryGet('div.segment.segment-assistant')
              || tryGet('div[class*="segment-assistant"]')
              || tryGet('.markdown-container')
              || tryGet('[class*="markdown-container"]');
  if (direct) {
    const t = _extractEl(direct).trim();
    if (t) return t;
  }
  // 1) 配置 selector
  // v5.2.6: 取最后一个有内容的（兜底末位空容器）
  const responses = queryBySelectors("response", { all: true });
  if (responses.length > 0) {
    const _last = latestResponseElement(responses);
    const t = _extractEl(_last).trim();
    if (t) return t;
  }
  // 2) markdown 通配
  // v5.2.6: 取最后一个有内容的（fallback prose 也兜底）
  const prose = document.querySelectorAll('.markdown-body, .prose, [class*="markdown"]');
  if (prose.length > 0) {
    const _last = latestResponseElement(prose);
    const t = _extractEl(_last).trim();
    if (t) return t;
  }
  // 3) heuristic — 阈值降到 20 字适应短问候
  // v4.5.4 F1: 无用户消息 DOM → 当前是登录/首页/空会话页，主页 banner 装饰文本会被误当 AI 回答
  if (typeof hasUserMessageInDom === "function" && !hasUserMessageInDom()) return "";
  const all = document.querySelectorAll("div, article, section");
  const fallback = globalThis.ArenaShared?.findReadableBlock?.(all, {
    minTextLength: 20,
    minHeight: 30,
    limit: 80,
    reject: (el) => !!(el.closest("nav, header, footer, [role=banner], [role=navigation]") || el.querySelector("textarea, input, [contenteditable]")),
  });
  if (fallback) {
    const t = (fallback.innerText || fallback.textContent || "").trim();
    return _extractEl(fallback).trim() || t;
  }
  return "";
}

function readFullConversation() {
  const turns = [];
  const userMsgs = [...document.querySelectorAll('[class*="user-message"], [class*="human"], [class*="user"] [class*="content"]')];
  const aiMsgs = [...document.querySelectorAll('[class*="markdown"], [class*="assistant-message"], [class*="bot-message"]')];
  const len = Math.max(userMsgs.length, aiMsgs.length);
  for (let i = 0; i < len; i++) {
    if (userMsgs[i]) turns.push({ role: "user", text: userMsgs[i].innerText.trim() });
    if (aiMsgs[i]) turns.push({ role: "assistant", text: aiMsgs[i].innerText.trim() });
  }
  return turns;
}

function findSendButton() {
  return queryBySelectors("sendButton");
}

function detectRichContent() {
  const types = [];
  if (document.querySelectorAll("main img, .message img, [class*='response'] img").length > 1) types.push("image");
  if (document.querySelector('code.language-mermaid, [class*="mermaid"]')) types.push("mermaid");
  if (document.querySelector('[class*="canvas"]:not(button):not(input)')) types.push("canvas");
  const imagesPending = (typeof countPendingImages === "function") ? countPendingImages() : 0;
  return { hasRichContent: types.length > 0, richTypes: types, imagesPending };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

})();  // v4.8.47 IIFE 防御重复注入 END
