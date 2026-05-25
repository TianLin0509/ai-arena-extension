// AI Arena — Content Script for chatgpt.com
// v4.8.47: IIFE + globalThis guard 防御重复注入（reload 扩展 / ensureContentScriptInjected 多次触发时不撞 const SITE 重复声明）
(function() {
if (globalThis.__AI_ARENA_CS_LOADED_chatgpt__) {
  console.log("[content-chatgpt] already loaded, skip duplicate injection");
  return;
}
globalThis.__AI_ARENA_CS_LOADED_chatgpt__ = true;

const SITE = "chatgpt";

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

async function robustInject(el, text) {
  el.focus();

  // 方法1: textarea — native setter（React 绕过）
  if (el.tagName === "TEXTAREA") {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    if (nativeSetter) nativeSetter.call(el, text);
    else el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  // contenteditable div — 优先模拟粘贴
  el.innerHTML = "";
  el.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(100);

  try {
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    await sleep(200);
    if (el.innerText.trim().length > 0) return;
  } catch {}

  try {
    el.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, text);
    await sleep(200);
    if (el.innerText.trim().length > 0) return;
  } catch {}

  // 兜底
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
    if (isLoginBlocked()) return { site: SITE, status: "error", error: "需要登录或关闭登录弹窗" };

    const remaining = (el.tagName === "TEXTAREA" ? el.value : el.innerText).trim();
    if (remaining.length < text.length * 0.3) return { site: SITE, status: "sent" };

    for (let attempt = 0; attempt < 3; attempt++) {
      await sleep(300);
      const btn = findSendButton();
      if (btn && !btn.disabled) {
        btn.click();
        await sleep(800);
        if (isLoginBlocked()) return { site: SITE, status: "error", error: "需要登录或关闭登录弹窗" };
        return { site: SITE, status: "sent" };
      }
    }

    if (isLoginBlocked()) return { site: SITE, status: "error", error: "需要登录或关闭登录弹窗" };
    return { site: SITE, status: "sent" };
  } catch (e) {
    return { site: SITE, status: "error", error: e.message };
  }
}

async function waitForUsableInput(timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (isLoginBlocked()) return { ok: false, error: "需要登录或关闭登录弹窗" };
    const el = queryBySelectors("input");
    if (el && isVisibleInput(el)) return { ok: true, el };
    await sleep(300);
  }
  return { ok: false, error: "未找到输入框" };
}

function isVisibleInput(el) {
  const rect = el.getBoundingClientRect?.();
  return !!rect && rect.width > 50 && rect.height > 15 && getComputedStyle(el).visibility !== "hidden";
}

function isLoginBlocked() {
  const text = document.body?.innerText || "";
  const hasDialog = !!document.querySelector('[role="dialog"], [data-testid*="modal"], .modal');
  return hasDialog && /登录即可开始聊天|感谢你试用 ChatGPT|登录或注册|保持退出状态|使用 Google 账户继续|使用 Apple 账户继续|Log in|Sign up|Sign in/i.test(text);
}

async function readLatestResponse() {
  // v6: streaming 检测已由 sidepanel 轮询负责，此处仅短暂等待 DOM 稳定
  await sleep(500);

  const responses = queryBySelectors("response", { all: true });
  if (responses.length > 0) return _extractEl(responses[responses.length - 1]).trim();

  const markdownBlocks = document.querySelectorAll(".markdown.prose");
  if (markdownBlocks.length > 0) return _extractEl(markdownBlocks[markdownBlocks.length - 1]).trim();

  return "";
}

function readFullConversation() {
  try {
    const turns = [];
    const msgs = document.querySelectorAll('[data-message-author-role]');
    msgs.forEach(el => {
      const role = el.getAttribute('data-message-author-role');
      if (role === 'user' || role === 'assistant') {
        turns.push({ role, text: el.innerText.trim() });
      }
    });
    return turns;
  } catch { return []; }
}

function findSendButton() {
  return queryBySelectors("sendButton");
}

function detectRichContent() {
  const types = [];
  if (document.querySelector('[class*="canvas-panel"], [data-element-id*="canvas"]')) types.push("canvas");
  if (document.querySelector('code.language-mermaid, [class*="mermaid"]')) types.push("mermaid");
  if (document.querySelectorAll("[data-message-author-role='assistant'] img").length > 1) types.push("image");
  const imagesPending = (typeof countPendingImages === "function") ? countPendingImages() : 0;
  return { hasRichContent: types.length > 0, richTypes: types, imagesPending };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

})();  // v4.8.47 IIFE 防御重复注入 END
