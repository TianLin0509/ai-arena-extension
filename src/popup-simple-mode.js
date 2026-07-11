// popup-simple-mode.js — v5.0.71 精简/全量 双模式
//   精简 = 微信式单栏，主打「多 AI 同时提问 + 一键辩论」两个核心动作：
//     · 常驻决策点 ≤6：头像条＋ / ↺新对话 / 精简·全量开关 / 输入 / 发送
//     · 其余上下文化：套餐卡只在空状态（es-quickstart 既有链路）、辩论 pill 只在
//       ≥2 家答完且无人输出中时浮现、登录修复长在出错气泡里（bubble-login-btn 既有）
//   全量 = 原三栏完整界面（时光机 / PPT / 对比 / 模板 / 角色帽 / 状态日志…）。
//   默认策略：新装用户 = 精简；老用户（已解锁进阶 / 关过教程 / 已有成员）= 全量不打扰。
(function () {
  const KEY = "uiMode";   // "simple" | "full"
  const $seg = document.getElementById("ui-mode-seg");
  const $avatars = document.getElementById("simple-avatars");
  const $newBtn = document.getElementById("btn-simple-new");
  const $ctxbar = document.getElementById("simple-ctxbar");
  const $pill = document.getElementById("simple-debate-pill");
  const $drawerClose = document.getElementById("sm-drawer-close");
  const $rightpanel = document.getElementById("chat-rightpanel");
  if (!$seg || !$avatars || !$ctxbar) return;

  // 品牌 logo 小图（与 popup.js BRAND_SVG 同源资产；9 行小映射不跨模块引避免暴露内部表）
  const BRAND = {
    claude: "icons/brands/claude.svg", gemini: "icons/brands/gemini.svg",
    chatgpt: "icons/brands/openai.svg", deepseek: "icons/brands/deepseek.svg",
    doubao: "icons/brands/doubao.svg", qwen: "icons/brands/qwen.svg",
    kimi: "icons/brands/kimi.svg", yuanbao: "icons/brands/yuanbao.svg",
    grok: "icons/brands/grok.svg",
  };
  const MAX_SLOTS = 3;

  let mode = null;            // 当前模式
  let participants = [];      // 最新参与者快照（stateUpdate 同步）
  let debateCount = 0;        // 本会话辩论次数 → pill 文案（首次 vs 再辩）
  const roundDone = new Set();   // 本轮已正常完成的 service
  const roundBusy = new Set();   // 本轮输出中的 service

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }
  function isSimple() { return document.body.classList.contains("simple-mode"); }

  // ── 模式切换 ──
  function applyMode(next, opts = {}) {
    mode = next === "full" ? "full" : "simple";
    // 四路审查修复：mini 折叠态与精简单栏互斥 — mini 持久化（popupMode）重启会还原，
    //   若不先退出，simple CSS 藏掉 #btn-mini-mode 会把用户锁死在 mini 一行里
    if (mode === "simple" && document.body.getAttribute("data-mode") === "mini") {
      try { document.getElementById("btn-mini-mode")?.click(); } catch (_) {}
    }
    document.body.classList.toggle("simple-mode", mode === "simple");
    $seg.querySelectorAll("button[data-uimode]").forEach(b =>
      b.classList.toggle("on", b.dataset.uimode === mode));
    closeDrawer();
    if (mode === "simple") {
      // 任务下拉被隐藏 → 归位「同时提问」，防隐藏态里残留 debate/summary 让发送"没反应"
      try { window.ChatTaskMenu?.setTask?.("ask"); } catch (_) {}
      try { window.ChatRightPanel?.activate?.("members"); } catch (_) {}
      renderAvatars();
      refreshPill();
    } else {
      hidePill();
      // 用户明确选了全量 → 静默解锁渐进披露，「全量」所见即全部（避免两套显隐叠加）
      try { window.ChatProgressive?.unlock?.("mode-full"); } catch (_) {}
    }
    try { chrome.storage.local.set({ [KEY]: mode }); } catch (_) {}
    // 空状态提示文案随模式变（members.renderEsQuickstart 读 body class）
    try { window.ChatMembers?.render?.(); } catch (_) {}
    if (opts.announce) {
      const text = mode === "simple"
        ? "已切到精简模式 — 专注提问与辩论，完整功能在「全量」"
        : "已切到全量模式 — 记录 / PPT / 对比 / 模板全部可见";
      try { window.ChatToast?.show(text, { type: "ok" }); } catch (_) {}
    }
  }

  $seg.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-uimode]");
    if (!b || b.dataset.uimode === mode) return;
    applyMode(b.dataset.uimode, { announce: true });
  });

  // ── ↺ 新对话：代理 btn-clear（其确认 Modal / 清空链路零复制） ──
  $newBtn?.addEventListener("click", () => {
    document.getElementById("btn-clear")?.click();
  });

  // ── 成员头像条 + 抽屉 ──
  function renderAvatars() {
    if (!isSimple()) return;
    const items = participants.slice(0, MAX_SLOTS).map(p => {
      const src = BRAND[p.service];
      const inner = src ? `<img src="${src}" alt="">` : esc((p.name || "?")[0]);
      return `<span class="sa-ava" title="${esc(p.name || p.service)}">${inner}</span>`;
    }).join("");
    const add = participants.length < MAX_SLOTS
      ? `<span class="sa-ava sa-add" title="添加 AI">＋</span>` : "";
    $avatars.innerHTML = items + add;
  }
  function openDrawer() {
    document.body.classList.add("sm-drawer-open");
    if ($rightpanel) $rightpanel.inert = false;
    try { window.ChatRightPanel?.activate?.("members"); } catch (_) {}
  }
  // 四路审查修复（a11y）：抽屉收起时仅 transform 出屏，Tab/读屏仍可达 — inert 一并摘除；
  //   全量模式右栏常驻可交互，inert 必须为 false
  function closeDrawer() {
    document.body.classList.remove("sm-drawer-open");
    if ($rightpanel) $rightpanel.inert = isSimple();
  }
  $avatars.addEventListener("click", (e) => {
    e.stopPropagation();
    if (document.body.classList.contains("sm-drawer-open")) closeDrawer();
    else openDrawer();
  });
  $drawerClose?.addEventListener("click", closeDrawer);
  // 点抽屉外任意处收起（抽屉自身与头像条除外）
  document.addEventListener("click", (e) => {
    if (!isSimple() || !document.body.classList.contains("sm-drawer-open")) return;
    if ($rightpanel?.contains(e.target) || $avatars.contains(e.target)) return;
    closeDrawer();
  });
  document.addEventListener("keydown", (e) => {
    // 四路审查修复：Modal 打开时 Escape 归 Modal（取消语义），不顺手带走背后的抽屉
    if (e.key === "Escape" && !document.querySelector(".arena-modal-overlay")) closeDrawer();
  });

  // ── 上下文辩论 pill ──
  //   浮现条件：精简模式 · 参与者 ≥2 · 本轮 ≥2 家正常完成 · 无人还在输出
  //   点击 = setTask(debate) + 空输入发送（debate 留空即用默认互评引导），随即归位 ask，
  //   输入框始终保持「同时提问」语义。needsConfirm / 失败弹窗等由既有 dispatch 链路兜底。
  function refreshPill() {
    if (!isSimple()) { hidePill(); return; }
    const alive = new Set(participants.map(p => p.service));
    const done = [...roundDone].filter(s => alive.has(s)).length;
    const busy = [...roundBusy].filter(s => alive.has(s)).length;
    if (participants.length >= 2 && done >= 2 && busy === 0) {
      $pill.textContent = debateCount > 0
        ? "🔁 再辩一轮 — 互相点评最新回答"
        : "🔥 让他们互相挑错 — 辩论一轮";
      $ctxbar.hidden = false;
    } else {
      hidePill();
    }
  }
  function hidePill() { $ctxbar.hidden = true; }

  $pill?.addEventListener("click", () => {
    hidePill();
    try { window.ChatTaskMenu?.setTask?.("debate"); } catch (_) {}
    // handleSend → dispatch 在 click 事件内同步捕获 task=debate（见 popup-task-menu.js
    // dispatch 入口 const c = current），click() 返回后立即归位 ask 是安全的
    document.getElementById("btn-send")?.click();
    try { window.ChatTaskMenu?.setTask?.("ask"); } catch (_) {}
    // 四路审查修复：辩论被 needsConfirm 取消 / debateRound 失败时不会有任何流消息，
    //   pill 会永久消失 — 延时按真实状态重算：真开辩了会有 user 消息清掉 roundDone
    //   （pill 合法隐藏），没开成则 roundDone 未动 → pill 自愈复现
    setTimeout(refreshPill, 1600);
  });

  document.addEventListener("task:dispatched", (e) => {
    if (e.detail?.task === "debate") debateCount++;
  });

  // ── 消息流跟踪（与 popup-members.js streamStatus 同一套信号语义） ──
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === "stateUpdate") {
        if (Array.isArray(msg.participants)) participants = msg.participants;
        renderAvatars();
        refreshPill();
        return;
      }
      if (msg?.type === "chatClear" || msg?.type === "hardReset") {
        roundDone.clear(); roundBusy.clear(); debateCount = 0;
        hidePill();
        return;
      }
      if (msg?.type !== "chatStreamUpdate") return;
      if (msg.role === "user") {
        // 新一轮（提问或辩论指令）→ 清计数、收 pill，等各家答完再浮现
        roundDone.clear(); roundBusy.clear();
        hidePill();
        return;
      }
      if (msg.role === "ai" && msg.participantId) {
        const svc = msg.participantId;
        const failed = msg.loginWarning || msg.emptyTimeout || msg.forcedTimeout
          || msg.skipped || msg.injectError;
        if (failed) { roundBusy.delete(svc); roundDone.delete(svc); }
        else if (msg.isDone) { roundBusy.delete(svc); roundDone.add(svc); }
        else { roundBusy.add(svc); }
        refreshPill();
      }
    });
  } catch (_) {}

  // ── 初始化：storage 有 uiMode 用之；没有则按用户画像判默认并固化 ──
  async function init() {
    let stored = {};
    try {
      stored = await new Promise(res => chrome.storage.local.get(
        [KEY, "advancedUnlocked", "tutorialDismissed", "onboardingFacts"], r => res(r || {})));
    } catch (_) {}
    try {
      const s = await new Promise(res => chrome.runtime.sendMessage({ type: "getState" }, r => {
        void chrome.runtime.lastError; res(r || {});
      }));
      if (Array.isArray(s.participants)) participants = s.participants;
    } catch (_) {}
    // 四路审查修复：popup 重开不重放 chatStreamUpdate — 从 getState 快照播种本轮状态
    //   （与 popup-members.js statusOf 的 fallback 同口径），否则上轮已答完也永远不出 pill
    participants.forEach(p => {
      if (p.isStreaming) roundBusy.add(p.service);
      else if ((p.response || p.responsePreview) && !p.error) roundDone.add(p.service);
    });
    let m = stored[KEY];
    if (m !== "simple" && m !== "full") {
      const legacy = stored.advancedUnlocked === true || stored.tutorialDismissed
        || stored.onboardingFacts?.skipped || stored.onboardingFacts?.legacy
        || participants.length > 0;
      m = legacy ? "full" : "simple";
    }
    // 四路审查修复：init 异步窗口内用户已手点 seg → 尊重用户选择，不用旧快照覆盖
    if (mode === null) applyMode(m);
  }

  window.ChatSimpleMode = {
    isSimple,
    setMode: (m) => applyMode(m, { announce: false }),
    openDrawer, closeDrawer,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
