// AI Arena — popup 群聊渲染 + 输入处理
(function () {
  // v4.6.7 F17: popup 启动时主动告知 SW 自己的 windowId — MV3 SW 30s 空闲被回收时
  // ChatBus.popupWindowId 重建为 null，需要 popup 主动重新注册才能让 focusPopup
  // 等依赖 popupWindowId 的功能恢复（sendToPopup 已改为始终 broadcast 不依赖此 id）。
  try {
    chrome.windows.getCurrent().then(w => {
      if (w?.id != null) {
        chrome.runtime.sendMessage({ type: "popupReady", windowId: w.id }).catch(() => {});
      }
    }).catch(() => {});
  } catch (_) {}

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
  const BRAND_SVG = {
    huawei: "icons/brands/huawei.png",
    claude: "icons/brands/claude.svg",
    gemini: "icons/brands/gemini.svg",
    chatgpt: "icons/brands/openai.svg",
    deepseek: "icons/brands/deepseek.svg",
    doubao: "icons/brands/doubao.svg",
    qwen: "icons/brands/qwen.svg",
    kimi: "icons/brands/kimi.svg",
    yuanbao: "icons/brands/yuanbao.svg",
    grok: "icons/brands/grok.svg",
  };
  // v4.8.7: Q 版英雄卡牌（webp，~17KB/张），主对话气泡头像优先用；
  // BRAND_SVG 仍保留作为 fallback（新增 AI 还没卡牌时降级）
  const HERO_LOGO = {
    huawei:   "icons/heroes/huawei.webp",
    claude:   "icons/heroes/claude.webp",
    gemini:   "icons/heroes/gemini.webp",
    chatgpt:  "icons/heroes/chatgpt.webp",
    deepseek: "icons/heroes/deepseek.webp",
    doubao:   "icons/heroes/doubao.webp",
    qwen:     "icons/heroes/qwen.webp",
    kimi:     "icons/heroes/kimi.webp",
    yuanbao:  "icons/heroes/yuanbao.webp",
    grok:     "icons/heroes/grok.webp",
  };
  function brandLogoHtml(id) {
    const src = HERO_LOGO[id] || BRAND_SVG[id];
    if (!src) return `<span class="msg-avatar-fallback ${id || ""}">${AVATAR_INITIAL[id] || "?"}</span>`;
    return `<img src="${src}" alt="${id}" class="brand-logo">`;
  }
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
    // v4.6.13 F20: 同 msgId 已存在 → 更新文本（用于辩论 pending 占位 → 正式状态过渡）
    // 避免同一辩论按下产生两条 user 气泡（先 "正在发起..." 后 "第 N 轮辩论"）
    if (msgId) {
      const existing = $messages.querySelector(`.msg.me[data-msg-id="${CSS.escape(msgId)}"]`);
      if (existing) {
        const bubble = existing.querySelector(".msg-bubble");
        if (bubble) bubble.textContent = text;
        return;
      }
    }
    const ts = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    const row = document.createElement("div");
    row.className = "msg me";
    row.dataset.msgId = msgId;
    row.innerHTML = `
      <div class="msg-body">
        <div class="msg-meta me-meta">
          <span class="acts"><button data-act="copy" title="复制">📋</button></span>
          <span class="stat done"><span class="pip"></span>已发送</span>
          <span class="time">${escapeHtml(ts)}</span>
          <span class="name">我 · Huawei</span>
        </div>
        <div class="msg-bubble">${escapeHtml(text)}</div>
      </div>
      <div class="msg-avatar huawei">${brandLogoHtml('huawei')}</div>`;
    $messages.appendChild(row);
    // 用户自己发的消息：强制跳底（即使之前在浏览历史也跳到自己刚发的消息）
    scrollToBottomForce();
    autoFollow = true; // 用户主动发送 → 恢复 follow 模式
  }

  function appendAIBubble(msgId, participantId, initialText = "", isTyping = true) {
    ensureEmptyHidden();
    const ts = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    const row = document.createElement("div");
    row.className = "msg ai";
    row.dataset.msgId = msgId;
    row.dataset.participantId = participantId;
    const avatarClass = AVATAR_CLASS[participantId] || "";
    const name = NAME[participantId] || participantId;
    const statClass = isTyping ? "streaming" : "done";
    const statText = isTyping ? "提取中" : "已完成";
    row.innerHTML = `
      <div class="msg-avatar ${avatarClass}">${brandLogoHtml(participantId)}</div>
      <div class="msg-body">
        <div class="msg-meta">
          <span class="name">${name}</span>
          <span class="time">${escapeHtml(ts)}</span>
          <span class="stat ${statClass}"><span class="pip"></span>${statText}</span>
          <span class="acts">
            <button data-act="reextract" title="重新提取">🔄</button>
            <button data-act="resend" title="重新发送">📤</button>
            <button data-act="skip" title="跳过本轮（避免卡住流程）">⏭</button>
            <button data-act="copy" title="复制">📋</button>
            <button data-act="jump" title="跳原页">↗</button>
          </span>
        </div>
        <div class="msg-bubble">${isTyping ? `<span class="msg-typing"><span></span><span></span><span></span></span>` : renderMarkdown(initialText)}</div>
      </div>`;
    $messages.appendChild(row);
    bubbleByKey.set(`${msgId}-${participantId}`, row);
    // v4.3.6: 如果是非 typing 初始化（restoreLog 重放）且 initialText 已完整，应用折叠
    if (!isTyping && initialText) {
      const bubble = row.querySelector(".msg-bubble");
      if (bubble) applyFoldClass(bubble, initialText, true);
    }
    scrollToBottom();
    return row;
  }

  // v4.3.6: AI 长文折叠（>800 字且已完成时显示"展开全文"按钮）
  const FOLD_THRESHOLD = 800;
  function applyFoldClass(bubble, text, isDone) {
    if (!bubble) return;
    // 移除旧 toggle
    bubble.querySelectorAll(".msg-fold-toggle").forEach(el => el.remove());
    if (!isDone || (text || "").length <= FOLD_THRESHOLD) {
      bubble.classList.remove("msg-bubble-foldable", "expanded");
      return;
    }
    bubble.classList.add("msg-bubble-foldable");
    bubble.classList.remove("expanded");  // 完成时默认折叠
    const btn = document.createElement("button");
    btn.className = "msg-fold-toggle";
    btn.dataset.act = "fold-toggle";
    btn.innerHTML = `<span class="msg-fold-icon">▾</span> 展开全文 <span class="msg-fold-count">${(text || "").length} 字</span>`;
    bubble.appendChild(btn);
  }

  function updateAIBubble(msgId, participantId, text, isDone, hasRichContent, richTypes) {
    const row = bubbleByKey.get(`${msgId}-${participantId}`);
    if (!row) return appendAIBubble(msgId, participantId, text, !text);
    const bubble = row.querySelector(".msg-bubble");
    const stat = row.querySelector(".msg-meta .stat");
    if (!bubble) return;
    bubble.innerHTML = text ? renderMarkdown(text) : `<span class="msg-typing"><span></span><span></span><span></span></span>`;
    if (text) applyFoldClass(bubble, text, isDone);
    if (stat) {
      if (isDone) {
        stat.className = "stat done";
        stat.innerHTML = `<span class="pip"></span>已完成`;
      } else if (text) {
        stat.className = "stat streaming";
        stat.innerHTML = `<span class="pip"></span>提取中`;
      }
    }
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

  // ── 智能 auto-follow 滚动 ──
  // 用户贴底时自动跟随新消息；用户向上滚浏览历史时停止跟随，回到接近底部时恢复
  const FOLLOW_THRESHOLD_PX = 80;  // 距底 < 80px 视为"贴底"
  let autoFollow = true;
  $messages?.addEventListener("scroll", () => {
    const distFromBottom = $messages.scrollHeight - $messages.scrollTop - $messages.clientHeight;
    autoFollow = distFromBottom < FOLLOW_THRESHOLD_PX;
  });

  function scrollToBottom(force = false) {
    if (force || autoFollow) {
      $messages.scrollTop = $messages.scrollHeight;
    }
  }
  function scrollToBottomForce() { scrollToBottom(true); }

  // 暴露给 history 侧栏：点击跳转条目时临时停 follow（避免流式更新打断阅读）
  window.ChatScroll = {
    pauseFollow: () => { autoFollow = false; },
    resumeFollow: () => { autoFollow = true; scrollToBottomForce(); },
    isFollowing: () => autoFollow,
  };

  // ── @mention 自动补全 ──
  // v4.3.4: 只列已加入的参与者，不再列全部 9 个 AI
  let joinedServices = [];  // 由 stateUpdate 同步
  function refreshJoinedFromState() {
    chrome.runtime.sendMessage({ type: "getState" }, (state) => {
      const set = new Set();
      (state?.participants || []).forEach(p => set.add(p.service));
      joinedServices = [...set];
    });
  }
  refreshJoinedFromState();
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "stateUpdate") refreshJoinedFromState();
  });
  function currentMentionCandidates() {
    return joinedServices.map(id => ({ id, name: NAME[id] || id }));
  }

  let mentionActive = false;
  let mentionStart = -1;

  function detectMentionTrigger() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (range.startContainer.nodeType !== 3) return null;
    const text = range.startContainer.textContent.slice(0, range.startOffset);
    const m = text.match(/@(\w*)$/);
    return m ? { query: m[1], offset: m.index } : null;
  }

  function showMentionMenu(query) {
    const q = query.toLowerCase();
    const candidates = currentMentionCandidates();
    if (!candidates.length) return hideMentionMenu();
    const list = q
      ? candidates.filter(c => c.id.startsWith(q) || c.name.toLowerCase().startsWith(q))
      : candidates;
    if (!list.length) return hideMentionMenu();
    $mentionMenu.innerHTML = list.map((c, i) => `
      <div class="mention-item ${i === 0 ? 'active' : ''}" data-id="${c.id}">
        <img class="mention-logo" src="${BRAND_SVG[c.id] || ''}" alt="${c.id}">
        <span class="mention-name">${c.name}</span>
      </div>
    `).join("");
    $mentionMenu.hidden = false;
    mentionActive = true;
    $mentionMenu.querySelectorAll(".mention-item").forEach(el => {
      el.addEventListener("click", () => selectMention(el.dataset.id));
    });
  }

  function hideMentionMenu() {
    $mentionMenu.hidden = true;
    mentionActive = false;
  }

  function selectMention(id) {
    const text = $input.innerText;
    const replaced = text.replace(/@(\w*)$/, `@${NAME[id]} `);
    $input.innerText = replaced;
    // 光标移到末尾
    const range = document.createRange();
    range.selectNodeContents($input);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    hideMentionMenu();
    $input.focus();
  }

  $input.addEventListener("input", () => {
    const trigger = detectMentionTrigger();
    if (trigger) showMentionMenu(trigger.query);
    else hideMentionMenu();
  });

  // ── 输入 + 发送 ──
  function parseMentions(text) {
    const targets = [];
    let cleanText = text;
    const nameToId = Object.entries(NAME).reduce((acc, [id, name]) => {
      acc[name.toLowerCase()] = id;
      acc[id] = id;
      return acc;
    }, {});
    const re = /^@(\S+)\s+/;
    while (re.test(cleanText)) {
      const match = cleanText.match(re);
      const key = match[1].toLowerCase();
      const id = nameToId[key];
      if (!id) break;
      targets.push(id);
      cleanText = cleanText.replace(re, "");
    }
    return { targets, text: cleanText };
  }

  async function handleSend() {
    const raw = $input.innerText.trim();
    const { targets: mentionTargets, text } = parseMentions(raw);
    const targets = mentionTargets.length
      ? mentionTargets
      : (window.ChatRoster?.getSelected() || []);
    $input.innerText = "";

    // 任务模式分发：非 ask 走 ChatTaskMenu.dispatch
    const menu = window.ChatTaskMenu;
    if (menu && menu.current().task !== "ask") {
      // dispatch 内部已对失败做 alert，这里不再 warn
      menu.dispatch(text, targets);
      return;
    }

    if (!text) return;
    chrome.runtime.sendMessage({ type: "chatBroadcast", text, targets, images: [] }, (resp) => {
      if (chrome.runtime.lastError) console.warn(chrome.runtime.lastError);
    });
  }

  $send.addEventListener("click", handleSend);
  $input.addEventListener("keydown", (e) => {
    if (mentionActive) {
      const active = $mentionMenu.querySelector(".mention-item.active");
      if (e.key === "Enter" || e.key === "Tab") {
        if (active) {
          e.preventDefault();
          selectMention(active.dataset.id);
          return;
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        hideMentionMenu();
        return;
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = [...$mentionMenu.querySelectorAll(".mention-item")];
        const idx = items.indexOf(active);
        const next = e.key === "ArrowDown" ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
        items.forEach(el => el.classList.remove("active"));
        items[next].classList.add("active");
        return;
      }
    }
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
      // 同步清空左侧历史目录
      window.ChatHistory?.clear();
    });
  });

  // ── 顶部彻底初始化按钮 ⚡ ──
  document.getElementById("btn-hard-reset")?.addEventListener("click", () => {
    if (!confirm("⚡ 彻底初始化将：\n  · 移除全部已加入的 AI 参与者\n  · 清空群聊窗口\n  · 清空辩论轮次 / 总结上下文\n\n确认继续？")) return;
    chrome.runtime.sendMessage({ type: "hardReset" }, () => {
      // 同步清 popup 端 UI
      $messages.innerHTML = "";
      $messages.appendChild($empty);
      $empty.style.display = "";
      bubbleByKey.clear();
      window.ChatHistory?.clear();
      window.ChatMembers?.refresh?.();
      window.ChatStats?.refresh?.();
    });
  });

  // ── 接收 background 推送 ──
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "chatStreamUpdate") {
      const { msgId, role, participantId, text, isDone, hasRichContent, richTypes } = msg;
      if (role === "user") appendUserMessage(text, msgId);
      else updateAIBubble(msgId, participantId, text, isDone, hasRichContent, richTypes);
    } else if (msg.type === "chatLogPayload") {
      restoreLog(msg.messages);
    } else if (msg.type === "debateSummaryReady") {
      // v4.4.0: 裁判输出的 HTML 总结
      appendDebateSummaryCard(msg.html, msg.meta, msg.downloadId);
    }
  });

  // v4.4.0: 辩论总结 HTML 卡片
  function appendDebateSummaryCard(html, meta, downloadId) {
    ensureEmptyHidden();
    const row = document.createElement("div");
    row.className = "msg ai msg-summary";
    row.innerHTML = `
      <div class="msg-avatar" style="background:#0a5e3a;color:#fff;font-weight:700">📋</div>
      <div class="msg-body">
        <div class="msg-meta">
          <span class="name">辩论总结</span>
          <span class="time">${escapeHtml(meta?.date || "")}</span>
          <span class="stat done"><span class="pip"></span>已生成</span>
          <span class="acts">
            <button data-act="summary-toggle" title="展开/收起报告">▾ 查看完整报告</button>
            <button data-act="summary-open" title="在新标签页打开">↗</button>
            ${downloadId != null ? `<button data-act="summary-redownload" data-did="${downloadId}" title="再次下载">⬇</button>` : ""}
          </span>
        </div>
        <div class="msg-bubble summary-bubble">
          <div class="summary-pitch">
            <strong>${escapeHtml(meta?.topic || "辩论总结")}</strong>
            <span class="summary-pitch-meta">${escapeHtml(meta?.participants?.join(" · ") || "")} · ${escapeHtml(meta?.rounds || 0)} 轮</span>
          </div>
          <iframe class="summary-iframe" sandbox="allow-same-origin" srcdoc="${escapeAttr(html)}" style="display:none"></iframe>
        </div>
      </div>`;
    $messages.appendChild(row);
    // 保存 HTML 引用供 open 按钮使用
    row._summaryHtml = html;
    scrollToBottom();
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

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
