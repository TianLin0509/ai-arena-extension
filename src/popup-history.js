// AI Arena — popup 左侧对话目录
(function () {
  const $list = document.getElementById("sidebar-list");
  const $count = document.getElementById("sidebar-count");
  const $toggle = document.getElementById("sidebar-toggle");
  const $sidebar = document.getElementById("chat-sidebar");
  if (!$list || !$count) return;

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
  }
  function previewOf(text) {
    return (text || "").slice(0, 40);
  }

  function renderEmpty() {
    $list.innerHTML = '<div class="sidebar-empty">暂无对话</div>';
    $count.textContent = "0";
  }

  function renderAll(messages) {
    const userMsgs = (messages || []).filter(m => m.role === "user");
    if (!userMsgs.length) return renderEmpty();
    $list.innerHTML = userMsgs.map((m, idx) => `
      <div class="sidebar-item" data-msg-id="${escapeHtml(m.msgId || "")}">
        <div class="sidebar-item-head">
          <span class="sidebar-item-num">#${idx + 1}</span>
          <span class="sidebar-item-time">${fmtTime(m.ts || Date.now())}</span>
        </div>
        <div class="sidebar-item-text">${escapeHtml(previewOf(m.text))}</div>
      </div>
    `).join("");
    $count.textContent = String(userMsgs.length);
  }

  function appendItem({ msgId, text, ts }) {
    const empty = $list.querySelector(".sidebar-empty");
    if (empty) empty.remove();
    const idx = $list.children.length + 1;
    const div = document.createElement("div");
    div.className = "sidebar-item";
    div.dataset.msgId = msgId || "";
    div.innerHTML = `
      <div class="sidebar-item-head">
        <span class="sidebar-item-num">#${idx}</span>
        <span class="sidebar-item-time">${fmtTime(ts || Date.now())}</span>
      </div>
      <div class="sidebar-item-text">${escapeHtml(previewOf(text))}</div>`;
    $list.appendChild(div);
    $count.textContent = String(idx);
    // 跟随：新条目滚到 sidebar 底部
    $list.scrollTop = $list.scrollHeight;
  }

  // 点击 item → 滚到对应消息 + 高亮
  $list.addEventListener("click", (e) => {
    const item = e.target.closest(".sidebar-item");
    if (!item) return;
    const msgId = item.dataset.msgId;
    if (!msgId) return;
    const row = document.querySelector(`.msg[data-msg-id="${CSS.escape(msgId)}"]`);
    if (!row) return;
    // 临时禁用 auto-follow，防止流式更新打断阅读
    window.ChatScroll?.pauseFollow();
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    // 高亮 1.5s
    row.classList.add("msg-highlight");
    setTimeout(() => row.classList.remove("msg-highlight"), 1600);
    // 切换 active 样式
    [...$list.querySelectorAll(".sidebar-item")].forEach(el => el.classList.remove("active"));
    item.classList.add("active");
  });

  // 折叠/展开
  $toggle?.addEventListener("click", () => {
    $sidebar.classList.toggle("collapsed");
    $toggle.textContent = $sidebar.classList.contains("collapsed") ? "›" : "‹";
    try { chrome.storage.local.set({ sidebarCollapsed: $sidebar.classList.contains("collapsed") }); } catch {}
  });
  // 恢复折叠状态
  try {
    chrome.storage.local.get("sidebarCollapsed", (data) => {
      if (data.sidebarCollapsed) {
        $sidebar.classList.add("collapsed");
        if ($toggle) $toggle.textContent = "›";
      }
    });
  } catch {}

  // 监听 background 推送
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "chatStreamUpdate" && msg.role === "user") {
      appendItem({ msgId: msg.msgId, text: msg.text, ts: Date.now() });
    } else if (msg.type === "chatLogPayload") {
      renderAll(msg.messages || []);
    }
  });

  // 启动加载历史
  chrome.runtime.sendMessage({ type: "chatRestoreLog" }, (resp) => {
    if (resp?.messages) renderAll(resp.messages);
  });

  // 暴露 API（清空时调用）
  window.ChatHistory = { renderAll, appendItem, clear: renderEmpty };
})();
