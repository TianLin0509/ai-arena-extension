// popup-members.js — 成员 Tab：参与者列表 + 添加 + ⋯ 菜单 + Tab/并列 切换
(function () {
  // v4.8.7: heroLogo 是 codex 画的 Q 版英雄卡（webp 17KB/张），仅 hero-slot 卡槽用；
  // logo 仍是简单 svg，给"添加"按钮、排行榜等小图标场景
  // v4.8.22 B2: 加 desc 字段（"厂商 · 一句话定位"），添加按钮显示副标题
  // v5.0.22 B: cn 标记 — 国内可直连（手机号注册门槛低）排前面，国际站点单独分组并注明
  //   网络要求，避免萌新点了 Claude 看到打不开的报错页以为"插件是坏的"
  const ALL_SERVICES = [
    { id: "deepseek", name: "DeepSeek", cn: true,  logo: "icons/brands/deepseek.svg", heroLogo: "icons/heroes/deepseek.webp", desc: "深度求索 · 代码强" },
    { id: "doubao",   name: "豆包",     cn: true,  logo: "icons/brands/doubao.svg",   heroLogo: "icons/heroes/doubao.webp",   desc: "字节 · 中文友好" },
    { id: "kimi",     name: "Kimi",     cn: true,  logo: "icons/brands/kimi.svg",     heroLogo: "icons/heroes/kimi.webp",     desc: "月之暗面 · 超长上下文" },
    { id: "yuanbao",  name: "元宝",     cn: true,  logo: "icons/brands/yuanbao.svg",  heroLogo: "icons/heroes/yuanbao.webp",  desc: "腾讯 · 微信生态" },
    { id: "qwen",     name: "千问",     cn: true,  logo: "icons/brands/qwen.svg",     heroLogo: "icons/heroes/qwen.webp",     desc: "阿里 · 长文档强" },
    { id: "claude",   name: "Claude",   cn: false, logo: "icons/brands/claude.svg",   heroLogo: "icons/heroes/claude.webp",   desc: "Anthropic · 推理稳健" },
    { id: "gemini",   name: "Gemini",   cn: false, logo: "icons/brands/gemini.svg",   heroLogo: "icons/heroes/gemini.webp",   desc: "Google · 多模态强" },
    { id: "chatgpt",  name: "GPT",      cn: false, logo: "icons/brands/openai.svg",   heroLogo: "icons/heroes/chatgpt.webp",  desc: "OpenAI · 全能选手" },
    { id: "grok",     name: "Grok",     cn: false, logo: "icons/brands/grok.svg",     heroLogo: "icons/heroes/grok.webp",     desc: "xAI · 实时网络" },
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

  // v5.0.20 UX-1: 队长模式开关/队长变化 → 重绘卡槽徽章
  document.addEventListener("captain:changed", () => { try { render(); } catch (_) {} });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  // v5.0.22 B: 添加区按网络可达性分两组 — 国内直连在前（萌新默认看到点了就能用的）
  function renderAddGroups(remaining) {
    const cnList = remaining.filter(s => s.cn);
    const intlList = remaining.filter(s => !s.cn);
    const btn = s => `
          <button class="rp-add-btn" data-service="${s.id}" title="添加 ${escapeHtml(s.name)} — ${escapeHtml(s.desc || "")}">
            <img class="rp-add-logo" src="${s.logo}" alt="">
            <span class="rp-add-name">${escapeHtml(s.name)}</span>
          </button>`;
    let html = "";
    if (cnList.length) {
      html += `
      <div class="rp-add-group-lbl">🟢 国内直连 · 手机号即可注册</div>
      <div class="rp-add-grid">${cnList.map(btn).join("")}</div>`;
    }
    if (intlList.length) {
      html += `
      <div class="rp-add-group-lbl rp-add-group-intl">🌐 需国际网络环境</div>
      <div class="rp-add-grid">${intlList.map(btn).join("")}</div>`;
    }
    return html;
  }

  // v5.0.32: 新手推荐搭配 — 硬编码跨风格组合（避开千问互斥，默认国内可用），一键开多 AI 对比。
  //   组合都用国内直连 AI，新手无国际网络也能立即用；2 个即可开辩论。
  const RECO_COMBOS = [
    { label: "⚡ 双开对比", services: ["deepseek", "doubao"], desc: "最快开辩论" },
    { label: "🎯 三家会诊", services: ["deepseek", "doubao", "kimi"], desc: "多视角对比" },
  ];
  function renderRecommend() {
    return `
      <div class="rp-add-group-lbl">🎯 新手推荐搭配 · 一键添加（自由组合也行）</div>
      <div class="rp-reco-row">
        ${RECO_COMBOS.map(c => {
          const names = c.services.map(s => SERVICE_MAP[s]?.name || s).join(" + ");
          return `<button class="rp-reco-btn" data-reco="${c.services.join(",")}" title="一键添加 ${escapeHtml(names)} · ${escapeHtml(c.desc)}">${escapeHtml(c.label)}<small>${escapeHtml(names)}</small></button>`;
        }).join("")}
      </div>`;
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

  // ── v5.0.22 B: 登录复检（popup 驱动，规避 MV3 SW 空闲回收）+ 翻绿 toast ──
  let _recheckTimer = null;
  const _prevLoginStatus = new Map();
  function manageLoginRecheck() {
    const need = (state.participants || []).some(p => p.loginStatus === "login_required");
    if (need && !_recheckTimer) {
      _recheckTimer = setInterval(() => {
        (state.participants || [])
          .filter(p => p.loginStatus === "login_required")
          .forEach(p => {
            try { chrome.runtime.sendMessage({ type: "recheckLogin", id: p.id }, () => { void chrome.runtime.lastError; }); } catch (_) {}
          });
      }, 8000);
    } else if (!need && _recheckTimer) {
      clearInterval(_recheckTimer);
      _recheckTimer = null;
    }
  }
  // 审查修复：popup 关闭时清 interval（popup window 上下文销毁本会带走它，
  //   但 sidepanel 等 persistent 宿主复用本文件时会泄漏，显式清理兜底）
  window.addEventListener("unload", () => {
    if (_recheckTimer) { clearInterval(_recheckTimer); _recheckTimer = null; }
  });

  function trackLoginTransitions() {
    const alive = new Set();
    (state.participants || []).forEach(p => {
      alive.add(p.id);
      const prev = _prevLoginStatus.get(p.id);
      if (prev === "login_required" && p.loginStatus === "ok") {
        try { window.ChatToast?.show(`✓ ${p.name} 已登录就绪，可以提问了`, { type: "ok" }); } catch (_) {}
      }
      _prevLoginStatus.set(p.id, p.loginStatus);
    });
    [..._prevLoginStatus.keys()].forEach(id => { if (!alive.has(id)) _prevLoginStatus.delete(id); });
  }

  function render() {
    const root = document.getElementById("rp-panel-members");
    if (!root) return;
    trackLoginTransitions();
    manageLoginRecheck();
    const joined = state.participants || [];
    const joinedIds = new Set(joined.map(p => p.service));
    const remaining = ALL_SERVICES.filter(s => !joinedIds.has(s.id));

    // v4.8.0: 王者风 3 卡槽 — 替代逐行卡片列表
    // v4.8.1: 只对"新出现的 pid"加 .just-added（含 bounce 进场 + 流光 2 圈）；已存在的不动
    const MAX_SLOTS = 3;
    const currentPidSet = new Set(joined.map(p => p.id));
    const newPids = [...currentPidSet].filter(pid => !_lastPidSet.has(pid));
    // v5.0.20 UX-1: 队长 = joined[0]（≥2 人才有队长语义，与 captain-mode isCaptain 一致）
    const captainSvc = (window.ArenaCaptainInfo?.enabled?.() !== false && joined.length >= 2) ? joined[0]?.service : null;
    const slotsHtml = Array.from({ length: MAX_SLOTS }, (_, i) => {
      const p = joined[i];
      if (p) {
        const meta = SERVICE_MAP[p.service] || { name: p.service, logo: null, heroLogo: null };
        const status = statusOf(p);
        const isNew = newPids.includes(p.id);
        const captainMark = p.service === captainSvc ? '<div class="hero-slot-captain" title="队长：负责整合队友观点">👑</div>' : "";
        // v5.0.22 B: 登录红绿灯角标 — 未登录给可点的"去登录"，比文字指路直接
        const loginBadge = p.loginStatus === "login_required"
          ? `<button class="hero-slot-login" data-pid="${escapeHtml(p.id)}" title="检测到 ${escapeHtml(meta.name)} 未登录 — 点击打开它的网页登录（没账号用手机号注册），登录后自动变绿">🔑 去登录</button>`
          : "";
        // v4.8.7: 优先用卡牌版 heroLogo；旧 svg 作为兜底
        // v4.8.14: heroLogo 走 ArenaLogoStyle.heroPath() 动态切换风格（classic/anime）
        const heroSrc = (window.ArenaLogoStyle?.heroPath(p.service)) || meta.heroLogo || meta.logo;
        // v4.8.20 ① 出战动画：新加入时注入 6 颗星芒，CSS sparkOut 让它们散开
        const sparks = isNew ? Array(6).fill('<span class="hero-slot-spark"></span>').join("") : "";
        return `
          <div class="hero-slot-wrap" data-pid="${escapeHtml(p.id)}">
            <div class="hero-slot filled status-${status || 'idle'}${isNew ? ' just-added' : ''}" data-pid="${escapeHtml(p.id)}" data-slot="${i}" title="${escapeHtml(p.name || meta.name)} · ${statusTextOf(p)}">
              <div class="hero-slot-bg"></div>
              <div class="hero-slot-glow"></div>
              ${heroSrc
                ? `<img class="hero-slot-logo" src="${heroSrc}" alt="${escapeHtml(meta.name)}">`
                : `<span class="hero-slot-fb">${escapeHtml((meta.name || "?")[0])}</span>`}
              ${captainMark}
              <div class="hero-slot-name">${escapeHtml(meta.name)}</div>
              <div class="hero-slot-status"><span class="rp-status-dot ${status}"></span></div>
              ${loginBadge}
              <span class="hero-slot-check">✓</span>
              <button class="hero-slot-remove" data-pid="${escapeHtml(p.id)}" title="移除">×</button>
              ${sparks}
            </div>
            <!-- v4.8.41 + v4.8.42 + v4.8.43: 卡片下方 3 快捷按钮 icon-only，浏览器原生 title 显示文本 -->
            <div class="hero-quick-actions">
              <button class="hqa-btn" data-act="resend" data-pid="${escapeHtml(p.id)}" data-service="${escapeHtml(p.service)}" title="重新发送原题给 ${escapeHtml(meta.name)}">${window.ChatActionIcons?.svg("resend") || "📤"}</button>
              <button class="hqa-btn" data-act="reextract" data-pid="${escapeHtml(p.id)}" data-service="${escapeHtml(p.service)}" title="重新提取 ${escapeHtml(meta.name)} 当前回答">${window.ChatActionIcons?.svg("reextract") || "🔄"}</button>
              <button class="hqa-btn" data-act="skip" data-pid="${escapeHtml(p.id)}" data-service="${escapeHtml(p.service)}" title="跳过 ${escapeHtml(meta.name)} 本轮（解除 polling 卡住）">${window.ChatActionIcons?.svg("skip") || "⏭"}</button>
            </div>
          </div>`;
      }
      return `<div class="hero-slot-wrap"><div class="hero-slot empty" data-slot="${i}" title="空位 — 在下方选择 AI 添加"><div class="hero-slot-plus">＋</div><div class="hero-slot-empty-lbl">空位</div></div></div>`;
    }).join("");
    _lastPidSet = currentPidSet;

    // v5.0.20 UX-2: 本轮回答进度 — streamStatus 有任何记录（本轮发过问）才显示
    const _roundStatuses = joined.map(p => streamStatus.get(p.service)).filter(Boolean);
    const _doneN = joined.filter(p => streamStatus.get(p.service) === "ready").length;
    const progressHtml = _roundStatuses.length
      ? ` <span class="rp-round-progress${_doneN === joined.length ? " all-done" : ""}">本轮 ${_doneN}/${joined.length} 已答</span>`
      : "";

    root.innerHTML = `
      <div class="rp-section-title">已加入 <span class="rp-count">${joined.length}/${MAX_SLOTS}</span>${progressHtml}
        <button class="rp-doctor-btn" id="rp-doctor-btn" title="一键体检：检查每个 AI 的标签页/插件通道/登录状态，红灯项直接给修复按钮">🩺 体检</button>
      </div>
      <div class="hero-slots">
        ${slotsHtml}
      </div>

      <div class="rp-section-title" style="margin-top:14px">添加</div>
      ${joined.length < MAX_SLOTS ? renderRecommend() : ""}
      ${renderAddGroups(remaining)}

      ${renderLeaderboard()}
      ${renderManifesto()}
    `;

    root.querySelectorAll(".rp-add-btn").forEach(b => {
      b.addEventListener("click", () => addParticipant(b.dataset.service));
    });
    // v5.0.32: 新手推荐搭配一键添加
    root.querySelectorAll(".rp-reco-btn").forEach(b => {
      b.addEventListener("click", () => applyRecommend((b.dataset.reco || "").split(",").filter(Boolean), b));
    });
    // v5.0.22 B: 未登录角标 → 激活该 AI 的标签页去登录
    root.querySelectorAll(".hero-slot-login").forEach(el => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        try { chrome.runtime.sendMessage({ type: "activateParticipantTab", id: el.dataset.pid }, () => { void chrome.runtime.lastError; }); } catch (_) {}
      });
    });
    // v5.2.25: 右上角 × 直接移除（替代 v4.8.0 三点菜单——重发/重新提取已在下方 hqa-btn）
    root.querySelectorAll(".hero-slot-remove").forEach(el => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        removeParticipant(el.dataset.pid);
      });
    });
    // v4.8.41: 卡片下方快捷按钮（重发/提取/跳过）
    root.querySelectorAll(".hqa-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const act = btn.dataset.act;
        const pid = btn.dataset.pid;
        const service = btn.dataset.service;
        if (act === "resend") retryInject(pid);
        else if (act === "reextract") reextractOne(pid);
        else if (act === "skip") skipOne(service);
      });
    });
    // v4.3.15: 排行榜折叠按钮
    root.querySelector("#rp-lb-toggle")?.addEventListener("click", toggleLeaderboard);
    // v4.8.1: 800ms 后移除 .just-added，避免下次 render 重启动画（用户 hover 仍能触发短暂流光）
    // animation 时长 0.45s bounce + 2*2.6s shimmer = 5.65s 但 CSS animation 只跑 1 次后保持终态，
    // 这里只需保证 class 在下次 render 前能消失即可
    // v5.0.8 perf: clearTimeout 旧句柄防多次 render 累积 pending setTimeout
    if (_justAddedTimer) clearTimeout(_justAddedTimer);
    _justAddedTimer = setTimeout(() => {
      _justAddedTimer = null;
      root.querySelectorAll(".hero-slot.just-added").forEach(el => el.classList.remove("just-added"));
    }, 6000);
  }
  let _justAddedTimer = null;

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
    chrome.runtime.sendMessage({ type: "addParticipant", service }, (r) => {
      // v5.2.23: 千问与其他 AI 互斥 — background 守卫拒绝时弹提示
      if (r?.error === "QWEN_INCOMPATIBLE" && r?.message) {
        try { alert(r.message); } catch (_) {}
      }
      // v5.0.22 B: 把"后台静默开 tab"翻译给用户 — 萌新点了 Logo 看不到任何变化会以为没反应
      if (r?.ok) {
        const meta = SERVICE_MAP[service];
        try { window.ChatToast?.show(`已在后台打开 ${meta?.name || service} 的网页 — 若要求登录，请先登录`, { type: "info" }); } catch (_) {}
      }
      try { window.focus(); } catch (_) {}
      refresh();
    });
  }

  // v5.0.32: addParticipant 的 Promise 版（推荐搭配串行添加用）
  function addParticipantAsync(service) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "addParticipant", service }, (r) => {
        void chrome.runtime.lastError;
        if (r?.error === "QWEN_INCOMPATIBLE" && r?.message) { try { alert(r.message); } catch (_) {} }
        else if (r?.ok) { const meta = SERVICE_MAP[service]; try { window.ChatToast?.show(`已添加 ${meta?.name || service}`, { type: "info" }); } catch (_) {} }
        try { window.focus(); } catch (_) {}
        refresh();
        resolve(r || {});
      });
    });
  }

  async function applyRecommend(services, btn) {
    const joinedSvc = new Set((state.participants || []).map(p => p.service));
    const todo = services.filter(s => !joinedSvc.has(s));
    if (!todo.length) {
      try { window.ChatToast?.show("这些 AI 已在圆桌里了", { type: "info" }); } catch (_) {}
      return;
    }
    if (btn) { btn.disabled = true; btn.classList.add("loading"); }
    try {
      for (const s of todo) {
        const r = await addParticipantAsync(s);
        if (r?.error) break;   // 上限/互斥被拒 → 停止后续，提示已给
        await new Promise(res => setTimeout(res, 450));  // 错开开 tab，避免并发竞态
      }
      try { window.ChatToast?.show("推荐搭配已就位 — 在底部输入问题，Ctrl+Enter 同时问", { type: "ok" }); } catch (_) {}
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove("loading"); }
    }
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

  // v4.8.41: 跳过本轮 — service 而非 pid（chat-bus.skipParticipant 以 service 做 polling Map key）
  function skipOne(service) {
    chrome.runtime.sendMessage({ type: "chatSkipParticipant", participantId: service }, () => {});
  }

  // v5.2.25: 删除 openActionMenu/closeActionMenu — 卡牌右上角 × 直接移除，重发/重新提取已在下方 hqa-btn

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
