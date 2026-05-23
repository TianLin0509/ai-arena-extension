// popup-stats.js — 统计 Tab：本次 / 累计 / 模型 三 sub-tab
(function () {
  const STATS_KEY = "arena_lifetime_stats";
  let activeSub = "session";
  const sessionStats = { conversations: 0, debates: 0, totalChars: 0 };
  let lifetimeStats = { conversations: 0, debates: 0, totalChars: 0, models: {} };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function charsToTokens(c) { return Math.round((c || 0) / 1.5); }
  function fmtNum(n) {
    if (n >= 10000) return (n / 10000).toFixed(1) + "w";
    if (n >= 1000) return (n / 1000).toFixed(1) + "k";
    return String(n);
  }

  function render() {
    const root = document.getElementById("rp-panel-stats");
    if (!root) return;
    root.innerHTML = `
      <div class="rp-substat-tabs">
        <div class="rp-substat-tab ${activeSub === "session" ? "active" : ""}" data-sub="session">本次</div>
        <div class="rp-substat-tab ${activeSub === "lifetime" ? "active" : ""}" data-sub="lifetime">累计</div>
        <div class="rp-substat-tab ${activeSub === "models" ? "active" : ""}" data-sub="models">模型</div>
      </div>
      ${renderBody()}
    `;
    root.querySelectorAll(".rp-substat-tab").forEach(b => {
      b.addEventListener("click", () => {
        activeSub = b.dataset.sub;
        render();
      });
    });
  }

  function renderBody() {
    if (activeSub === "models") {
      const models = lifetimeStats.models || {};
      const list = Object.entries(models).sort((a, b) => (b[1].chars || 0) - (a[1].chars || 0));
      if (!list.length) return `<div class="rp-empty">暂无模型统计数据</div>`;
      return list.map(([service, s]) => `
        <div class="rp-list-item">
          <span class="name">${escapeHtml(service)}</span>
          <span style="color:var(--ink-soft);font-size:11px">${fmtNum(charsToTokens(s.chars))} tk · ${s.rounds || 0} 轮</span>
        </div>
      `).join("");
    }
    const d = activeSub === "session" ? sessionStats : lifetimeStats;
    return `
      <div class="rp-stat-grid">
        <div class="rp-stat-cell">
          <div class="rp-stat-val">${d.conversations || 0}</div>
          <div class="rp-stat-lbl">对话</div>
        </div>
        <div class="rp-stat-cell">
          <div class="rp-stat-val">${d.debates || 0}</div>
          <div class="rp-stat-lbl">辩论轮</div>
        </div>
        <div class="rp-stat-cell" style="grid-column:span 2">
          <div class="rp-stat-val">${fmtNum(charsToTokens(d.totalChars))}</div>
          <div class="rp-stat-lbl">Token</div>
        </div>
      </div>
    `;
  }

  async function refresh() {
    try {
      const r = await new Promise(res => {
        chrome.storage.local.get([STATS_KEY], resp => res(resp || {}));
      });
      if (r[STATS_KEY]) {
        lifetimeStats = { ...lifetimeStats, ...r[STATS_KEY] };
        if (!lifetimeStats.models) lifetimeStats.models = {};
      }
    } catch (_) {}
    render();
  }

  // v4.3.4: popup-stats 自己监听 chatStreamUpdate 累计本次 session 统计
  // 不再依赖 sidepanel 推送
  const _seenUserMsgIds = new Set();
  const _seenAiMsgIds = new Set();   // 已计字数的 ai msgId+participant
  function recordSession(msg) {
    if (!msg) return;
    if (msg.role === "user" && msg.msgId && !_seenUserMsgIds.has(msg.msgId)) {
      _seenUserMsgIds.add(msg.msgId);
      sessionStats.conversations++;
      lifetimeStats.conversations = (lifetimeStats.conversations || 0) + 1;
      persistLifetime();
      render();
      return;
    }
    if (msg.role === "ai" && msg.isDone && msg.text && msg.participantId) {
      const key = `${msg.msgId}::${msg.participantId}`;
      if (_seenAiMsgIds.has(key)) return;
      _seenAiMsgIds.add(key);
      const chars = (msg.text || "").length;
      sessionStats.totalChars += chars;
      lifetimeStats.totalChars = (lifetimeStats.totalChars || 0) + chars;
      if (!lifetimeStats.models) lifetimeStats.models = {};
      if (!lifetimeStats.models[msg.participantId]) {
        lifetimeStats.models[msg.participantId] = { chars: 0, rounds: 0 };
      }
      lifetimeStats.models[msg.participantId].chars += chars;
      lifetimeStats.models[msg.participantId].rounds++;
      persistLifetime();
      render();
    }
  }
  function persistLifetime() {
    try { chrome.storage.local.set({ [STATS_KEY]: lifetimeStats }); } catch (_) {}
  }
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === "chatStreamUpdate") recordSession(msg);
    });
  } catch (_) {}

  document.addEventListener("rp:activated", (e) => {
    if (e.detail?.tab === "stats") refresh();
  });
  document.addEventListener("stats:session-updated", (e) => {
    Object.assign(sessionStats, e.detail || {});
    render();
  });

  // chrome.storage.local 变化时自动刷新累计统计
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[STATS_KEY]) {
        lifetimeStats = { ...lifetimeStats, ...(changes[STATS_KEY].newValue || {}) };
        if (!lifetimeStats.models) lifetimeStats.models = {};
        render();
      }
    });
  } catch (_) {}

  window.ChatStats = { refresh, render };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refresh);
  } else {
    refresh();
  }
})();
