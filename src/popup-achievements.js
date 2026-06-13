// popup-achievements.js — v5.0.36 成就徽章系统（发布趣味亮点）
// 消费 popup-stats 已埋点的 arena_lifetime_stats，达成里程碑时瞬时 toast 庆祝 + 成就墙展示。
// 独立模块，storage.onChanged 驱动，不改 popup-stats（零侵入）。瞬时 toast、无持续动效。
(function () {
  const STATS_KEY = "arena_lifetime_stats";
  const BADGES_KEY = "arena_badges_earned";

  const MILESTONES = [
    { id: "first_talk", icon: "🎤", title: "初次开口", desc: "完成第一次提问", check: s => (s.conversations || 0) >= 1 },
    { id: "first_debate", icon: "⚔️", title: "初战告捷", desc: "发起第一场辩论", check: s => (s.debates || 0) >= 1 },
    { id: "talkative", icon: "💬", title: "健谈者", desc: "累计 10 次对话", check: s => (s.conversations || 0) >= 10 },
    { id: "debate_master", icon: "🔥", title: "辩论大师", desc: "累计 10 场辩论", check: s => (s.debates || 0) >= 10 },
    { id: "polyglot", icon: "🌐", title: "博采众长", desc: "用过 3 家不同 AI", check: s => Object.keys(s.models || {}).length >= 3 },
    { id: "allrounder", icon: "📊", title: "全能选手", desc: "四种任务都试过", check: s => { const t = s.taskCounts || {}; return t.ask > 0 && t.debate > 0 && t.summary > 0 && t.ppt > 0; } },
    { id: "scholar", icon: "📚", title: "万字阅历", desc: "累计读 1 万字 AI 回答", check: s => (s.totalChars || 0) >= 10000 },
  ];

  let earned = new Set();
  let _initialized = false;

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }
  function get(keys) { return new Promise(res => { try { chrome.storage.local.get(keys, r => res(r || {})); } catch (_) { res({}); } }); }

  // silent=true：启动补齐历史已达成的，不 toast（避免老用户一开就弹一堆）
  function detect(stats, silent) {
    let changed = false;
    for (const m of MILESTONES) {
      if (!earned.has(m.id) && m.check(stats || {})) {
        earned.add(m.id);
        changed = true;
        if (!silent) {
          try { window.ChatToast?.show(`🏆 成就解锁：${m.icon} ${m.title} — ${m.desc}`, { type: "ok", duration: 5000 }); } catch (_) {}
        }
      }
    }
    if (changed) { try { chrome.storage.local.set({ [BADGES_KEY]: [...earned] }); } catch (_) {} }
    if (!silent && window.ChatRightPanel?.current === "stats") renderWall();
  }

  function renderWall() {
    const root = document.getElementById("rp-panel-stats");
    if (!root) return;
    root.querySelector(".ach-wall")?.remove();
    const div = document.createElement("div");
    div.className = "ach-wall";
    div.innerHTML = `
      <div class="rp-section-title" style="margin-top:18px">🏆 成就 <span class="rp-count">${earned.size}/${MILESTONES.length}</span></div>
      <div class="ach-grid">
        ${MILESTONES.map(m => {
          const got = earned.has(m.id);
          return `<div class="ach-item ${got ? "got" : "locked"}" title="${escapeHtml(m.desc)}${got ? "" : "（未解锁）"}">
            <span class="ach-icon">${got ? m.icon : "🔒"}</span>
            <span class="ach-title">${escapeHtml(m.title)}</span>
          </div>`;
        }).join("")}
      </div>`;
    root.appendChild(div);
  }

  async function init() {
    const r = await get([STATS_KEY, BADGES_KEY]);
    earned = new Set(Array.isArray(r[BADGES_KEY]) ? r[BADGES_KEY] : []);
    detect(r[STATS_KEY] || {}, true);   // 静默补齐
    _initialized = true;
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[STATS_KEY] && _initialized) {
        detect(changes[STATS_KEY].newValue || {}, false);
      }
    });
  } catch (_) {}

  // 切到统计 tab → 在 stats 渲染后追加成就墙（setTimeout 让 popup-stats 先重建 innerHTML）
  document.addEventListener("rp:activated", (e) => {
    if (e.detail?.tab === "stats") setTimeout(renderWall, 120);
  });

  window.ChatAchievements = { renderWall, _earned: () => [...earned] };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
