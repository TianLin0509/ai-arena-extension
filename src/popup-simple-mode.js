// popup-simple-mode.js — v5.0.71 精简/全量双模式；v5.0.72 按用户反馈重修：
//   「太精简了」三连修 —— ① 右栏成员面板改为常驻显式（不再藏抽屉，小白一眼看到怎么加 AI）
//   ② 空状态换三步指引条（加 AI → 问问题 → 辩论/总结），step1 随成员数打勾
//   ③ 辩论/总结 = 常驻动作条（核心主打必须看得见）：未就绪置灰 + 提示，≥2 家答完点亮
//   精简模式 = 聊天单栏 + 成员栏两列；全量 = 原三栏全功能。
//   默认策略：新装用户 = 精简；老用户（已解锁进阶 / 关过教程 / 已有成员）= 全量不打扰。
(function () {
  const KEY = "uiMode";   // "simple" | "full"
  const $seg = document.getElementById("ui-mode-seg");
  const $newBtn = document.getElementById("btn-simple-new");
  const $ctxbar = document.getElementById("simple-ctxbar");
  const $actDebate = document.getElementById("sm-act-debate");
  const $actCollab = document.getElementById("sm-act-collab");
  const $actSummary = document.getElementById("sm-act-summary");
  const $actHint = document.getElementById("sm-act-hint");
  const $guideStep1 = document.getElementById("esg-step-1");
  if (!$seg || !$ctxbar || !$actDebate || !$actCollab || !$actSummary) return;

  let mode = null;            // 当前模式
  let participants = [];      // 最新参与者快照（stateUpdate 同步）
  let debateCount = 0;        // 本会话辩论次数 → 按钮文案（首辩 vs 再辩）
  let actsPending = false;    // 动作已发出、等待流消息确认（期间置灰防连点）
  let pendingTimer = null;
  const roundDone = new Set();   // 本轮已正常完成的 service
  const roundBusy = new Set();   // 本轮输出中的 service

  function isSimple() { return document.body.classList.contains("simple-mode"); }

  // ── 模式切换 ──
  function applyMode(next, opts = {}) {
    mode = next === "full" ? "full" : "simple";
    // 四路审查修复：mini 折叠态与精简互斥 — mini 持久化（popupMode）重启会还原，
    //   若不先退出，simple CSS 藏掉 #btn-mini-mode 会把用户锁死在 mini 一行里
    if (mode === "simple" && document.body.getAttribute("data-mode") === "mini") {
      try { document.getElementById("btn-mini-mode")?.click(); } catch (_) {}
    }
    document.body.classList.toggle("simple-mode", mode === "simple");
    $seg.querySelectorAll("button[data-uimode]").forEach(b =>
      b.classList.toggle("on", b.dataset.uimode === mode));
    if (mode === "simple") {
      // 任务下拉被隐藏 → 归位「同时提问」，防隐藏态里残留 debate/summary 让发送"没反应"
      try { window.ChatTaskMenu?.setTask?.("ask"); } catch (_) {}
      // 右栏常驻只留成员面板（tabs 隐藏），确保激活的就是成员页
      try { window.ChatRightPanel?.activate?.("members"); } catch (_) {}
      refreshActs();
      refreshGuide();
    }
    else {
      // 用户明确选了全量 → 静默解锁渐进披露，「全量」所见即全部（避免两套显隐叠加）
      try { window.ChatProgressive?.unlock?.("mode-full"); } catch (_) {}
    }
    try { chrome.storage.local.set({ [KEY]: mode }); } catch (_) {}
    try { window.ChatMembers?.render?.(); } catch (_) {}
    if (opts.announce) {
      const text = mode === "simple"
        ? "已切到精简模式 — 加 AI · 同时提问 · 辩论 / 总结"
        : "已切到全量模式 — 记录 / PPT / 对比 / 模板全部可见";
      try { window.ChatToast?.show(text, { type: "ok" }); } catch (_) {}
    }
  }

  $seg.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-uimode]");
    if (!b || b.dataset.uimode === mode) return;
    applyMode(b.dataset.uimode, { announce: true });
  });

  // ── ↺ 彻底重置：代理 btn-hard-reset（其危险确认 Modal / 全清链路零复制；用户点名 v5.0.73） ──
  $newBtn?.addEventListener("click", () => {
    document.getElementById("btn-hard-reset")?.click();
  });

  // ── 三步指引条：step1（加 AI）随成员数打勾 ──
  function refreshGuide() {
    if (!$guideStep1) return;
    $guideStep1.classList.toggle("done", participants.length > 0);
  }

  // ── 常驻动作条：⚔️ 辩论 / 📋 总结 ──
  //   就绪条件（两者一致，对齐 background insufficient_responses 口径）：
  //   参与者 ≥2 · 本轮 ≥2 家正常完成 · 无人还在输出 · 没有在飞的动作
  function actsReady() {
    const alive = new Set(participants.map(p => p.service));
    const done = [...roundDone].filter(s => alive.has(s)).length;
    const busy = [...roundBusy].filter(s => alive.has(s)).length;
    return participants.length >= 2 && done >= 2 && busy === 0;
  }
  function refreshActs() {
    if (!isSimple()) return;
    const ready = actsReady() && !actsPending;
    [$actDebate, $actCollab, $actSummary].forEach(b => {
      b.disabled = !ready;
      b.classList.toggle("ready", ready);
    });
    $actDebate.textContent = debateCount > 0 ? "⚔️ 再辩一轮" : "⚔️ 辩论·互挑错";
    if ($actHint) {
      $actHint.textContent = actsPending ? "已发出，等 AI 响应…"
        : ready ? "就绪 — 辩论 / 协作 / 总结任选"
        : participants.length < 2 ? "加 ≥2 个 AI 后可用"
        : "等 2 个 AI 回答完解锁";
    }
  }
  // 动作发出后置灰防连点；真开动了会有 user 流消息清 roundDone（保持灰到答完），
  // 被 needsConfirm 取消 / 失败没有任何流消息 → 1.6s 后按真实状态自愈复亮（四路审查修复）
  function markPending() {
    actsPending = true;
    refreshActs();
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => { actsPending = false; refreshActs(); }, 1600);
  }

  // 辩论=free / 协作=collab 共用一条发射链路
  // handleSend → dispatch 在 click 事件内同步捕获 task=debate（见 popup-task-menu.js
  // dispatch 入口 const c = current），click() 返回后立即归位 ask 是安全的
  function fireDebate(style) {
    try { window.ChatTaskMenu?.setTask?.("debate", { style }); } catch (_) {}
    document.getElementById("btn-send")?.click();
    try { window.ChatTaskMenu?.setTask?.("ask"); } catch (_) {}
    markPending();
  }
  $actDebate.addEventListener("click", () => {
    if (!$actDebate.disabled) fireDebate("free");
  });
  $actCollab.addEventListener("click", () => {
    if (!$actCollab.disabled) fireDebate("collab");
  });

  $actSummary.addEventListener("click", () => {
    if ($actSummary.disabled) return;
    // 队长（participants[0]，与 captain-mode 同语义）自动担任裁判 — 小白免选人
    const judge = participants[0];
    if (!judge) return;
    try { window.ChatTaskMenu?.setTask?.("summary", { judgeId: judge.id, judgeName: judge.name }); } catch (_) {}
    document.getElementById("btn-send")?.click();
    try { window.ChatTaskMenu?.setTask?.("ask"); } catch (_) {}
    try { window.ChatToast?.show(`已请 ${judge.name || "队长"} 担任裁判，正在汇总全场观点…`, { type: "info" }); } catch (_) {}
    markPending();
  });

  document.addEventListener("task:dispatched", (e) => {
    // 只有自由辩论累计「再辩」计数；协作（collab）不改辩论按钮文案
    if (e.detail?.task === "debate" && e.detail?.style !== "collab") debateCount++;
  });

  // ── 消息流跟踪（失败口径对齐 popup-progressive.isMeaningfulAnswer：
  //    loginWarning/emptyTimeout/forcedTimeout/skipped/injectError 的 isDone 不算有效回答） ──
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === "stateUpdate") {
        if (Array.isArray(msg.participants)) participants = msg.participants;
        refreshGuide();
        refreshActs();
        return;
      }
      if (msg?.type === "chatClear" || msg?.type === "hardReset") {
        roundDone.clear(); roundBusy.clear(); debateCount = 0; actsPending = false;
        refreshGuide();
        refreshActs();
        return;
      }
      if (msg?.type !== "chatStreamUpdate") return;
      if (msg.role === "user") {
        // 新一轮（提问或辩论/总结指令）→ 清计数，等各家答完再点亮
        roundDone.clear(); roundBusy.clear();
        actsPending = false;
        refreshActs();
        return;
      }
      if (msg.role === "ai" && msg.participantId) {
        const svc = msg.participantId;
        const failed = msg.loginWarning || msg.emptyTimeout || msg.forcedTimeout
          || msg.skipped || msg.injectError;
        if (failed) { roundBusy.delete(svc); roundDone.delete(svc); }
        else if (msg.isDone) { roundBusy.delete(svc); roundDone.add(svc); }
        else { roundBusy.add(svc); }
        refreshActs();
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
    //   （与 popup-members.js statusOf 的 fallback 同口径），否则上轮已答完动作条不点亮
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

  // 彻底重置的本轮状态清理（popup.js doHardReset 回调 — 同 popup 内 sendMessage 不回环，
  // 靠 background 广播不可靠，直接钩子最稳）
  function reset() {
    roundDone.clear(); roundBusy.clear();
    debateCount = 0; actsPending = false;
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    refreshGuide();
    refreshActs();
  }

  window.ChatSimpleMode = {
    isSimple,
    setMode: (m) => applyMode(m, { announce: false }),
    reset,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
