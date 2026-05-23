// AI Arena — popup 左侧对话目录（搜索 / 时间分组 / drag-resize / 右键复制）
(function () {
  const $list = document.getElementById("sidebar-list");
  const $count = document.getElementById("sidebar-count");
  const $toggle = document.getElementById("sidebar-toggle");
  const $sidebar = document.getElementById("chat-sidebar");
  const $search = document.getElementById("sidebar-search");
  const $modeToggle = document.getElementById("sidebar-mode-toggle");
  const $grabber = document.getElementById("sidebar-grabber");
  if (!$list || !$count) return;

  // AI 显示名（与 popup.js 一致）
  const NAME = {
    claude: "Claude", gemini: "Gemini", chatgpt: "ChatGPT",
    deepseek: "DeepSeek", doubao: "豆包", qwen: "千问",
    kimi: "Kimi", yuanbao: "元宝", grok: "Grok",
  };

  // ── 状态 ──
  let allLog = [];                 // 完整 chatLog 副本（user + ai 完成态）
  let searchMode = "question";     // "question" 仅搜提问 | "global" 全局含 AI 回答
  let query = "";

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
  function previewOf(text) {
    return (text || "").slice(0, 48);
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

  function getDisplayItems() {
    let items = searchMode === "global"
      ? allLog.filter(m => !!m.text)   // 全局：user + ai 都展示
      : allLog.filter(m => m.role === "user");
    if (query) {
      const q = query.toLowerCase();
      items = items.filter(m => (m.text || "").toLowerCase().includes(q));
    }
    return items;
  }

  function renderList() {
    const items = getDisplayItems();
    $count.textContent = String(items.length);
    if (!items.length) {
      $list.innerHTML = `<div class="sidebar-empty">${query ? "无匹配" : "暂无对话"}</div>`;
      return;
    }
    // 按时间分组（今天 / 昨天 / 更早）
    const groupOrder = [];
    const groups = new Map();
    items.forEach(m => {
      const g = fmtDateGroup(m.ts || Date.now());
      if (!groups.has(g)) { groups.set(g, []); groupOrder.push(g); }
      groups.get(g).push(m);
    });
    let html = "";
    let globalIdx = 0;
    for (const g of groupOrder) {
      html += `<div class="sidebar-group-label">${escapeHtml(g)}</div>`;
      groups.get(g).forEach(m => {
        globalIdx++;
        const isAi = m.role === "ai";
        const roleLabel = isAi ? (NAME[m.participantId] || m.participantId || "AI") : "我";
        html += `<div class="sidebar-item ${isAi ? "is-ai" : ""}" data-msg-id="${escapeHtml(m.msgId || "")}" data-role="${m.role}" data-participant="${escapeHtml(m.participantId || "")}">
          <div class="sidebar-item-head">
            <span class="sidebar-item-num">#${globalIdx}</span>
            <span class="sidebar-item-role ${isAi ? "role-ai" : "role-user"}">${escapeHtml(roleLabel)}</span>
            <span class="sidebar-item-time">${fmtTime(m.ts || Date.now())}</span>
          </div>
          <div class="sidebar-item-text">${highlightQuery(previewOf(m.text), query)}</div>
        </div>`;
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
  $modeToggle?.addEventListener("click", () => {
    searchMode = searchMode === "question" ? "global" : "question";
    $modeToggle.dataset.mode = searchMode;
    if (searchMode === "global") {
      $modeToggle.textContent = "🌐";
      $modeToggle.title = "全局搜索（含 AI 回答），点击切回仅搜提问";
    } else {
      $modeToggle.textContent = "❓";
      $modeToggle.title = "仅搜提问，点击切换全局（含 AI 回答）";
    }
    try { chrome.storage.local.set({ sidebarSearchMode: searchMode }); } catch {}
    renderList();
  });

  // ── 点击跳转 ──
  $list.addEventListener("click", (e) => {
    const item = e.target.closest(".sidebar-item");
    if (!item) return;
    const msgId = item.dataset.msgId;
    const role = item.dataset.role;
    const participant = item.dataset.participant;
    if (!msgId) return;
    const sel = role === "ai" && participant
      ? `.msg.ai[data-msg-id="${CSS.escape(msgId)}"][data-participant-id="${CSS.escape(participant)}"]`
      : `.msg[data-msg-id="${CSS.escape(msgId)}"]`;
    const row = document.querySelector(sel);
    if (!row) return;
    window.ChatScroll?.pauseFollow();
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.add("msg-highlight");
    setTimeout(() => row.classList.remove("msg-highlight"), 1600);
    [...$list.querySelectorAll(".sidebar-item")].forEach(el => el.classList.remove("active"));
    item.classList.add("active");
  });

  // ── 右键菜单：复制 ──
  $list.addEventListener("contextmenu", (e) => {
    const item = e.target.closest(".sidebar-item");
    if (!item) return;
    e.preventDefault();
    const msgId = item.dataset.msgId;
    const role = item.dataset.role;
    const participant = item.dataset.participant;
    const entry = allLog.find(m =>
      m.msgId === msgId && m.role === role &&
      (role !== "ai" || m.participantId === participant)
    );
    if (!entry?.text) return;
    navigator.clipboard.writeText(entry.text).then(() => {
      const badge = document.createElement("span");
      badge.className = "sidebar-toast";
      badge.textContent = "✓ 已复制";
      item.appendChild(badge);
      setTimeout(() => badge.remove(), 1200);
    }).catch(() => {});
  });

  // ── 折叠 / 展开 ──
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
    chrome.storage.local.get(["sidebarCollapsed", "sidebarWidth", "sidebarSearchMode"], (data) => {
      if (data.sidebarSearchMode === "global") {
        searchMode = "global";
        if ($modeToggle) {
          $modeToggle.textContent = "🌐";
          $modeToggle.dataset.mode = "global";
          $modeToggle.title = "全局搜索（含 AI 回答），点击切回仅搜提问";
        }
      }
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
    clear: () => { allLog = []; query = ""; if ($search) $search.value = ""; renderList(); },
    renderAll: (msgs) => { allLog = msgs || []; renderList(); },
  };
})();
