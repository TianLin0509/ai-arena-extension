// AI Arena — Content Script for chat.deepseek.com
const SITE = "deepseek";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    if (msg.action === "ping") { sendResponse({ ready: true }); return false; }
    if (msg.action === "inject") { injectAndSend(msg.text).then(sendResponse).catch(e => sendResponse({ site: SITE, status: "error", error: e.message })); return true; }
    if (msg.action === "readResponse") { readLatestResponse().then(r => sendResponse({ site: SITE, text: r })).catch(e => sendResponse({ site: SITE, text: "", error: e.message })); return true; }
    if (msg.action === "injectImages") { handleInjectImages(msg.images).then(sendResponse).catch(e => sendResponse({ status: "error", error: e.message })); return true; }
    if (msg.action === "checkStreaming") {
      const streaming = !!(
        document.querySelector('.ds-loading') ||
        document.querySelector('button[aria-label="Stop generating"]') ||
        document.querySelector('button[aria-label="Stop"]')
      );
      sendResponse({ site: SITE, streaming });
      return false;
    }
    if (msg.action === "readFullConversation") { sendResponse({ site: SITE, turns: readFullConversation() }); return false; }
  } catch (e) { sendResponse({ site: SITE, status: "error", error: e.message }); return false; }
});

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
  el.innerHTML = text.split("\n").map(l => `<p>${l || "<br>"}</p>`).join("");
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function injectAndSend(text) {
  try {
    // DeepSeek 用 textarea 作为输入框
    const el =
      document.querySelector('#chat-input') ||
      document.querySelector('textarea[placeholder]') ||
      document.querySelector('textarea') ||
      document.querySelector('[contenteditable="true"]');
    if (!el) return { site: SITE, status: "error", error: "未找到输入框" };

    await robustInject(el, text);

    for (let attempt = 0; attempt < 8; attempt++) {
      await sleep(400);
      const btn =
        document.querySelector('[data-testid="send-button"]') ||
        document.querySelector('button[aria-label*="Send"]') ||
        document.querySelector('button[aria-label*="发送"]') ||
        findSendButton();
      if (btn && !btn.disabled) { btn.click(); return { site: SITE, status: "sent" }; }
    }

    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    await sleep(100);
    el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    return { site: SITE, status: "sent" };
  } catch (e) {
    return { site: SITE, status: "error", error: e.message };
  }
}

async function readLatestResponse() {
  for (let i = 0; i < 90; i++) {
    if (document.querySelector('.ds-loading') || document.querySelector('button[aria-label="Stop generating"]') || document.querySelector('button[aria-label="Stop"]')) {
      await sleep(1000);
    } else break;
  }
  await sleep(800);

  const msgs = document.querySelectorAll('.ds-markdown, [class*="assistant-message"], [class*="bot-message"]');
  if (msgs.length > 0) return msgs[msgs.length - 1].innerText.trim();
  const prose = document.querySelectorAll('.markdown-body, .prose');
  if (prose.length > 0) return prose[prose.length - 1].innerText.trim();
  return "";
}

function readFullConversation() {
  const turns = [];
  // DeepSeek: user 消息用 .fbb737a4, AI 消息用 .ds-markdown
  const userMsgs = [...document.querySelectorAll('[class*="user-message"], [class*="human"], .fbb737a4')];
  const aiMsgs = [...document.querySelectorAll('.ds-markdown, [class*="assistant-message"], [class*="bot-message"]')];
  const len = Math.max(userMsgs.length, aiMsgs.length);
  for (let i = 0; i < len; i++) {
    if (userMsgs[i]) turns.push({ role: "user", text: userMsgs[i].innerText.trim() });
    if (aiMsgs[i]) turns.push({ role: "assistant", text: aiMsgs[i].innerText.trim() });
  }
  return turns;
}

function findSendButton() {
  const btns = [...document.querySelectorAll("button")];
  return btns.filter(b => b.getBoundingClientRect().bottom > window.innerHeight - 150 && b.querySelector("svg")).pop() || null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
