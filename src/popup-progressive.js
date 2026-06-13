// popup-progressive.js — v5.0.26
//   ① 渐进式功能披露：新手默认只露「同时提问」，辩论/裁判/PPT/接力棒折叠进「进阶」，
//      首答 / 新手之旅毕业 / 手动点击后解锁（storage advancedUnlocked 持久）。
//      老用户（tutorialDismissed / 已跳过引导）视同已解锁，不打扰。
//   ④ 首次拿到回答后的「下一步」行为触发引导：首答完成时浮出追问/辩论/裁判三选项，
//      在用户刚尝到甜头的瞬间顺势介绍进阶玩法（Zeigarnik 未闭合循环）。
//      与新手之旅互斥：新手之旅进行中不弹（让它主导），跳过/老用户才弹。
(function () {
  const ADV_KEY = "advancedUnlocked";
  const HINT_KEY = "nextStepHintShown";
  let unlocked = false;
  let hintShown = false;
  let nsTimer = null;
  let _initialized = false;   // 审查修复：onMessage listener 同步注册早于 async init，未就绪时忽略消息

  function applyLockClass() {
    document.body.classList.toggle("adv-locked", !unlocked);
  }

  function unlock(reason) {
    if (unlocked) return;
    unlocked = true;
    try { chrome.storage.local.set({ [ADV_KEY]: true }); } catch (_) {}
    applyLockClass();
    if (reason === "manual") {
      try { window.ChatToast?.show("已解锁全部玩法：辩论 / 裁判总结 / PPT / 接力棒", { type: "ok" }); } catch (_) {}
    }
  }

  // ── ④ 下一步引导卡片 ──
  function removeNextStep() {
    if (nsTimer) { clearTimeout(nsTimer); nsTimer = null; }
    const el = document.getElementById("arena-nextstep");
    if (el) { try { el.remove(); } catch (_) {} }
  }

  async function participantCount() {
    try {
      const r = await new Promise(res => chrome.runtime.sendMessage({ type: "getState" }, resp => res(resp || {})));
      return Array.isArray(r.participants) ? r.participants.length : 0;
    } catch (_) { return 0; }
  }

  function onNextStepClick(e) {
    const act = e.target?.dataset?.ns;
    if (!act) return;
    if (act === "close") { removeNextStep(); return; }
    if (act === "followup") {
      removeNextStep();
      const input = document.getElementById("chat-input");
      if (input) { input.focus(); try { input.scrollIntoView({ block: "nearest" }); } catch (_) {} }
      try { window.ChatToast?.show("直接在输入框追问即可，AI 会接着上一轮回答", { type: "info" }); } catch (_) {}
      return;
    }
    if (act === "debate") {
      removeNextStep();
      participantCount().then(n => {
        if (n >= 2) {
          window.ChatTaskMenu?.setTask?.("debate");
          try { window.ChatToast?.show("已切到「辩论」模式 — 可输入引导词或留空，Ctrl+Enter 开始", { type: "ok" }); } catch (_) {}
        } else {
          try { window.ChatRightPanel?.activate("members"); } catch (_) {}
          try { window.ChatToast?.show("辩论需要至少 2 个 AI — 先到「成员」再加一个", { type: "warn" }); } catch (_) {}
        }
      });
      return;
    }
    if (act === "summary") {
      removeNextStep();
      participantCount().then(n => {
        if (n >= 2) {
          document.getElementById("task-picker-btn")?.click();
          try { window.ChatToast?.show("在菜单里点「裁判总结」，选一个 AI 当裁判", { type: "info" }); } catch (_) {}
        } else {
          try { window.ChatRightPanel?.activate("members"); } catch (_) {}
          try { window.ChatToast?.show("裁判总结需要至少 2 个 AI — 先加一个", { type: "warn" }); } catch (_) {}
        }
      });
      return;
    }
  }

  function maybeShowNextStep() {
    if (hintShown) return;
    hintShown = true;
    try { chrome.storage.local.set({ [HINT_KEY]: true }); } catch (_) {}
    // 新手之旅进行中（卡片存在且未毕业）→ 不弹，避免双卡打架；新手之旅会自己引导下一步
    const ob = document.getElementById("arena-onboarding");
    if (ob && !ob.classList.contains("graduated")) return;
    removeNextStep();
    const card = document.createElement("div");
    card.id = "arena-nextstep";
    card.innerHTML = `
      <div class="ns-head">💡 第一次问完了！想更深入？</div>
      <div class="ns-actions">
        <button data-ns="followup">✍️ 继续追问</button>
        <button data-ns="debate">⚔️ 让它们辩论</button>
        <button data-ns="summary">📋 选个裁判总结</button>
      </div>
      <button class="ns-close" data-ns="close">知道了</button>`;
    document.body.appendChild(card);
    card.addEventListener("click", onNextStepClick);
    requestAnimationFrame(() => card.classList.add("show"));
    nsTimer = setTimeout(removeNextStep, 16000);
  }

  // 首答信号：第一条「正常完成」的 AI 回答（排除登录警告/超时/跳过/注入失败气泡）
  //   审查修复：辩论 inject 失败 / 补发失败气泡也是 role=ai isDone=true，靠 injectError 排除，
  //   否则用户发起辩论却全部 inject 失败时会误弹"第一次问完了"
  function isMeaningfulAnswer(msg) {
    return msg?.type === "chatStreamUpdate" && msg.role === "ai" && msg.isDone
      && !msg.loginWarning && !msg.emptyTimeout && !msg.forcedTimeout && !msg.skipped
      && !msg.injectError;
  }

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!_initialized) return;   // 审查修复：init 读 storage 完成前忽略消息，防 hintShown 被回写覆盖
      if (isMeaningfulAnswer(msg)) {
        unlock("firstAnswer");   // ① 首答即解锁进阶
        maybeShowNextStep();     // ④ 顺势引导下一步
      }
    });
  } catch (_) {}

  // 进阶菜单顶部「解锁」行（事件委托，task-menu innerHTML 不重建但稳妥起见用委托）
  document.addEventListener("click", (e) => {
    if (e.target?.closest?.("[data-task-unlock]")) {
      e.stopPropagation();
      unlock("manual");
    }
  });

  async function init() {
    let r = {};
    try {
      r = await new Promise(res => chrome.storage.local.get([ADV_KEY, HINT_KEY, "tutorialDismissed", "onboardingFacts"], resp => res(resp || {})));
    } catch (_) {}
    hintShown = !!r[HINT_KEY];
    const legacy = r.tutorialDismissed || r.onboardingFacts?.skipped || r.onboardingFacts?.legacy;
    if (r[ADV_KEY] === true || legacy) {
      unlocked = true;
      if (!r[ADV_KEY] && legacy) { try { chrome.storage.local.set({ [ADV_KEY]: true }); } catch (_) {} }
    }
    _initialized = true;
    applyLockClass();
  }

  // 暴露给 onboarding（毕业时解锁）
  window.ChatProgressive = { unlock, isUnlocked: () => unlocked };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
