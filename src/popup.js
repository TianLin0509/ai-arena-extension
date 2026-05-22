// AI Arena — popup 群聊渲染 + 输入处理
(function () {
  const $messages = document.getElementById("chat-messages");
  const $empty = document.getElementById("empty-state");
  const $input = document.getElementById("chat-input");
  const $send = document.getElementById("btn-send");
  const $clear = document.getElementById("btn-clear");
  const $mentionMenu = document.getElementById("mention-menu");

  const AVATAR_CLASS = {
    claude: "claude", gemini: "gemini", chatgpt: "chatgpt",
    deepseek: "deepseek", doubao: "doubao", qwen: "qwen",
    kimi: "kimi", yuanbao: "yuanbao", grok: "grok",
  };
  const AVATAR_INITIAL = {
    claude: "C", gemini: "G", chatgpt: "P",
    deepseek: "D", doubao: "豆", qwen: "千",
    kimi: "K", yuanbao: "元", grok: "X",
  };
  const NAME = {
    claude: "Claude", gemini: "Gemini", chatgpt: "ChatGPT",
    deepseek: "DeepSeek", doubao: "豆包", qwen: "千问",
    kimi: "Kimi", yuanbao: "元宝", grok: "Grok",
  };

  // ── 状态 ──
  // bubbleByKey: key = `${msgId}-${participantId}` → DOM element
  const bubbleByKey = new Map();

  // ── 渲染 ──
  function ensureEmptyHidden() {
    if ($empty && !$empty.classList.contains("hidden")) {
      $empty.style.display = "none";
    }
  }

  function appendUserMessage(text, msgId) {
    ensureEmptyHidden();
    const row = document.createElement("div");
    row.className = "msg me";
    row.dataset.msgId = msgId;
    row.innerHTML = `<div class="msg-body"><div class="msg-bubble">${escapeHtml(text)}</div></div>`;
    $messages.appendChild(row);
    scrollToBottom();
  }

  function appendAIBubble(msgId, participantId, initialText = "", isTyping = true) {
    ensureEmptyHidden();
    const row = document.createElement("div");
    row.className = "msg ai";
    row.dataset.msgId = msgId;
    row.dataset.participantId = participantId;
    const avatarClass = AVATAR_CLASS[participantId] || "";
    const initial = AVATAR_INITIAL[participantId] || "?";
    const name = NAME[participantId] || participantId;
    row.innerHTML = `
      <div class="msg-avatar ${avatarClass}">${initial}</div>
      <div class="msg-body">
        <div class="msg-name">${name}</div>
        <div class="msg-bubble">
          ${isTyping ? `<span class="msg-typing"><span></span><span></span><span></span></span>` : renderMarkdown(initialText)}
        </div>
      </div>`;
    $messages.appendChild(row);
    bubbleByKey.set(`${msgId}-${participantId}`, row);
    scrollToBottom();
    return row;
  }

  function updateAIBubble(msgId, participantId, text, isDone, hasRichContent, richTypes) {
    const row = bubbleByKey.get(`${msgId}-${participantId}`);
    if (!row) return appendAIBubble(msgId, participantId, text, !text);
    const bubble = row.querySelector(".msg-bubble");
    if (!bubble) return;
    bubble.innerHTML = text ? renderMarkdown(text) : `<span class="msg-typing"><span></span><span></span><span></span></span>`;
    if (isDone && hasRichContent && richTypes?.length) {
      const pill = document.createElement("a");
      pill.className = "msg-rich-pill";
      pill.dataset.participantId = participantId;
      pill.innerHTML = `📦 含 ${richTypes.join("/")} ↗ 在 ${NAME[participantId]} 查看`;
      pill.addEventListener("click", (e) => {
        e.preventDefault();
        chrome.runtime.sendMessage({ type: "chatJumpToOrigin", participantId });
      });
      bubble.appendChild(pill);
    }
    scrollToBottom();
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function scrollToBottom() {
    $messages.scrollTop = $messages.scrollHeight;
  }

  // ── 输入 + 发送 ──
  function parseMentions(text) {
    // "@Claude xxx" → { targets: ['claude'], text: 'xxx' }
    // 无 @ → { targets: [], text }
    const m = text.match(/^(?:@(\w+)\s+)+/);
    if (!m) return { targets: [], text };
    const targets = [];
    let cleanText = text;
    const re = /^@(\w+)\s+/;
    while (re.test(cleanText)) {
      const match = cleanText.match(re);
      const id = match[1].toLowerCase();
      if (AVATAR_INITIAL[id]) targets.push(id);
      cleanText = cleanText.replace(re, "");
    }
    return { targets, text: cleanText };
  }

  async function handleSend() {
    const raw = $input.innerText.trim();
    if (!raw) return;
    const { targets, text } = parseMentions(raw);
    $input.innerText = "";
    chrome.runtime.sendMessage({ type: "chatBroadcast", text, targets, images: [] }, (resp) => {
      if (chrome.runtime.lastError) console.warn(chrome.runtime.lastError);
    });
  }

  $send.addEventListener("click", handleSend);
  $input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  });
  $clear.addEventListener("click", () => {
    if (!confirm("清空群聊（不影响 AI 原页对话）？")) return;
    chrome.runtime.sendMessage({ type: "chatClear" }, () => {
      $messages.innerHTML = "";
      $messages.appendChild($empty);
      $empty.style.display = "";
      bubbleByKey.clear();
    });
  });

  // ── 接收 background 推送 ──
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "chatStreamUpdate") {
      const { msgId, role, participantId, text, isDone, hasRichContent, richTypes } = msg;
      if (role === "user") appendUserMessage(text, msgId);
      else updateAIBubble(msgId, participantId, text, isDone, hasRichContent, richTypes);
    } else if (msg.type === "chatLogPayload") {
      // Task 11: 历史回放
      restoreLog(msg.messages);
    }
  });

  function restoreLog(messages) {
    if (!messages?.length) return;
    ensureEmptyHidden();
    for (const m of messages) {
      if (m.role === "user") appendUserMessage(m.text, m.msgId);
      else appendAIBubble(m.msgId, m.participantId, m.text, false);
    }
  }

  // ── 启动 ──
  chrome.runtime.sendMessage({ type: "chatRestoreLog" }, (resp) => {
    if (resp?.messages?.length) restoreLog(resp.messages);
  });
})();
