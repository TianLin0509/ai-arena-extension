// AI Arena — Content Script for chatgpt.com
const SITE = "chatgpt";

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

function isStreaming() {
  return !!(
    document.querySelector('button[aria-label="Stop generating"]') ||
    document.querySelector('button[aria-label="Stop streaming"]') ||
    document.querySelector('[data-testid="stop-button"]')
  );
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
    const el =
      document.querySelector("#prompt-textarea") ||
      document.querySelector("textarea") ||
      document.querySelector("[contenteditable='true']");
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
  for (let i = 0; i < 90; i++) {
    if (isStreaming()) await sleep(1000);
    else break;
  }
  await sleep(800);

  const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
  if (messages.length > 0) return messages[messages.length - 1].innerText.trim();

  const markdownBlocks = document.querySelectorAll(".markdown.prose");
  if (markdownBlocks.length > 0) return markdownBlocks[markdownBlocks.length - 1].innerText.trim();

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
  return (
    document.querySelector('[data-testid="send-button"]') ||
    document.querySelector('button[aria-label="Send prompt"]') ||
    document.querySelector('button[aria-label="Send"]') ||
    (() => {
      const buttons = document.querySelectorAll("button");
      for (const btn of buttons) {
        const rect = btn.getBoundingClientRect();
        if (rect.bottom > window.innerHeight - 150 && btn.querySelector("svg")) return btn;
      }
      return null;
    })()
  );
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
