// AI Arena — Content Script for chatgpt.com
const SITE = "chatgpt";

// 选择器配置（启动时从 background 获取）
let selectors = null;
chrome.runtime.sendMessage({ type: "getSelectors", platform: SITE }, (resp) => {
  if (resp) selectors = resp;
});

function stripMarkers(text) {
  return text.replace(/ARENA_START_R\d+/g, '').replace(/ARENA_DONE_R\d+/g, '').trim();
}

const _reportedFailures = new Set();
// 按优先级尝试选择器数组，返回第一个匹配的元素
function queryBySelectors(action, options = {}) {
  const sels = selectors?.[action] || [];
  for (const sel of sels) {
    const el = options.all ? document.querySelectorAll(sel) : document.querySelector(sel);
    if (options.all ? el.length > 0 : el) return el;
  }
  // streaming 检测不走启发式：没匹配到 = 不在生成中（正确结果）
  if (action === "streaming") return null;
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
    if (msg.action === "ping") {
      sendResponse({ ready: true });
      return false;
    }
    if (msg.action === "inject") {
      injectAndSend(msg.text).then(sendResponse).catch(e => sendResponse({ site: SITE, status: "error", error: e.message }));
      return true;
    }
    if (msg.action === "readResponse") {
      readLatestResponse().then(r => sendResponse({ site: SITE, text: r })).catch(e => sendResponse({ site: SITE, text: "", error: e.message }));
      return true;
    }
    if (msg.action === "injectImages") {
      handleInjectImages(msg.images).then(sendResponse).catch(e => sendResponse({ status: "error", error: e.message }));
      return true;
    }
    if (msg.action === "checkCompletion") {
      const text = getLastResponseText();
      const startMarker = msg.startMarker || "ARENA_START";
      const doneMarker = msg.doneMarker || "ARENA_DONE";
      const tail = text.trimEnd().slice(-200);
      sendResponse({
        site: SITE,
        hasStart: text.includes(startMarker),
        hasDone: tail.includes(doneMarker),
        textLength: text.length
      });
      return false;
    }
    if (msg.action === "checkStreaming") {
      sendResponse({ site: SITE, streaming: isStreaming() });
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

function getLastResponseText() {
  const responses = queryBySelectors("response", { all: true });
  if (responses.length > 0) return responses[responses.length - 1].textContent || "";
  return "";
}

function isStreaming() {
  return !!queryBySelectors("streaming");
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
    const el = queryBySelectors("input");
    if (!el) return { site: SITE, status: "error", error: "未找到输入框" };

    await robustInject(el, text);

    for (let attempt = 0; attempt < 8; attempt++) {
      await sleep(500);
      const btn = findSendButton();
      if (btn && !btn.disabled) {
        btn.click();
        return { site: SITE, status: "sent" };
      }
    }
    return { site: SITE, status: "inputted", error: "已输入，发送按钮不可用" };
  } catch (e) {
    return { site: SITE, status: "error", error: e.message };
  }
}

async function readLatestResponse() {
  // v6: streaming 检测已由 sidepanel 轮询负责，此处仅短暂等待 DOM 稳定
  await sleep(500);

  const responses = queryBySelectors("response", { all: true });
  if (responses.length > 0) return stripMarkers(responses[responses.length - 1].innerText.trim());

  const markdownBlocks = document.querySelectorAll(".markdown.prose");
  if (markdownBlocks.length > 0) return stripMarkers(markdownBlocks[markdownBlocks.length - 1].innerText.trim());

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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
