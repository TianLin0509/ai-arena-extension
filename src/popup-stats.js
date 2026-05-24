// popup-stats.js — 统计 Tab：本次 / 累计 / 模型 三 sub-tab
// v4.6.8: 可视化升级 — 模型 sub-tab 加柱状图；累计 sub-tab 加 7 天 Token 趋势线 + 168 cell 活跃热力图
(function () {
  const STATS_KEY = "arena_lifetime_stats";
  let activeSub = "session";
  const sessionStats = { conversations: 0, debates: 0, totalChars: 0 };
  // v4.6.8: lifetimeStats 增加 daily / heatmap 时间序列
  //   daily: { "YYYY-MM-DD": { conversations, chars, models: { [service]: { chars, rounds } } } }
  //   heatmap: 长度 168 的 Int32Array 索引 = weekday(0=Sun..6=Sat) * 24 + hour(0..23)
  let lifetimeStats = {
    conversations: 0, debates: 0, totalChars: 0,
    models: {}, daily: {}, heatmap: new Array(168).fill(0)
  };

  // service id → 中文名 + emoji（与 popup-role-hats.js / popup.js 同源）
  const SERVICE_META = {
    claude:  { name: "Claude",   emoji: "🟧" },
    gemini:  { name: "Gemini",   emoji: "🔷" },
    chatgpt: { name: "ChatGPT",  emoji: "🟢" },
    deepseek:{ name: "DeepSeek", emoji: "🔵" },
    doubao:  { name: "豆包",     emoji: "🥟" },
    qwen:    { name: "千问",     emoji: "🐫" },
    kimi:    { name: "Kimi",     emoji: "🌙" },
    yuanbao: { name: "元宝",     emoji: "💰" },
    grok:    { name: "Grok",     emoji: "❌" }
  };

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
  function todayKey(d = new Date()) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function _lastNDayKeys(n) {
    const keys = [];
    const today = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      keys.push(todayKey(d));
    }
    return keys;
  }

  // ============== 图表：每个 AI Token 横向柱状图 ==============
  function renderModelBarChart() {
    const models = lifetimeStats.models || {};
    const list = Object.entries(models).sort((a, b) => (b[1].chars || 0) - (a[1].chars || 0));
    if (!list.length) return `<div class="rp-empty">暂无模型统计数据</div>`;
    const maxChars = Math.max(...list.map(([, s]) => s.chars || 0)) || 1;
    return `
      <div class="rp-bar-list">
        ${list.map(([service, s]) => {
          const meta = SERVICE_META[service] || { name: service, emoji: "🤖" };
          const pct = ((s.chars || 0) / maxChars * 100).toFixed(1);
          return `
            <div class="rp-bar-row" title="${escapeHtml(meta.name)} · ${fmtNum(charsToTokens(s.chars))} Token · ${s.rounds || 0} 轮">
              <div class="rp-bar-label">
                <span class="rp-bar-em">${meta.emoji}</span>
                <span class="rp-bar-name">${escapeHtml(meta.name)}</span>
              </div>
              <div class="rp-bar-track">
                <div class="rp-bar-fill" style="width:${pct}%"></div>
                <span class="rp-bar-val">${fmtNum(charsToTokens(s.chars))} tk · ${s.rounds || 0}轮</span>
              </div>
            </div>`;
        }).join("")}
      </div>
    `;
  }

  // ============== 图表：7 天 Token 趋势折线 ==============
  function render7DayTrend() {
    const keys = _lastNDayKeys(7);
    const series = keys.map(k => charsToTokens((lifetimeStats.daily?.[k]?.chars) || 0));
    const maxV = Math.max(...series, 1);
    const W = 280, H = 70, PAD = { l: 8, r: 8, t: 6, b: 18 };
    const innerW = W - PAD.l - PAD.r;
    const innerH = H - PAD.t - PAD.b;
    const stepX = series.length > 1 ? innerW / (series.length - 1) : 0;
    const pts = series.map((v, i) => {
      const x = PAD.l + i * stepX;
      const y = PAD.t + innerH - (v / maxV) * innerH;
      return [x, y];
    });
    const polyline = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const areaPath = `M${pts[0][0]},${PAD.t + innerH} L${polyline.replace(/ /g, " L")} L${pts[pts.length - 1][0]},${PAD.t + innerH} Z`;
    const labels = keys.map(k => k.slice(5)); // MM-DD
    // 仅显示首末标签避免拥挤
    return `
      <div class="rp-chart-wrap">
        <div class="rp-chart-title">7 天 Token 趋势</div>
        <svg class="rp-chart-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="7天趋势">
          <path class="rp-chart-area" d="${areaPath}"/>
          <polyline class="rp-chart-line" points="${polyline}" fill="none"/>
          ${pts.map(([x, y], i) => `<circle class="rp-chart-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5"><title>${labels[i]}: ${series[i]} tk</title></circle>`).join("")}
          <text x="${PAD.l}" y="${H - 4}" class="rp-chart-axis">${labels[0]}</text>
          <text x="${W - PAD.r}" y="${H - 4}" class="rp-chart-axis" text-anchor="end">${labels[labels.length - 1]}</text>
        </svg>
        <div class="rp-chart-meta">峰值 ${fmtNum(maxV)} tk · 7 日总计 ${fmtNum(series.reduce((a, b) => a + b, 0))} tk</div>
      </div>
    `;
  }

  // ============== 图表：活跃热力图（7 weekday × 24 hour） ==============
  function renderHeatmap() {
    const hm = lifetimeStats.heatmap || new Array(168).fill(0);
    const max = Math.max(...hm, 1);
    const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];
    const cells = [];
    for (let w = 0; w < 7; w++) {
      for (let h = 0; h < 24; h++) {
        const idx = w * 24 + h;
        const v = hm[idx] || 0;
        // 5 级深浅（0 = 空，1-4 按比例）
        const level = v === 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4));
        cells.push(`<rect class="rp-heat-cell rp-heat-l${level}" x="${22 + h * 10}" y="${6 + w * 12}" width="9" height="10" rx="2" data-v="${v}"><title>${weekdayLabels[w]} ${h}:00 · ${v} 次</title></rect>`);
      }
    }
    return `
      <div class="rp-chart-wrap">
        <div class="rp-chart-title">活跃热力图（按提问时间）</div>
        <svg class="rp-heat-svg" viewBox="0 0 264 96" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="活跃热力图">
          ${weekdayLabels.map((w, i) => `<text x="0" y="${15 + i * 12}" class="rp-heat-label">${w}</text>`).join("")}
          ${[0, 6, 12, 18].map(h => `<text x="${22 + h * 10}" y="92" class="rp-heat-label">${h}h</text>`).join("")}
          ${cells.join("")}
        </svg>
        <div class="rp-chart-meta">
          <span class="rp-heat-legend-lbl">少</span>
          ${[0, 1, 2, 3, 4].map(l => `<span class="rp-heat-legend-sq rp-heat-l${l}"></span>`).join("")}
          <span class="rp-heat-legend-lbl">多</span>
        </div>
      </div>
    `;
  }

  // ============== 渲染调度 ==============
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
      // v4.6.8: 模型 sub-tab → 横向柱状图（每 AI Token 对比）
      return renderModelBarChart();
    }
    const d = activeSub === "session" ? sessionStats : lifetimeStats;
    const cells = `
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
    // v4.6.8: 累计 sub-tab 加趋势线 + 热力图
    if (activeSub === "lifetime") {
      return cells + render7DayTrend() + renderHeatmap();
    }
    return cells;
  }

  async function refresh() {
    try {
      const r = await new Promise(res => {
        chrome.storage.local.get([STATS_KEY], resp => res(resp || {}));
      });
      if (r[STATS_KEY]) {
        lifetimeStats = { ...lifetimeStats, ...r[STATS_KEY] };
        if (!lifetimeStats.models) lifetimeStats.models = {};
        if (!lifetimeStats.daily) lifetimeStats.daily = {};
        // heatmap 持久化为普通数组，长度可能 != 168 → 修正
        if (!Array.isArray(lifetimeStats.heatmap) || lifetimeStats.heatmap.length !== 168) {
          lifetimeStats.heatmap = new Array(168).fill(0);
        }
      }
    } catch (_) {}
    render();
  }

  // ============== 埋点 ==============
  const _seenUserMsgIds = new Set();
  const _seenAiMsgIds = new Set();
  function recordSession(msg) {
    if (!msg) return;
    if (msg.role === "user" && msg.msgId && !_seenUserMsgIds.has(msg.msgId)) {
      _seenUserMsgIds.add(msg.msgId);
      sessionStats.conversations++;
      lifetimeStats.conversations = (lifetimeStats.conversations || 0) + 1;
      // v4.6.8: 按日 + 按 weekday×hour 累积（提问时间维度，最能反映用户活跃）
      const now = new Date();
      const dk = todayKey(now);
      if (!lifetimeStats.daily) lifetimeStats.daily = {};
      if (!lifetimeStats.daily[dk]) lifetimeStats.daily[dk] = { conversations: 0, chars: 0, models: {} };
      lifetimeStats.daily[dk].conversations++;
      const hmIdx = now.getDay() * 24 + now.getHours();
      if (!Array.isArray(lifetimeStats.heatmap) || lifetimeStats.heatmap.length !== 168) {
        lifetimeStats.heatmap = new Array(168).fill(0);
      }
      lifetimeStats.heatmap[hmIdx] = (lifetimeStats.heatmap[hmIdx] || 0) + 1;
      // 老数据保留 30 天，超过删（避免 storage 无限增长）
      _pruneOldDaily();
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
      if (!lifetimeStats.models[msg.participantId]) lifetimeStats.models[msg.participantId] = { chars: 0, rounds: 0 };
      lifetimeStats.models[msg.participantId].chars += chars;
      lifetimeStats.models[msg.participantId].rounds++;
      // v4.6.8: 按日按 AI 累积
      const dk = todayKey();
      if (!lifetimeStats.daily) lifetimeStats.daily = {};
      if (!lifetimeStats.daily[dk]) lifetimeStats.daily[dk] = { conversations: 0, chars: 0, models: {} };
      lifetimeStats.daily[dk].chars += chars;
      if (!lifetimeStats.daily[dk].models[msg.participantId]) lifetimeStats.daily[dk].models[msg.participantId] = { chars: 0, rounds: 0 };
      lifetimeStats.daily[dk].models[msg.participantId].chars += chars;
      lifetimeStats.daily[dk].models[msg.participantId].rounds++;
      persistLifetime();
      render();
    }
  }

  function _pruneOldDaily() {
    // 只保留近 30 天（heatmap 不剪 — 它本身就是聚合无限累积）
    const keep = new Set(_lastNDayKeys(30));
    for (const k of Object.keys(lifetimeStats.daily || {})) {
      if (!keep.has(k)) delete lifetimeStats.daily[k];
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

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[STATS_KEY]) {
        lifetimeStats = { ...lifetimeStats, ...(changes[STATS_KEY].newValue || {}) };
        if (!lifetimeStats.models) lifetimeStats.models = {};
        if (!lifetimeStats.daily) lifetimeStats.daily = {};
        if (!Array.isArray(lifetimeStats.heatmap) || lifetimeStats.heatmap.length !== 168) {
          lifetimeStats.heatmap = new Array(168).fill(0);
        }
        render();
      }
    });
  } catch (_) {}

  // v4.6.8: 暴露给 E2E
  window.ChatStats = {
    refresh, render,
    _state: () => lifetimeStats,
    _injectFakeData: (data) => {
      lifetimeStats = { ...lifetimeStats, ...data };
      render();
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refresh);
  } else {
    refresh();
  }
})();
