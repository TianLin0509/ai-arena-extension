// AI Arena — Content Script for claude.ai
const SITE = "claude";

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
  return !!(
    document.querySelector('[data-is-streaming="true"]') ||
    document.querySelector('.font-claude-message [data-is-streaming="true"]') ||
    document.querySelector('[class*="streaming"]') ||
    document.querySelector('button[aria-label="Stop Response"]') ||
    document.querySelector('button[aria-label="Stop response"]')
  );
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
    const el =
      document.querySelector("div.ProseMirror[contenteditable='true']") ||
      document.querySelector(".ProseMirror[contenteditable]") ||
      document.querySelector("[contenteditable='true']");
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
  // 优先级：aria-label > data-testid > form 内按钮 > 底部按钮
  return (
    document.querySelector('button[aria-label="Send Message"]') ||
    document.querySelector('button[aria-label="Send message"]') ||
    document.querySelector('button[data-testid="send-button"]') ||
    (() => {
      const buttons = document.querySelectorAll("button");
      for (const btn of buttons) {
        if (btn.querySelector('svg') && btn.closest("form")) return btn;
      }
      const allBtns = [...buttons];
      return allBtns.filter(b =>
        b.querySelector("svg") &&
        b.getBoundingClientRect().bottom > window.innerHeight - 200
      ).pop() || null;
    })()
  );
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
