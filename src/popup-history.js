// AI Arena — popup 左侧对话目录
// v4.3.0：默认只显示用户提问；每条下方有"▾ N 条回答"按钮可内联展开 AI 回答
(function () {
  const $list = document.getElementById("sidebar-list");
  const $count = document.getElementById("sidebar-count");
  const $toggle = document.getElementById("sidebar-toggle");
  const $sidebar = document.getElementById("chat-sidebar");
  const $search = document.getElementById("sidebar-search");
  const $modeToggle = document.getElementById("sidebar-mode-toggle");
  const $grabber = document.getElementById("sidebar-grabber");
  if (!$list || !$count) return;

  // v4.3.0：隐藏不再需要的 mode toggle
  if ($modeToggle) $modeToggle.style.display = "none";

  // AI 显示名（与 popup.js 一致）
  const NAME = {
    claude: "Claude", gemini: "Gemini", chatgpt: "ChatGPT",
    deepseek: "DeepSeek", doubao: "豆包", qwen: "千问",
    kimi: "Kimi", yuanbao: "元宝", grok: "Grok",
  };
  const BRAND_LOGO = {
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

  // ── 状态 ──
  let allLog = [];                 // 完整 chatLog 副本（user + ai 完成态）
  let query = "";
  const expandedMsgs = new Set();  // 展开了 AI 回答的 user msgId 集合

  // ── 工具 ──
  function escapeHtml(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
  }
  function fmtDateGroup(ts) {
    const d = new Date(ts);
    const today = new Date(); today.setHours(0,0,0,0);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    const dT = new Date(d); dT.setHours(0,0,0,0);
    if (dT.getTime() === today.getTime()) return "今天";
    if (dT.getTime() === yesterday.getTime()) return "昨天";
    return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
  }
  function previewOf(text, n = 60) {
    return (text || "").slice(0, n);
  }
  function highlightQuery(text, q) {
    const safe = escapeHtml(text);
    if (!q) return safe;
    const lcText = text.toLowerCase();
    const lcQ = q.toLowerCase();
    const idx = lcText.indexOf(lcQ);
    if (idx < 0) return safe;
    return escapeHtml(text.slice(0, idx))
      + `<mark>${escapeHtml(text.slice(idx, idx + q.length))}</mark>`
      + escapeHtml(text.slice(idx + q.length));
  }

  // 把 log 按"对话回合"组织：以每条 user 消息为锚，下面挂相关 AI 回答
  function buildTurns() {
    const turns = [];
    let cur = null;
    for (const m of allLog) {
      if (m.role === "user") {
        // v4.8.2: 跳过 F20/F21 的 pending 占位（background.js 推的"· 正在发起..."文本）
        //         真实辩论/总结 user msg 随后会到达，时间轴只显示一条
        // v4.8.32: 跳过"🔄 重发原题：..." / "🔄 重发：..." 占位 — 重发的 AI 回答应合入第一次发送的 turn，
        //          不应单独占用时间轴条目
        if (typeof m.text === "string" &&
            (/·\s*正在发起\.\.\.$/.test(m.text) || /^🔄\s*重发(?:原题)?\s*[:：]/.test(m.text))) {
          continue;
        }
        cur = { user: m, replies: [] };
        turns.push(cur);
      } else if (m.role === "ai") {
        if (cur) cur.replies.push(m);
        else {
          // 没有前置 user 的孤立 AI（理论上少见）
          turns.push({ user: null, replies: [m] });
        }
      }
    }
    return turns;
  }

  function matchTurn(turn, q) {
    if (!q) return true;
    const lc = q.toLowerCase();
    if (turn.user && (turn.user.text || "").toLowerCase().includes(lc)) return true;
    return turn.replies.some(r => (r.text || "").toLowerCase().includes(lc));
  }

  function renderList() {
    const allTurns = buildTurns();
    const turns = query ? allTurns.filter(t => matchTurn(t, query)) : allTurns;
    $count.textContent = String(turns.length);
    if (!turns.length) {
      $list.innerHTML = `<div class="sidebar-empty">${query ? "无匹配" : "暂无对话"}</div>`;
      return;
    }
    // 按时间分组
    const groupOrder = [];
    const groups = new Map();
    turns.forEach(t => {
      const ts = t.user?.ts || t.replies[0]?.ts || Date.now();
      const g = fmtDateGroup(ts);
      if (!groups.has(g)) { groups.set(g, []); groupOrder.push(g); }
      groups.get(g).push(t);
    });

    let html = "";
    let idx = 0;
    for (const g of groupOrder) {
      html += `<div class="sidebar-group-label">${escapeHtml(g)}</div>`;
      groups.get(g).forEach(t => {
        idx++;
        const u = t.user;
        const isExpanded = u?.msgId && expandedMsgs.has(u.msgId);
        const replyCount = t.replies.length;
        const userTs = u?.ts || t.replies[0]?.ts || Date.now();
        const userText = u?.text || "(无提问)";
        const msgId = u?.msgId || `orphan-${idx}`;
        html += `<div class="sidebar-turn" data-msg-id="${escapeHtml(msgId)}">
          <div class="sidebar-item" data-msg-id="${escapeHtml(msgId)}" data-role="user">
            <div class="sidebar-item-head">
              <span class="sidebar-item-num">#${idx}</span>
              <span class="sidebar-item-time">${fmtTime(userTs)}</span>
              ${replyCount > 0
                ? `<button class="sidebar-toggle-replies" data-msg-id="${escapeHtml(msgId)}" title="${isExpanded ? "折叠" : "展开"} AI 回答">${isExpanded ? "▾" : "▸"} ${replyCount}</button>`
                : `<span class="sidebar-item-pending" title="尚无回答">…</span>`}
            </div>
            <div class="sidebar-item-text">${highlightQuery(previewOf(userText, 70), query)}</div>
          </div>`;
        if (isExpanded && t.replies.length) {
          html += `<div class="sidebar-replies">`;
          for (const r of t.replies) {
            const brand = BRAND_LOGO[r.participantId];
            const aiName = NAME[r.participantId] || r.participantId || "AI";
            html += `<div class="sidebar-reply" data-msg-id="${escapeHtml(r.msgId)}" data-role="ai" data-participant="${escapeHtml(r.participantId || "")}">
              ${brand ? `<img class="sidebar-reply-logo" src="${brand}" alt="${escapeHtml(aiName)}">` : `<span class="sidebar-reply-logo-fallback">${escapeHtml(aiName[0] || "?")}</span>`}
              <div class="sidebar-reply-body">
                <div class="sidebar-reply-name">${escapeHtml(aiName)}</div>
                <div class="sidebar-reply-text">${highlightQuery(previewOf(r.text, 80), query)}</div>
              </div>
            </div>`;
          }
          html += `</div>`;
        }
        html += `</div>`;
      });
    }
    $list.innerHTML = html;
  }

  // ── 搜索 ──
  let searchDebounce = null;
  $search?.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      query = $search.value.trim();
      renderList();
    }, 80);
  });

  // ── 点击跳转 + 展开折叠 ──
  $list.addEventListener("click", (e) => {
    // 展开 / 折叠 AI 回答
    const toggleBtn = e.target.closest(".sidebar-toggle-replies");
    if (toggleBtn) {
      e.stopPropagation();
      const mid = toggleBtn.dataset.msgId;
      if (expandedMsgs.has(mid)) expandedMsgs.delete(mid);
      else expandedMsgs.add(mid);
      renderList();
      return;
    }
    // 点 user 条目跳转
    const userItem = e.target.closest(".sidebar-item[data-role=user]");
    if (userItem) {
      const msgId = userItem.dataset.msgId;
      scrollToMsg(msgId, null);
      [...$list.querySelectorAll(".sidebar-item")].forEach(el => el.classList.remove("active"));
      userItem.classList.add("active");
      return;
    }
    // 点 AI 回答跳转
    const reply = e.target.closest(".sidebar-reply[data-role=ai]");
    if (reply) {
      const msgId = reply.dataset.msgId;
      const participant = reply.dataset.participant;
      scrollToMsg(msgId, participant);
    }
  });

  function scrollToMsg(msgId, participant) {
    if (!msgId) return;
    const sel = participant
      ? `.msg.ai[data-msg-id="${CSS.escape(msgId)}"][data-participant-id="${CSS.escape(participant)}"]`
      : `.msg[data-msg-id="${CSS.escape(msgId)}"]`;
    const row = document.querySelector(sel);
    if (!row) return;
    window.ChatScroll?.pauseFollow();
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.add("msg-highlight");
    setTimeout(() => row.classList.remove("msg-highlight"), 1600);
  }

  // ── 右键复制 ──
  $list.addEventListener("contextmenu", (e) => {
    const reply = e.target.closest(".sidebar-reply");
    const item = e.target.closest(".sidebar-item");
    const target = reply || item;
    if (!target) return;
    e.preventDefault();
    const msgId = target.dataset.msgId;
    const role = target.dataset.role || (reply ? "ai" : "user");
    const participant = target.dataset.participant;
    const entry = allLog.find(m =>
      m.msgId === msgId && m.role === role &&
      (role !== "ai" || m.participantId === participant)
    );
    if (!entry?.text) return;
    navigator.clipboard.writeText(entry.text).then(() => {
      const badge = document.createElement("span");
      badge.className = "sidebar-toast";
      badge.textContent = "✓ 已复制";
      target.appendChild(badge);
      setTimeout(() => badge.remove(), 1200);
    }).catch(() => {});
  });

  // ── 折叠 / 展开 整个 sidebar ──
  $toggle?.addEventListener("click", () => {
    $sidebar.classList.toggle("collapsed");
    $toggle.textContent = $sidebar.classList.contains("collapsed") ? "›" : "‹";
    try { chrome.storage.local.set({ sidebarCollapsed: $sidebar.classList.contains("collapsed") }); } catch {}
  });

  // ── Drag resize ──
  if ($grabber) {
    let resizing = false, startX = 0, startW = 0;
    $grabber.addEventListener("mousedown", (e) => {
      if ($sidebar.classList.contains("collapsed")) return;
      resizing = true;
      startX = e.clientX;
      startW = $sidebar.offsetWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!resizing) return;
      const newW = Math.max(160, Math.min(400, startW + (e.clientX - startX)));
      $sidebar.style.flex = `0 0 ${newW}px`;
      $sidebar.style.width = `${newW}px`;
    });
    document.addEventListener("mouseup", () => {
      if (!resizing) return;
      resizing = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try { chrome.storage.local.set({ sidebarWidth: $sidebar.offsetWidth }); } catch {}
    });
  }

  // ── 恢复持久化状态 ──
  try {
    chrome.storage.local.get(["sidebarCollapsed", "sidebarWidth"], (data) => {
      if (data.sidebarCollapsed) {
        $sidebar.classList.add("collapsed");
        if ($toggle) $toggle.textContent = "›";
      } else if (data.sidebarWidth && Number.isFinite(data.sidebarWidth)) {
        $sidebar.style.flex = `0 0 ${data.sidebarWidth}px`;
        $sidebar.style.width = `${data.sidebarWidth}px`;
      }
    });
  } catch {}

  // ── 数据流 ──
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "chatStreamUpdate") {
      const { msgId, role, participantId, text, isDone } = msg;
      const ts = Date.now();
      if (role === "user") {
        allLog.push({ msgId, role, text, ts });
        renderList();
      } else if (role === "ai" && isDone && text) {
        const i = allLog.findIndex(m => m.role === "ai" && m.msgId === msgId && m.participantId === participantId);
        const entry = { msgId, role: "ai", participantId, text, ts };
        if (i >= 0) allLog[i] = entry;
        else allLog.push(entry);
        renderList();
      }
    } else if (msg.type === "chatLogPayload") {
      allLog = msg.messages || [];
      renderList();
    }
  });

  // 启动：拉历史
  chrome.runtime.sendMessage({ type: "chatRestoreLog" }, (resp) => {
    if (resp?.messages) {
      allLog = resp.messages;
      renderList();
    }
  });

  // 暴露 API（清空时调用）
  window.ChatHistory = {
    clear: () => { allLog = []; query = ""; expandedMsgs.clear(); if ($search) $search.value = ""; renderList(); },
    renderAll: (msgs) => { allLog = msgs || []; renderList(); },
  };
})();
