// popup-onboarding.js — v5.0.22 任务式新手之旅 + 调试黄条安抚
// 设计（详见 onboarding-core.js）：状态驱动的 4 步 checklist，替代"首启自动弹 5 页教程"。
//   - 每步由真实状态自动打勾（加成员 / 登录探测 ok / 首条回答 done / 第二个成员）
//   - 每步只说一句话 + 一个动作按钮 + 界面聚光灯，可随时跳过
//   - 老用户豁免：tutorialDismissed=true 且无 onboardingFacts → 视同已毕业，零打扰
// 黄条安抚（方案 C）：background 首次 CDP attach 前发 debuggerNotice → 这里弹一次性 modal
(function () {
  const Core = window.ArenaOnboardingCore;
  if (!Core) return;
  const FACTS_KEY = "onboardingFacts";
  const DEBUGGER_NOTICE_KEY = "debuggerNoticeShown";
  const LOGIN_FALLBACK_MS = 45000; // 步骤 2 探测长期无结论的放行兜底

  let facts = null;
  let card = null;
  let participants = [];        // 最近一次 stateUpdate 的参与者（取 loginStatus 用）
  let loginFallbackTimer = null;
  let graduateHideTimer = null;
  let saveTimer = null;
  let collapsed = false;

  function persist() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try { chrome.storage.local.set({ [FACTS_KEY]: facts }); } catch (_) {}
    }, 150);
  }

  // 注：onMessage 的 stateUpdate 与 init 的 getState 回调可能交错重复触发本函数 —
  //   applyEvent 单调幂等 + factsEqual 短路，重复调用只是多一次 render()，无副作用
  function update(ev) {
    if (!facts) return;
    const prevGraduated = Core.isGraduated(facts);
    const next = Core.applyEvent(facts, ev);
    if (Core.factsEqual(facts, next)) { render(); return; }
    facts = next;
    persist();
    if (!prevGraduated && Core.isGraduated(facts)) {
      renderGraduation();
      return;
    }
    render();
  }

  // ── 聚光灯：给目标元素加 3.5s 呼吸光圈 ──
  let spotTimer = null;
  function spotlight(selector) {
    document.querySelectorAll(".arena-spot").forEach(el => el.classList.remove("arena-spot"));
    const el = document.querySelector(selector);
    if (!el) return false;
    el.classList.add("arena-spot");
    try { el.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (_) {}
    if (spotTimer) clearTimeout(spotTimer);
    spotTimer = setTimeout(() => el.classList.remove("arena-spot"), 3500);
    return true;
  }

  function gotoMembers() {
    try { window.ChatRightPanel?.activate("members"); } catch (_) {}
    setTimeout(() => spotlight(".rp-add-grid"), 120);
  }

  const EXAMPLE_Q = "5000 元预算买手机：iPhone 还是华为？给出明确推荐";

  function fillExample() {
    const input = document.getElementById("chat-input");
    if (!input) return;
    // 与 popup-memos 引用同款：追加文本节点（不动已有内容），不派发 input 事件防 @ 菜单误触
    if (input.textContent && !/\s$/.test(input.textContent)) {
      input.appendChild(document.createTextNode("\n"));
    }
    input.appendChild(document.createTextNode(EXAMPLE_Q));
    try {
      const range = document.createRange();
      range.selectNodeContents(input);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {}
    input.focus();
    if (!spotlight(".chat-input-wrap")) spotlight("#chat-input");
  }

  function firstLoginRequired() {
    return participants.find(p => p.loginStatus === "login_required") || null;
  }

  // ── 步骤 2 兜底：探测可能拿不到结论（页面加载慢/站点改版），不能把用户卡死在这一步 ──
  function armLoginFallback() {
    if (loginFallbackTimer) return;
    loginFallbackTimer = setTimeout(() => {
      loginFallbackTimer = null;
      if (facts && Core.deriveStep(facts) === 2 && !firstLoginRequired()) {
        update({ type: "loginFallback" });
      } else if (facts && Core.deriveStep(facts) === 2) {
        armLoginFallbackRetry();
      }
    }, LOGIN_FALLBACK_MS);
  }
  // 明确"未登录"时不放行，但持续观察：用户登录后探测复检会广播 ok，update 自动推进
  function armLoginFallbackRetry() {
    if (loginFallbackTimer) return;
    loginFallbackTimer = setTimeout(() => { loginFallbackTimer = null; armLoginFallback(); }, LOGIN_FALLBACK_MS);
  }
  function disarmLoginFallback() {
    if (loginFallbackTimer) { clearTimeout(loginFallbackTimer); loginFallbackTimer = null; }
  }

  function stepBody(step) {
    if (step === 1) {
      return {
        hint: "在右侧「成员」里点一个 🟢 标记的 AI（如 DeepSeek）加入圆桌",
        btn: { label: "带我去 →", act: "goto-members" },
      };
    }
    if (step === 2) {
      const need = firstLoginRequired();
      if (need) {
        return {
          hint: `检测到 ${need.name || need.service} 还没登录 — 去它的网页登录（没账号用手机号注册即可），登录后这里自动变绿`,
          btn: { label: "🔑 去登录页", act: "goto-login" },
        };
      }
      return { hint: "正在检测 AI 网页的登录状态…（已登录会自动通过）", btn: null };
    }
    if (step === 3) {
      return {
        hint: "在底部输入框问出第一个问题，或直接用这个示例：",
        btn: { label: `💬 ${EXAMPLE_Q}`, act: "fill-example", wide: true },
      };
    }
    if (step === 4) {
      return {
        hint: "再加一个 AI 就能开辩论了（之后点底部「同时提问 ▾」选 ⚔️ 辩论）",
        btn: { label: "带我去 →", act: "goto-members" },
      };
    }
    return { hint: "", btn: null };
  }

  function ensureCard() {
    if (card && document.body.contains(card)) return card;
    card = document.createElement("div");
    card.id = "arena-onboarding";
    document.body.appendChild(card);
    card.addEventListener("click", onCardClick);
    return card;
  }

  function removeCard() {
    disarmLoginFallback();
    if (graduateHideTimer) { clearTimeout(graduateHideTimer); graduateHideTimer = null; }
    if (card) { try { card.remove(); } catch (_) {} card = null; }
  }

  function render() {
    if (!facts) return;
    const step = Core.deriveStep(facts);
    if (step === 0) { removeCard(); return; }
    if (step === 2) armLoginFallback(); else disarmLoginFallback();

    const el = ensureCard();
    if (collapsed) {
      el.className = "collapsed";
      el.innerHTML = `<button class="ob-pill" data-act="expand" title="展开新手之旅">🎯 新手之旅 ${step - 1}/4</button>`;
      return;
    }
    el.className = "";
    const body = stepBody(step);
    const rows = Core.STEPS.map(s => {
      const state = s.n < step ? "done" : (s.n === step ? "now" : "todo");
      const mark = state === "done" ? "✅" : (state === "now" ? "👉" : "⬜");
      return `<div class="ob-step ob-${state}">${mark} <span>${s.n}. ${escapeHtml(s.title)}</span></div>`;
    }).join("");
    el.innerHTML = `
      <div class="ob-head">
        <span class="ob-title">🎯 新手之旅 <b>${step - 1}/4</b></span>
        <button class="ob-mini" data-act="collapse" title="收起">—</button>
      </div>
      <div class="ob-steps">${rows}</div>
      <div class="ob-hint">${escapeHtml(body.hint)}</div>
      ${body.btn ? `<button class="ob-action${body.btn.wide ? " wide" : ""}" data-act="${body.btn.act}">${escapeHtml(body.btn.label)}</button>` : ""}
      <button class="ob-skip" data-act="skip">跳过引导</button>`;
  }

  function renderGraduation() {
    const el = ensureCard();
    collapsed = false;
    el.className = "graduated";
    el.innerHTML = `
      <div class="ob-head"><span class="ob-title">🎓 新手之旅完成！</span></div>
      <div class="ob-hint">你已经会用圆桌了。更多玩法（窗口模式 / 角色帽 / PPT 工坊）随时看：设置 → 📘 新手教程</div>
      <button class="ob-skip" data-act="skip">知道了</button>`;
    graduateHideTimer = setTimeout(removeCard, 15000);
  }

  function onCardClick(e) {
    const act = e.target?.dataset?.act;
    if (!act) return;
    if (act === "skip") {
      facts = Object.assign({}, facts, { skipped: true });
      persist();
      removeCard();
    } else if (act === "collapse") {
      collapsed = true; render();
    } else if (act === "expand") {
      collapsed = false; render();
    } else if (act === "goto-members") {
      gotoMembers();
    } else if (act === "goto-login") {
      const need = firstLoginRequired();
      if (need) chrome.runtime.sendMessage({ type: "activateParticipantTab", id: need.id }, () => { void chrome.runtime.lastError; });
    } else if (act === "fill-example") {
      fillExample();
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  // ── 调试黄条安抚（方案 C）：background 首次 CDP attach 前发来 debuggerNotice ──
  function showDebuggerNotice() {
    try { chrome.storage.local.set({ [DEBUGGER_NOTICE_KEY]: true }); } catch (_) {}
    window.ChatModal?.show?.({
      tone: "info",
      icon: "🛡️",
      title: "接下来会出现一条黄色提示，是正常现象",
      message: "浏览器顶部将显示「AI圆桌派 已开始调试此浏览器」。这是 Chrome 对所有同类插件的标准提示，不是病毒、也没有风险 — 它是插件读取 AI 回答需要的正常通道。",
      tip: "⚠ 请不要点黄色提示条上的「取消」，否则 AI 回答会变慢。",
      primary: { label: "我知道了，继续" },
    });
  }

  // ── 事件接入 ──
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === "debuggerNotice") { showDebuggerNotice(); return; }
      if (!facts || facts.skipped) return;
      if (msg?.type === "stateUpdate" && Array.isArray(msg.participants)) {
        participants = msg.participants;
        update({
          type: "participants",
          count: msg.participants.length,
          anyLoginOk: msg.participants.some(p => p.loginStatus === "ok"),
        });
        return;
      }
      if (msg?.type === "chatStreamUpdate" && msg.role === "ai" && msg.isDone
          && !msg.loginWarning && !msg.emptyTimeout && !msg.forcedTimeout && !msg.skipped) {
        update({ type: "aiAnswerDone" });
      }
    });
  } catch (_) {}

  async function init() {
    let r = {};
    try {
      r = await new Promise(res => chrome.storage.local.get(["tutorialDismissed", FACTS_KEY], resp => res(resp || {})));
    } catch (_) {}
    if (r[FACTS_KEY]) {
      facts = Object.assign(Core.initialFacts(), r[FACTS_KEY]);
    } else if (r.tutorialDismissed) {
      // 老用户豁免：用过旧教程的人视同毕业，升级后零打扰
      facts = Object.assign(Core.initialFacts(), { skipped: true, legacy: true });
      persist();
      return;
    } else {
      facts = Core.initialFacts();
      persist();
    }
    if (Core.deriveStep(facts) === 0) return;
    // 断点恢复：popup 重开时用当前真实状态校准 facts（中途加好成员/答完题不再重复引导）
    try {
      chrome.runtime.sendMessage({ type: "getState" }, (state) => {
        void chrome.runtime.lastError;
        if (Array.isArray(state?.participants)) {
          participants = state.participants;
          update({
            type: "participants",
            count: state.participants.length,
            anyLoginOk: state.participants.some(p => p.loginStatus === "ok"),
          });
        } else {
          render();
        }
      });
    } catch (_) { render(); }
  }

  function restart() {
    facts = Core.initialFacts();
    collapsed = false;
    persist();
    render();
    try { window.ChatToast?.show("🎯 新手之旅已重新开始", { type: "ok" }); } catch (_) {}
  }

  window.ChatOnboarding = { restart, getFacts: () => facts };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
