// onboarding-core.js — v5.0.22 新手之旅纯逻辑（无 DOM）
// 双模出口：popup 经 window.ArenaOnboardingCore，Node 测试经 require
//
// 设计：不用"事件→步进"状态机（事件可能乱序/丢失），改用单调 facts —
//   每个里程碑一旦达成永久为 true，当前步骤每次从 facts 推导，天然幂等、可断点恢复。
(function (global) {
  const STEPS = [
    { n: 1, icon: "👥", title: "添加第一个 AI" },
    { n: 2, icon: "🔑", title: "登录 AI 网页" },
    { n: 3, icon: "💬", title: "问出第一个问题" },
    { n: 4, icon: "⚔️", title: "加第二个 AI，凑一场辩论" },
  ];

  function initialFacts() {
    return {
      v: 1,
      addedFirst: false,     // 加过 ≥1 个 AI
      loginOk: false,        // 任一 AI 登录就绪（探测 ok / 收到回答 / 超时兜底）
      firstAnswerDone: false,// 收到第一条完整 AI 回答
      addedSecond: false,    // 加过 ≥2 个 AI
      skipped: false,        // 用户主动跳过（或老用户豁免）
    };
  }

  // 0 = 不显示步骤（已跳过或已毕业），1-4 = 当前待完成步骤
  function deriveStep(facts) {
    if (!facts || facts.skipped) return 0;
    if (!facts.addedFirst) return 1;
    if (!facts.loginOk) return 2;
    if (!facts.firstAnswerDone) return 3;
    if (!facts.addedSecond) return 4;
    return 0;
  }

  function isGraduated(facts) {
    return !!facts && !facts.skipped
      && facts.addedFirst && facts.loginOk && facts.firstAnswerDone && facts.addedSecond;
  }

  // 运行时事件 → facts（只置 true 不回退；返回新对象，未变化时仍返回新引用由调用方比对）
  // ev:
  //   { type:"participants", count, anyLoginOk }  ← stateUpdate 广播
  //   { type:"aiAnswerDone" }                     ← 第一条非警告/非超时的完整回答
  //   { type:"loginFallback" }                    ← 步骤 2 探测长期无结论的超时兜底
  function applyEvent(facts, ev) {
    const f = Object.assign(initialFacts(), facts);
    if (!ev || f.skipped) return f;
    if (ev.type === "participants") {
      if (ev.count >= 1) f.addedFirst = true;
      if (ev.count >= 2) f.addedSecond = true;
      if (ev.anyLoginOk) f.loginOk = true;
    } else if (ev.type === "aiAnswerDone") {
      // 能收到完整回答 ⇒ 登录必然就绪（探测可能误报/卡 checking，回答是最强信号）
      f.addedFirst = true;
      f.loginOk = true;
      f.firstAnswerDone = true;
    } else if (ev.type === "loginFallback") {
      f.loginOk = true;
    }
    return f;
  }

  function factsEqual(a, b) {
    if (!a || !b) return a === b;
    return a.addedFirst === b.addedFirst && a.loginOk === b.loginOk
      && a.firstAnswerDone === b.firstAnswerDone && a.addedSecond === b.addedSecond
      && a.skipped === b.skipped;
  }

  const api = { STEPS, initialFacts, deriveStep, applyEvent, isGraduated, factsEqual };
  global.ArenaOnboardingCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis));
