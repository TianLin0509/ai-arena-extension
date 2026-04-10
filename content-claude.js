// AI Arena — Content Script for claude.ai
const SITE = "claude";

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
    if (msg.action === "checkStreaming") {
      const streaming = isStreaming();
      sendResponse({ site: SITE, streaming });
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

function isStreaming() {
  return !!queryBySelectors("streaming");
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
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    const pasteEvent = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(pasteEvent);
    await sleep(200);
    if (el.innerText.trim().length > 0) return;
  } catch {}

  // 方法2: execCommand（广泛兼容）
  try {
    el.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, text);
    await sleep(200);
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

    // 等待 UI 响应，多试几次找按钮
    for (let attempt = 0; attempt < 8; attempt++) {
      await sleep(400);
      const btn = findSendButton();
      if (btn && !btn.disabled) {
        btn.click();
        return { site: SITE, status: "sent" };
      }
    }
    // 最后尝试 Enter 发送
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await sleep(200);
    return { site: SITE, status: "sent", error: "通过Enter发送" };
  } catch (e) {
    return { site: SITE, status: "error", error: e.message };
  }
}

async function readLatestResponse() {
  // 等待流式输出完成，最多 90 秒
  for (let i = 0; i < 90; i++) {
    if (isStreaming()) {
      await sleep(1000);
    } else {
      break;
    }
  }
  await sleep(800);

  // 多策略读取最后一条 AI 回答
  const text = getLastAssistantText();
  return text;
}

function getLastAssistantText() {
  // 优先使用 SelectorManager 配置的选择器
  const responses = queryBySelectors("response", { all: true });
  if (responses.length > 0) return responses[responses.length - 1].innerText.trim();

  // 策略 1: data-testid（旧版）
  const testIdMsgs = document.querySelectorAll("[data-testid='chat-message-content']");
  if (testIdMsgs.length > 0) return testIdMsgs[testIdMsgs.length - 1].innerText.trim();

  // 策略 2: .font-claude-message
  const claudeMsgs = document.querySelectorAll(".font-claude-message");
  if (claudeMsgs.length > 0) return claudeMsgs[claudeMsgs.length - 1].innerText.trim();

  // 策略 3: [data-is-streaming] 容器的父级（流式结束后仍保留）
  const streamContainers = document.querySelectorAll("[data-is-streaming]");
  if (streamContainers.length > 0) {
    const last = streamContainers[streamContainers.length - 1];
    const text = last.innerText.trim();
    if (text) return text;
  }

  // 策略 4: 对话区域内所有 .prose / .markdown 块
  const proseBlocks = document.querySelectorAll(".prose, .markdown");
  if (proseBlocks.length > 0) return proseBlocks[proseBlocks.length - 1].innerText.trim();

  // 策略 5: 通用 — 找对话容器内最后一个较长文本块
  const allBlocks = document.querySelectorAll('[class*="message"], [class*="response"], [class*="assistant"]');
  for (let i = allBlocks.length - 1; i >= 0; i--) {
    const text = allBlocks[i].innerText.trim();
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
