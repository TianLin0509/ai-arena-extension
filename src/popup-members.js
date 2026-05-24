// popup-members.js — 成员 Tab：参与者列表 + 添加 + ⋯ 菜单 + Tab/并列 切换
(function () {
  // v4.8.7: heroLogo 是 codex 画的 Q 版英雄卡（webp 17KB/张），仅 hero-slot 卡槽用；
  // logo 仍是简单 svg，给"添加"按钮、排行榜等小图标场景
  // v4.8.22 B2: 加 desc 字段（"厂商 · 一句话定位"），添加按钮显示副标题
  const ALL_SERVICES = [
    { id: "claude",   name: "Claude",   logo: "icons/brands/claude.svg",   heroLogo: "icons/heroes/claude.webp",   desc: "Anthropic · 推理稳健" },
    { id: "gemini",   name: "Gemini",   logo: "icons/brands/gemini.svg",   heroLogo: "icons/heroes/gemini.webp",   desc: "Google · 多模态强" },
    { id: "chatgpt",  name: "GPT",      logo: "icons/brands/openai.svg",   heroLogo: "icons/heroes/chatgpt.webp",  desc: "OpenAI · 全能选手" },
    { id: "deepseek", name: "DeepSeek", logo: "icons/brands/deepseek.svg", heroLogo: "icons/heroes/deepseek.webp", desc: "深度求索 · 代码强" },
    { id: "doubao",   name: "豆包",     logo: "icons/brands/doubao.svg",   heroLogo: "icons/heroes/doubao.webp",   desc: "字节 · 中文友好" },
    { id: "qwen",     name: "千问",     logo: "icons/brands/qwen.svg",     heroLogo: "icons/heroes/qwen.webp",     desc: "阿里 · 长文档强" },
    { id: "kimi",     name: "Kimi",     logo: "icons/brands/kimi.svg",     heroLogo: "icons/heroes/kimi.webp",     desc: "月之暗面 · 超长上下文" },
    { id: "yuanbao",  name: "元宝",     logo: "icons/brands/yuanbao.svg",  heroLogo: "icons/heroes/yuanbao.webp",  desc: "腾讯 · 微信生态" },
    { id: "grok",     name: "Grok",     logo: "icons/brands/grok.svg",     heroLogo: "icons/heroes/grok.webp",     desc: "xAI · 实时网络" },
  ];
  const SERVICE_MAP = Object.fromEntries(ALL_SERVICES.map(s => [s.id, s]));

  // v4.3.16: 模型实力榜（基于 2026-05 arena.ai 实时数据 — 不再凭印象编）
  // 数据源：https://arena.ai/leaderboard/text （前身 lmarena.ai，已 301 到 arena.ai）
  // 升级模型 / 刷新分数时在这里更新一次即可
  const LEADERBOARD_DATE = "2026-05";
  const LEADERBOARD_URL = "https://arena.ai/leaderboard/text";
  const LEADERBOARD = [
    { service: "claude",   model: "Claude Opus 4.6 Thinking", elo: 1502, rank: 1,   grade: "S+" },
    { service: "gemini",   model: "Gemini 3.1 Pro Preview",   elo: 1488, rank: 6,   grade: "S+" },
    { service: "chatgpt",  model: "GPT-5.5 High",             elo: 1481, rank: 8,   grade: "S+" },
    { service: "grok",     model: "Grok 4.20 Beta",           elo: 1478, rank: 12,  grade: "S"  },
    { service: "qwen",     model: "Qwen 3.5 Max Preview",     elo: 1464, rank: 27,  grade: "S"  },
    { service: "kimi",     model: "Kimi K2.6",                elo: 1462, rank: 29,  grade: "S"  },
    { service: "deepseek", model: "DeepSeek V4 Pro Thinking", elo: 1461, rank: 30,  grade: "S"  },
    // v4.3.17: 豆包内部是字节 Seed 系列，arena 榜上叫 dola-seed-2.0-pro
    { service: "doubao",   model: "Doubao Seed 2.0 Pro",      elo: 1456, rank: 35,  grade: "A"  },
    { service: "yuanbao",  model: "Hunyuan HY3 Preview",      elo: 1417, rank: 86,  grade: "B"  },
  ];

  function renderLeaderboard() {
    const ranked = LEADERBOARD.filter(m => typeof m.elo === "number");
    const maxElo = Math.max(...ranked.map(m => m.elo));
    const minElo = Math.min(...ranked.map(m => m.elo));
    const span = Math.max(1, maxElo - minElo);
    return `
      <div class="rp-section-title rp-lb-title" style="margin-top:18px">
        <button class="rp-lb-toggle" id="rp-lb-toggle" title="${lbCollapsed ? "展开" : "折叠"}排行榜" aria-expanded="${!lbCollapsed}">${lbCollapsed ? "▸" : "▾"}</button>
        <span>模型实力榜</span>
        <span class="rp-lb-meta">${LEADERBOARD_DATE} · arena.ai</span>
      </div>
      <div class="rp-leaderboard ${lbCollapsed ? "collapsed" : ""}">
        ${LEADERBOARD.map(m => {
          const meta = SERVICE_MAP[m.service] || { logo: null };
          const gradeCls = m.grade.replace("+", "plus").replace("?", "unranked");
          if (m.notRanked) {
            return `
              <div class="rp-lb-row rp-lb-row-unranked" data-service="${m.service}" title="${escapeHtml(m.model)} 未进入 Arena Top 181">
                <div class="rp-lb-head">
                  ${meta.logo ? `<img class="rp-lb-logo" src="${meta.logo}" alt="">` : ""}
                  <span class="rp-lb-name">${escapeHtml(m.model)}</span>
                  <span class="rp-lb-grade-tiny rp-lb-grade-unranked" title="未在 Arena Top 181 出现">未参榜</span>
                </div>
                <div class="rp-lb-bar-wrap">
                  <div class="rp-lb-bar-bg"><div class="rp-lb-bar-fill rp-lb-bar-unranked" style="width:0%"></div></div>
                  <span class="rp-lb-elo">—</span>
                </div>
              </div>`;
          }
          const pct = ((m.elo - minElo) / span * 100).toFixed(1);
          const rankBadge = m.rank ? `#${m.rank}` : "";
          return `
            <div class="rp-lb-row" data-service="${m.service}" title="${escapeHtml(m.model)} · Elo ${m.elo} · 全球排名 ${rankBadge}">
              <div class="rp-lb-head">
                ${meta.logo ? `<img class="rp-lb-logo" src="${meta.logo}" alt="">` : ""}
                <span class="rp-lb-name">${escapeHtml(m.model)}</span>
                <span class="rp-lb-grade-tiny rp-lb-grade-${gradeCls}">${escapeHtml(m.grade)}</span>
              </div>
              <div class="rp-lb-bar-wrap">
                <div class="rp-lb-bar-bg"><div class="rp-lb-bar-fill rp-lb-bar-${gradeCls}" style="width:${pct}%"></div></div>
                <span class="rp-lb-elo" title="全球排名 ${rankBadge}">${m.elo}</span>
              </div>
            </div>`;
        }).join("")}
        <a class="rp-lb-source" href="${LEADERBOARD_URL}" target="_blank" rel="noopener noreferrer">数据来源 · arena.ai ↗</a>
      </div>
    `;
  }

  function renderManifesto() {
    return `
      <div class="rp-manifesto">
        <div class="rp-manifesto-line1">不要把时间浪费在低端 AI 上。</div>
        <div class="rp-manifesto-line2">别为省几块订阅费，赔上你的认知差距 —— 这个时代，投资自己才是最好的投资。</div>
      </div>
    `;
  }

  // v4.5.3: layoutMode 已迁到顶栏（popup-window-mode.js）
  const state = { participants: [] };
  // v4.3.11: 成员状态直接跟主区气泡同步，不依赖 StateMachine 字段更新
  // key=service, value="busy"|"ready"|"error"|"skipped"
  const streamStatus = new Map();
  // v4.8.1: 跟踪上次渲染时的 participant ids — 用于识别"新添加"，给 .just-added 加炫酷动画
  // 已经存在的 AI 不会再跑动画（解决"对话中卡槽持续跳动"喧宾夺主问题）
  let _lastPidSet = new Set();
  // v4.3.15: 排行榜折叠状态（持久化）
  let lbCollapsed = false;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function statusOf(p) {
    // v4.3.11: 优先使用 streamStatus（跟主区气泡同步）
    const s = streamStatus.get(p.service);
    if (s) return s === "skipped" ? "" : s;
    if (p.error) return "error";
    if (p.isStreaming || p.responsePreview && !p.response) return "busy";
    if (p.response || p.responsePreview) return "ready";
    return "";
  }
  function statusTextOf(p) {
    const s = streamStatus.get(p.service);
    if (s === "busy") return "输出中…";
    if (s === "ready") return "已完成";
    if (s === "error") return "失败";
    if (s === "skipped") return "已跳过";
    if (p.error) return "失败";
    if (p.isStreaming || p.responsePreview && !p.response) return "输出中…";
    if (p.response || p.responsePreview) return "已完成";
    return "等待中";
  }

  function render() {
    const root = document.getElementById("rp-panel-members");
    if (!root) return;
    const joined = state.participants || [];
    const joinedIds = new Set(joined.map(p => p.service));
    const remaining = ALL_SERVICES.filter(s => !joinedIds.has(s.id));

    // v4.8.0: 王者风 3 卡槽 — 替代逐行卡片列表
    // v4.8.1: 只对"新出现的 pid"加 .just-added（含 bounce 进场 + 流光 2 圈）；已存在的不动
    const MAX_SLOTS = 3;
    const currentPidSet = new Set(joined.map(p => p.id));
    const newPids = [...currentPidSet].filter(pid => !_lastPidSet.has(pid));
    const slotsHtml = Array.from({ length: MAX_SLOTS }, (_, i) => {
      const p = joined[i];
      if (p) {
        const meta = SERVICE_MAP[p.service] || { name: p.service, logo: null, heroLogo: null };
        const status = statusOf(p);
        const isNew = newPids.includes(p.id);
        // v4.8.7: 优先用卡牌版 heroLogo；旧 svg 作为兜底
        // v4.8.14: heroLogo 走 ArenaLogoStyle.heroPath() 动态切换风格（classic/anime）
        const heroSrc = (window.ArenaLogoStyle?.heroPath(p.service)) || meta.heroLogo || meta.logo;
        // v4.8.20 ① 出战动画：新加入时注入 6 颗星芒，CSS sparkOut 让它们散开
        const sparks = isNew ? Array(6).fill('<span class="hero-slot-spark"></span>').join("") : "";
        return `
          <div class="hero-slot filled status-${status || 'idle'}${isNew ? ' just-added' : ''}" data-pid="${escapeHtml(p.id)}" data-slot="${i}" title="${escapeHtml(p.name || meta.name)} · ${statusTextOf(p)}">
            <div class="hero-slot-bg"></div>
            <div class="hero-slot-glow"></div>
            ${heroSrc
              ? `<img class="hero-slot-logo" src="${heroSrc}" alt="${escapeHtml(meta.name)}">`
              : `<span class="hero-slot-fb">${escapeHtml((meta.name || "?")[0])}</span>`}
            <div class="hero-slot-name">${escapeHtml(meta.name)}</div>
            <div class="hero-slot-status"><span class="rp-status-dot ${status}"></span></div>
            <span class="hero-slot-check">✓</span>
            <button class="hero-slot-more" data-pid="${escapeHtml(p.id)}" title="操作">⋯</button>
            ${sparks}
          </div>`;
      }
      return `<div class="hero-slot empty" data-slot="${i}" title="空位 — 在下方选择 AI 添加"><div class="hero-slot-plus">＋</div><div class="hero-slot-empty-lbl">空位</div></div>`;
    }).join("");
    _lastPidSet = currentPidSet;

    root.innerHTML = `
      <div class="rp-section-title">已加入 <span class="rp-count">${joined.length}/${MAX_SLOTS}</span></div>
      <div class="hero-slots">
        ${slotsHtml}
      </div>

      <div class="rp-section-title" style="margin-top:14px">添加</div>
      <div class="rp-add-grid">
        ${remaining.map(s => `
          <button class="rp-add-btn" data-service="${s.id}" title="添加 ${escapeHtml(s.name)} — ${escapeHtml(s.desc || "")}">
            <div class="rp-add-head">
              <img class="rp-add-logo" src="${s.logo}" alt="">
              <span class="rp-add-name">${escapeHtml(s.name)}</span>
            </div>
            ${s.desc ? `<div class="rp-add-desc">${escapeHtml(s.desc)}</div>` : ""}
          </button>
        `).join("")}
      </div>

      ${renderLeaderboard()}
      ${renderManifesto()}
    `;

    root.querySelectorAll(".rp-add-btn").forEach(b => {
      b.addEventListener("click", () => addParticipant(b.dataset.service));
    });
    // v4.8.0: 卡槽里的更多操作按钮 (.hero-slot-more 取代 .rp-more)
    root.querySelectorAll(".hero-slot-more").forEach(el => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        openActionMenu(e, el.dataset.pid);
      });
    });
    // v4.3.15: 排行榜折叠按钮
    root.querySelector("#rp-lb-toggle")?.addEventListener("click", toggleLeaderboard);
    // v4.8.1: 800ms 后移除 .just-added，避免下次 render 重启动画（用户 hover 仍能触发短暂流光）
    // animation 时长 0.45s bounce + 2*2.6s shimmer = 5.65s 但 CSS animation 只跑 1 次后保持终态，
    // 这里只需保证 class 在下次 render 前能消失即可
    setTimeout(() => {
      root.querySelectorAll(".hero-slot.just-added").forEach(el => el.classList.remove("just-added"));
    }, 6000);
  }

  async function refresh() {
    try {
      const r = await new Promise(res => {
        chrome.runtime.sendMessage({ type: "getState" }, resp => res(resp || {}));
      });
      if (Array.isArray(r.participants)) state.participants = r.participants;
    } catch (_) {}
    try {
      const r2 = await new Promise(res => {
        chrome.storage.local.get(["leaderboardCollapsed"], resp => res(resp || {}));
      });
      if (typeof r2.leaderboardCollapsed === "boolean") lbCollapsed = r2.leaderboardCollapsed;
    } catch (_) {}
    render();
  }

  function toggleLeaderboard() {
    lbCollapsed = !lbCollapsed;
    try { chrome.storage.local.set({ leaderboardCollapsed: lbCollapsed }); } catch (_) {}
    render();
  }

  function addParticipant(service) {
    // v4.6.6 F15: 在用户手势 context 内直接调 window.focus()，把 popup 自己拉前台
    // Chrome 88+ 收紧 SW 内 chrome.windows.update({focused:true}) 政策（被静默拒绝），
    // popup 端用 window.focus() 保留用户手势链条，比 background.focusPopup 更可靠
    chrome.runtime.sendMessage({ type: "addParticipant", service }, () => {
      try { window.focus(); } catch (_) {}
      refresh();
    });
  }

  function removeParticipant(pid) {
    chrome.runtime.sendMessage({ type: "removeParticipant", id: pid }, () => refresh());
  }

  function retryInject(pid) {
    chrome.runtime.sendMessage({ type: "retryInject", id: pid }, () => {});
  }

  function reextractOne(pid) {
    chrome.runtime.sendMessage({ type: "chatReextractOne", participantId: pid }, () => {});
  }

  function openActionMenu(ev, pid) {
    ev.stopPropagation();
    closeActionMenu();
    const menu = document.createElement("div");
    menu.className = "rp-action-menu";
    menu.innerHTML = `
      <div class="ai" data-act="resend">🔄 重发</div>
      <div class="ai" data-act="reextract">📥 重新提取</div>
      <div class="ai" data-act="remove">🗑 移除</div>
    `;
    document.body.appendChild(menu);
    const rect = ev.target.getBoundingClientRect();
    menu.style.top = (rect.bottom + 4) + "px";
    const leftCandidate = rect.right - 130;
    menu.style.left = Math.max(8, leftCandidate) + "px";
    menu.querySelectorAll(".ai").forEach(item => {
      item.addEventListener("click", () => {
        const act = item.dataset.act;
        closeActionMenu();
        if (act === "resend") retryInject(pid);
        else if (act === "reextract") reextractOne(pid);
        else if (act === "remove") removeParticipant(pid);
      });
    });
    setTimeout(() => document.addEventListener("click", closeActionMenu, { once: true }), 0);
  }

  function closeActionMenu() {
    document.querySelectorAll(".rp-action-menu").forEach(el => el.remove());
  }

  document.addEventListener("rp:activated", (e) => {
    if (e.detail?.tab === "members") refresh();
  });
  document.addEventListener("state:updated", refresh);
  // v4.8.15: logo 风格切换 → re-render 卡槽（用最新风格的 webp 路径）
  document.addEventListener("logo-style-changed", () => render());

  // 监听 background 推送参与者状态变化（state-machine._broadcastStateUpdate）
  // v4.3.11: 同时监听 chatStreamUpdate 让成员状态跟主区气泡完全同步
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === "stateUpdate") {
        if (Array.isArray(msg.participants)) state.participants = msg.participants;
        render();
        return;
      }
      if (msg?.type === "chatStreamUpdate" && msg.role === "user") {
        // 新一轮 → 清空旧状态，等 AI 端 polling 自动设 busy
        streamStatus.clear();
        render();
        return;
      }
      if (msg?.type === "chatStreamUpdate" && msg.role === "ai" && msg.participantId) {
        const svc = msg.participantId;
        let next = "busy";
        if (msg.skipped) next = "skipped";
        else if (msg.emptyTimeout) next = "error";
        else if (msg.isDone) next = "ready";
        streamStatus.set(svc, next);
        render();
        return;
      }
      if (msg?.type === "chatClear" || msg?.type === "hardReset") {
        streamStatus.clear();
        render();
      }
    });
  } catch (_) {}
  // 用户主动发新一轮 → 之前的 ready/error 应清空标记，等新一轮 streaming 重新设置
  document.addEventListener("roster:changed", () => {
    // 不主动清除（避免抖动），仅在下次 user msg 推来时由 chat-bus 自然变成 busy
  });

  window.ChatMembers = { refresh, render };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refresh);
  } else {
    refresh();
  }
})();
