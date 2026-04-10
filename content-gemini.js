// AI Arena — Content Script for gemini.google.com
const SITE = "gemini";

// 选择器配置（启动时从 background 获取）
let selectors = null;
chrome.runtime.sendMessage({ type: "getSelectors", platform: SITE }, (resp) => {
  if (resp) selectors = resp;
});

// 按优先级尝试选择器数组，返回第一个匹配的元素
function queryBySelectors(action, options = {}) {
  const sels = selectors?.[action] || [];
  for (const sel of sels) {
    const el = options.all ? document.querySelectorAll(sel) : document.querySelector(sel);
    if (options.all ? el.length > 0 : el) return el;
  }
  const heuristic = getHeuristicElement(action, options);
  if (heuristic) return heuristic;
  chrome.runtime.sendMessage({ type: "selectorFailure", platform: SITE, action }).catch(() => {});
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
    const blocks = document.querySelectorAll('div, article, section');
    for (let i = blocks.length - 1; i >= 0; i--) {
      const text = blocks[i].innerText?.trim();
      if (text && text.length > 100 && blocks[i].getBoundingClientRect().height > 50) {
        return options.all ? [blocks[i]] : blocks[i];
      }
    }
    return options.all ? [] : null;
  }
  if (action === "streaming") {
    return document.querySelector('button[aria-label*="Stop"], button[aria-label*="stop"], button[aria-label*="Cancel"]');
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
    if (msg.action === "readResponse") { readLatestResponse().then(r => sendResponse({ site: SITE, text: r })).catch(e => sendResponse({ site: SITE, text: "", error: e.message })); return true; }
    if (msg.action === "injectImages") { handleInjectImages(msg.images).then(sendResponse).catch(e => sendResponse({ status: "error", error: e.message })); return true; }
    if (msg.action === "checkStreaming") {
      sendResponse({ site: SITE, streaming: isThinkingOrStreaming() });
      return false;
    }
    if (msg.action === "readFullConversation") { sendResponse({ site: SITE, turns: readFullConversation() }); return false; }
  } catch (e) { sendResponse({ site: SITE, status: "error", error: e.message }); return false; }
});

async function robustInject(el, text) {
  el.focus();
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

  el.innerHTML = text.split("\n").map(line => `<p>${line || "<br>"}</p>`).join("");
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function injectAndSend(text) {
  try {
    // 找输入框 — 通过 SelectorManager 或启发式
    const el = queryBySelectors("input");
    if (!el) return { site: SITE, status: "error", error: "未找到输入框" };

    await robustInject(el, text);

    for (let attempt = 0; attempt < 8; attempt++) {
      await sleep(400);
      const btn = queryBySelectors("sendButton");
      if (btn && !btn.disabled) {
        btn.click();
        return { site: SITE, status: "sent" };
      }
    }
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    return { site: SITE, status: "sent", error: "通过Enter发送" };
  } catch (e) {
    return { site: SITE, status: "error", error: e.message };
  }
}

function isThinkingOrStreaming() {
  // 先检查 SelectorManager 配置的 streaming 选择器
  if (queryBySelectors("streaming")) return true;
  // Gemini-specific: 检测最后一个 model-response 内是否有动画/思考元素
  const responses = document.querySelectorAll("model-response");
  if (responses.length > 0) {
    const last = responses[responses.length - 1];
    if (last.querySelector('[class*="animat"], [class*="spin"], [class*="loading"], [class*="progress"]')) return true;
    const thinkEl = last.querySelector("thinking-tag, [class*='thinking'], [class*='Thinking'], [class*='Analyzing']");
    const markdown = last.querySelector(".markdown");
    if (thinkEl && (!markdown || markdown.innerText.trim().length < 10)) return true;
  }
  return false;
}

async function readLatestResponse() {
  // 等待生成完成（检查 loading / thinking 指示器）
  for (let i = 0; i < 90; i++) {
    if (isThinkingOrStreaming()) {
      await sleep(1000);
    } else {
      break;
    }
  }
  // Gemini 流式结束后还有 Markdown 渲染延迟
  await sleep(1000);

  // 优先使用 SelectorManager 配置的选择器
  const responses = queryBySelectors("response", { all: true });
  if (responses.length > 0) return responses[responses.length - 1].innerText.trim();

  // 备选选择器
  const modelTurns = document.querySelectorAll("[data-content-type='model']");
  if (modelTurns.length > 0) {
    return modelTurns[modelTurns.length - 1].innerText.trim();
  }

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

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
