// AI Arena — Content Script for gemini.google.com
const SITE = "gemini";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    if (msg.action === "ping") { sendResponse({ ready: true }); return false; }
    if (msg.action === "inject") { injectAndSend(msg.text).then(sendResponse).catch(e => sendResponse({ site: SITE, status: "error", error: e.message })); return true; }
    if (msg.action === "readResponse") { readLatestResponse().then(r => sendResponse({ site: SITE, text: r })).catch(e => sendResponse({ site: SITE, text: "", error: e.message })); return true; }
    if (msg.action === "injectImages") { handleInjectImages(msg.images).then(sendResponse).catch(e => sendResponse({ status: "error", error: e.message })); return true; }
    if (msg.action === "checkStreaming") {
      const streaming = !!(
        document.querySelector("model-response .loading-indicator") ||
        document.querySelector("button[aria-label='Stop response']") ||
        document.querySelector(".thinking-indicator")
      );
      sendResponse({ site: SITE, streaming });
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
    // 找输入框 — Quill editor 或 contenteditable
    const el =
      document.querySelector(".ql-editor[contenteditable='true']") ||
      document.querySelector("rich-textarea .ql-editor") ||
      document.querySelector(".text-input-field textarea") ||
      document.querySelector("[contenteditable='true']");
    if (!el) return { site: SITE, status: "error", error: "未找到输入框" };

    await robustInject(el, text);

    for (let attempt = 0; attempt < 8; attempt++) {
      await sleep(400);
      const btn =
        document.querySelector('button[aria-label="Send message"]') ||
        document.querySelector('button[aria-label*="发送"]') ||
        document.querySelector('button.send-button') ||
        findSendButton();
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

async function readLatestResponse() {
  // 等待生成完成（检查 loading 指示器）
  for (let i = 0; i < 90; i++) {
    const loading =
      document.querySelector("model-response .loading-indicator") ||
      document.querySelector("button[aria-label='Stop response']") ||
      document.querySelector("button[aria-label*='Stop']") ||
      document.querySelector(".thinking-indicator");
    if (loading) {
      await sleep(1000);
    } else {
      break;
    }
  }
  // Gemini 流式结束后还有 Markdown 渲染延迟
  await sleep(1000);

  // 读取最后一条 model response
  const responses =
    document.querySelectorAll(".model-response-text .markdown") ||
    document.querySelectorAll(".response-container .markdown");
  if (responses.length > 0) {
    return responses[responses.length - 1].innerText.trim();
  }

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
  const buttons = document.querySelectorAll("button");
  for (const btn of buttons) {
    const rect = btn.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 150 && btn.querySelector("svg")) {
      return btn;
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
