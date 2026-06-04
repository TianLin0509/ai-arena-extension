// popup-stats.js — 统计 Tab：本次 / 累计 / 模型 三 sub-tab
// v4.6.8: 可视化升级 — 模型 sub-tab 加柱状图；累计 sub-tab 加 7 天 Token 趋势线 + 168 cell 活跃热力图
(function () {
  const STATS_KEY = "arena_lifetime_stats";
  let activeSub = "session";
  // v4.7.0: sessionStats 加 taskCounts + sessionStart（用于本次心流计算）
  const sessionStats = {
    conversations: 0, debates: 0, totalChars: 0,
    taskCounts: { ask: 0, debate: 0, summary: 0, ppt: 0 },
    sessionStart: Date.now()
  };
  // v4.6.8/v4.7.0: lifetimeStats 增加 daily / heatmap / 任务计数 / 心流时间序列
  //   daily: { "YYYY-MM-DD": { conversations, chars, models, flowSec, taskCounts } }
  //   heatmap: 长度 168 的数组 索引 = weekday(0=Sun..6=Sat) * 24 + hour(0..23)
  //   taskCounts (累计): { ask, debate, summary, ppt }
  let lifetimeStats = {
    conversations: 0, debates: 0, totalChars: 0,
    models: {}, daily: {}, heatmap: new Array(168).fill(0),
    taskCounts: { ask: 0, debate: 0, summary: 0, ppt: 0 }
  };
  // 用于心流计算：最近一次 user 提问时间戳
  let _lastUserMsgTs = 0;

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

  // ============== 图表：每日心流柱状图（v4.7.0） ==============
  // 心流分钟 = 连续提问（间隔 < 30s）累积秒数 / 60
  function renderFlowChart() {
    const keys = _lastNDayKeys(7);
    const flowMins = keys.map(k => Math.round((lifetimeStats.daily?.[k]?.flowSec || 0) / 60));
    const maxV = Math.max(...flowMins, 1);
    const todayMin = flowMins[flowMins.length - 1];
    const peakIdx = flowMins.indexOf(maxV);
    const totalMin = flowMins.reduce((a, b) => a + b, 0);
    const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];
    const todayWd = new Date().getDay();
    const W = 280, H = 100, PAD = { l: 8, r: 8, t: 8, b: 22 };
    const innerW = W - PAD.l - PAD.r;
    const innerH = H - PAD.t - PAD.b;
    const barW = innerW / 7 * 0.7;
    const stepX = innerW / 7;
    return `
      <div class="rp-chart-wrap">
        <div class="rp-chart-title">🔥 每日心流（连续提问分钟数）</div>
        <svg class="rp-chart-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="7天心流分钟数">
          ${flowMins.map((v, i) => {
            const x = PAD.l + i * stepX + (stepX - barW) / 2;
            const h = (v / maxV) * innerH;
            const y = PAD.t + innerH - h;
            const isToday = i === flowMins.length - 1;
            const isPeak = i === peakIdx && v > 0;
            const opacity = isPeak ? "1" : isToday ? "0.85" : (0.25 + (v / maxV) * 0.5).toFixed(2);
            const fill = isPeak ? "#34c759" : "var(--accent)";
            return `<rect class="rp-flow-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}" opacity="${opacity}" rx="2"><title>${keys[i].slice(5)} · ${v} 分钟${isPeak ? " (峰值)" : ""}</title></rect>`;
          }).join("")}
          ${flowMins.map((v, i) => {
            const x = PAD.l + i * stepX + stepX / 2;
            const wdRelative = (todayWd - (6 - i) + 7) % 7;
            const lbl = weekdayLabels[wdRelative];
            const isToday = i === flowMins.length - 1;
            const isPeak = i === peakIdx && v > 0;
            const fill = isPeak ? "#34c759" : isToday ? "var(--accent)" : "var(--ink-soft)";
            const fw = (isToday || isPeak) ? "700" : "400";
            return `<text x="${x.toFixed(1)}" y="${H - 8}" class="rp-chart-axis" text-anchor="middle" fill="${fill}" font-weight="${fw}">${lbl}${isPeak ? " " + v + "'" : ""}</text>`;
          }).join("")}
        </svg>
        <div class="rp-chart-meta">今日 ${todayMin} 分钟 · 7 日总计 ${totalMin} 分钟</div>
      </div>
    `;
  }

  // ============== 图表：任务分布饼图（v4.7.0） ==============
  // 数据：本次 sub-tab → sessionStats.taskCounts；累计 → lifetimeStats.taskCounts
  function renderTaskPie() {
    const src = activeSub === "session" ? sessionStats.taskCounts : (lifetimeStats.taskCounts || { ask: 0, debate: 0, summary: 0, ppt: 0 });
    const TASKS = [
      { key: "ask",     label: "同时提问", color: "var(--accent)", emoji: "💬" },
      { key: "debate",  label: "辩论",     color: "#34c759",       emoji: "⚔️" },
      { key: "summary", label: "裁判总结", color: "#ff9f0a",       emoji: "📋" },
      { key: "ppt",     label: "PPT 制作", color: "#ff3b30",       emoji: "📊" }
    ];
    const total = TASKS.reduce((s, t) => s + (src[t.key] || 0), 0);
    if (total === 0) {
      return `
        <div class="rp-chart-wrap">
          <div class="rp-chart-title">📋 任务分布</div>
          <div class="rp-pie-empty">本次还没触发任何任务<br><span style="opacity:0.6">底部输入框发条消息试试</span></div>
        </div>
      `;
    }
    // 计算每段弧的 stroke-dasharray
    const C = 40;  // 圆半径
    const circ = 2 * Math.PI * C;
    let offset = 0;
    const arcs = TASKS.map(t => {
      const v = src[t.key] || 0;
      const len = (v / total) * circ;
      const arc = `<circle cx="50" cy="50" r="${C}" fill="none" stroke="${t.color}" stroke-width="14" stroke-dasharray="${len.toFixed(1)} ${(circ - len).toFixed(1)}" stroke-dashoffset="${(-offset).toFixed(1)}" transform="rotate(-90 50 50)"><title>${t.emoji} ${t.label}: ${v} 次 (${((v / total) * 100).toFixed(0)}%)</title></circle>`;
      offset += len;
      return { html: arc, t, v };
    });
    return `
      <div class="rp-chart-wrap">
        <div class="rp-chart-title">📋 任务分布${activeSub === "session" ? "（本次）" : "（累计）"}</div>
        <div class="rp-pie-row">
          <svg class="rp-pie-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="任务分布饼图">
            ${arcs.map(a => a.html).join("")}
            <text x="50" y="48" text-anchor="middle" class="rp-pie-center-num">${total}</text>
            <text x="50" y="62" text-anchor="middle" class="rp-pie-center-lbl">次</text>
          </svg>
          <div class="rp-pie-legend">
            ${arcs.filter(a => a.v > 0).map(a => `
              <div class="rp-pie-leg-row">
                <span class="rp-pie-leg-sq" style="background:${a.t.color}"></span>
                <span class="rp-pie-leg-name">${a.t.emoji} ${a.t.label}</span>
                <span class="rp-pie-leg-val">${a.v} · ${((a.v / total) * 100).toFixed(0)}%</span>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    `;
  }

  // ============== 渲染调度 ==============
  // v5.0.8 perf: stats panel 非激活时跳过 SVG 重渲，仅在 panel 被切到时由 rp:activated → refresh() 重建
  function _isStatsActive() {
    const root = document.getElementById("rp-panel-stats");
    return !!(root && root.classList.contains("active"));
  }
  function render() {
    const root = document.getElementById("rp-panel-stats");
    if (!root) return;
    // v5.0.8: 非激活 panel 跳过 innerHTML 重建（heatmap/折线/饼图 SVG 都很重）
    if (!root.classList.contains("active")) return;
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
    // v4.7.0: 本次 sub-tab 加 心流柱状图 + 任务分布饼图
    if (activeSub === "session") {
      return cells + renderFlowChart() + renderTaskPie();
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
        // v4.7.0: taskCounts 兼容老数据
        if (!lifetimeStats.taskCounts) lifetimeStats.taskCounts = { ask: 0, debate: 0, summary: 0, ppt: 0 };
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
      // v4.8.31 F39: 区分辩论轮 / 总结 / 普通提问
      // chat-bus / background.js 推送的 user 气泡 text 有固定前缀：
      //   "⚔️ 第N轮辩论·..." → 辩论轮（debate++）
      //   "📋 裁判总结..." → summary++（不算 conversations）
      //   其他 → 普通提问 conversations++
      const text = String(msg.text || "");
      const isDebate = /^⚔️/.test(text);
      const isSummary = /^📋/.test(text);
      if (isDebate) {
        sessionStats.debates++;
        lifetimeStats.debates = (lifetimeStats.debates || 0) + 1;
        if (!sessionStats.taskCounts) sessionStats.taskCounts = { ask: 0, debate: 0, summary: 0, ppt: 0 };
        sessionStats.taskCounts.debate = (sessionStats.taskCounts.debate || 0) + 1;
        if (!lifetimeStats.taskCounts) lifetimeStats.taskCounts = { ask: 0, debate: 0, summary: 0, ppt: 0 };
        lifetimeStats.taskCounts.debate = (lifetimeStats.taskCounts.debate || 0) + 1;
      } else if (isSummary) {
        if (!sessionStats.taskCounts) sessionStats.taskCounts = { ask: 0, debate: 0, summary: 0, ppt: 0 };
        sessionStats.taskCounts.summary = (sessionStats.taskCounts.summary || 0) + 1;
        if (!lifetimeStats.taskCounts) lifetimeStats.taskCounts = { ask: 0, debate: 0, summary: 0, ppt: 0 };
        lifetimeStats.taskCounts.summary = (lifetimeStats.taskCounts.summary || 0) + 1;
      } else {
        sessionStats.conversations++;
        lifetimeStats.conversations = (lifetimeStats.conversations || 0) + 1;
        if (!sessionStats.taskCounts) sessionStats.taskCounts = { ask: 0, debate: 0, summary: 0, ppt: 0 };
        sessionStats.taskCounts.ask = (sessionStats.taskCounts.ask || 0) + 1;
        if (!lifetimeStats.taskCounts) lifetimeStats.taskCounts = { ask: 0, debate: 0, summary: 0, ppt: 0 };
        lifetimeStats.taskCounts.ask = (lifetimeStats.taskCounts.ask || 0) + 1;
      }
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
      // v4.7.0: 心流计算 — 连续提问间隔 < 30s 视为同一心流 session，累计 flowSec
      const nowMs = now.getTime();
      const FLOW_GAP_MS = 30 * 1000;
      if (_lastUserMsgTs && (nowMs - _lastUserMsgTs) < FLOW_GAP_MS) {
        if (!lifetimeStats.daily[dk].flowSec) lifetimeStats.daily[dk].flowSec = 0;
        lifetimeStats.daily[dk].flowSec += Math.floor((nowMs - _lastUserMsgTs) / 1000);
      }
      _lastUserMsgTs = nowMs;
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

  // v5.0.8 perf: _selfWriting 计数器切断"自己写 storage → onChanged 监听到 → render() 自掐 loop"
  //   原现象：流式时每条 ai update 调 persistLifetime（写 STATS_KEY）→ storage.onChanged 触发
  //   监听器 → 又调 render() 渲 SVG 折线/168 cell 热力图/饼图，CPU 长期不空闲。
  //   修复：persistLifetime 写入前计数器 +1，监听器消费一次 -1（与写入次数严格匹配）。
  //   用计数器而非布尔，防 Chrome 不合并 onChanged 时漏拦截（每次 set 都会触发回调）。
  let _selfWritingCount = 0;
  function persistLifetime() {
    try {
      _selfWritingCount++;
      chrome.storage.local.set({ [STATS_KEY]: lifetimeStats });
    } catch (_) {
      _selfWritingCount = Math.max(0, _selfWritingCount - 1);  // set 同步阶段抛错才会进这里
    }
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

  // v4.7.0: 任务分布埋点 — popup-task-menu.js 触发任务时 emit 该事件
  document.addEventListener("task:dispatched", (e) => {
    const t = e.detail?.task;
    if (!t || !["ask", "debate", "summary", "ppt"].includes(t)) return;
    sessionStats.taskCounts[t] = (sessionStats.taskCounts[t] || 0) + 1;
    if (!lifetimeStats.taskCounts) lifetimeStats.taskCounts = { ask: 0, debate: 0, summary: 0, ppt: 0 };
    lifetimeStats.taskCounts[t] = (lifetimeStats.taskCounts[t] || 0) + 1;
    // 也按日累积
    const dk = todayKey();
    if (!lifetimeStats.daily[dk]) lifetimeStats.daily[dk] = { conversations: 0, chars: 0, models: {} };
    if (!lifetimeStats.daily[dk].taskCounts) lifetimeStats.daily[dk].taskCounts = { ask: 0, debate: 0, summary: 0, ppt: 0 };
    lifetimeStats.daily[dk].taskCounts[t] = (lifetimeStats.daily[dk].taskCounts[t] || 0) + 1;
    persistLifetime();
    if (activeSub === "session") render();
  });

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[STATS_KEY]) {
        // v5.0.8 perf: 自己写入触发的回调直接 return（消除自掐 loop）— 计数器每次消费 1
        if (_selfWritingCount > 0) { _selfWritingCount--; return; }
        lifetimeStats = { ...lifetimeStats, ...(changes[STATS_KEY].newValue || {}) };
        if (!lifetimeStats.models) lifetimeStats.models = {};
        if (!lifetimeStats.daily) lifetimeStats.daily = {};
        if (!Array.isArray(lifetimeStats.heatmap) || lifetimeStats.heatmap.length !== 168) {
          lifetimeStats.heatmap = new Array(168).fill(0);
        }
        // v5.0.8 perf: stats panel 非激活时跳过昂贵 SVG 重渲（renderBody → 7 天趋势 +
        //   168 cell 热力图 + 饼图 + 模型柱状图）。其他 panel 切回 stats 时 rp:activated
        //   会触发 refresh() 拉最新数据。
        const statsRoot = document.getElementById("rp-panel-stats");
        if (statsRoot && statsRoot.classList.contains("active")) {
          render();
        }
      }
    });
  } catch (_) {}

  // v4.6.8 / v4.7.0: 暴露给 E2E
  window.ChatStats = {
    refresh, render,
    _state: () => lifetimeStats,
    _session: () => sessionStats,
    _injectFakeData: (data) => {
      lifetimeStats = { ...lifetimeStats, ...data };
      render();
    },
    _injectFakeSession: (data) => {
      Object.assign(sessionStats, data);
      render();
    },
    _emitTask: (task) => {
      document.dispatchEvent(new CustomEvent("task:dispatched", { detail: { task } }));
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refresh);
  } else {
    refresh();
  }
})();
