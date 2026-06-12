import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// onboarding-core.js 纯逻辑双出口（v5.0.22 新手之旅）
const require = createRequire(import.meta.url);
const Core = require("../onboarding-core.js");

test("initialFacts → 步骤 1（添加第一个 AI）", () => {
  const f = Core.initialFacts();
  assert.equal(Core.deriveStep(f), 1);
  assert.equal(Core.isGraduated(f), false);
});

test("正向旅程：加成员 → 登录 ok → 首答 → 第二成员 → 毕业", () => {
  let f = Core.initialFacts();
  f = Core.applyEvent(f, { type: "participants", count: 1, anyLoginOk: false });
  assert.equal(Core.deriveStep(f), 2);
  f = Core.applyEvent(f, { type: "participants", count: 1, anyLoginOk: true });
  assert.equal(Core.deriveStep(f), 3);
  f = Core.applyEvent(f, { type: "aiAnswerDone" });
  assert.equal(Core.deriveStep(f), 4);
  f = Core.applyEvent(f, { type: "participants", count: 2, anyLoginOk: true });
  assert.equal(Core.deriveStep(f), 0);
  assert.equal(Core.isGraduated(f), true);
});

test("乱序/跳级事件幂等：老手一口气加 2 个成员直接发问", () => {
  let f = Core.initialFacts();
  // 一次 stateUpdate 就带 2 个成员（断点恢复场景）
  f = Core.applyEvent(f, { type: "participants", count: 2, anyLoginOk: false });
  assert.equal(f.addedFirst, true);
  assert.equal(f.addedSecond, true);
  assert.equal(Core.deriveStep(f), 2);
  // 还没等探测结论，AI 回答先到 → 回答是最强登录信号，2/3 两步同时过
  f = Core.applyEvent(f, { type: "aiAnswerDone" });
  assert.equal(Core.deriveStep(f), 0);
  assert.equal(Core.isGraduated(f), true);
});

test("facts 单调性：成员被移除（count 回落）不回退已达成步骤", () => {
  let f = Core.applyEvent(Core.initialFacts(), { type: "participants", count: 2, anyLoginOk: true });
  const before = Core.deriveStep(f);
  f = Core.applyEvent(f, { type: "participants", count: 0, anyLoginOk: false });
  assert.equal(f.addedFirst, true);
  assert.equal(f.addedSecond, true);
  assert.equal(f.loginOk, true);
  assert.equal(Core.deriveStep(f), before);
});

test("loginFallback 兜底只放行步骤 2，不影响其余", () => {
  let f = Core.applyEvent(Core.initialFacts(), { type: "participants", count: 1, anyLoginOk: false });
  assert.equal(Core.deriveStep(f), 2);
  f = Core.applyEvent(f, { type: "loginFallback" });
  assert.equal(Core.deriveStep(f), 3);
  assert.equal(f.firstAnswerDone, false);
});

test("skipped：跳过后 deriveStep=0 且事件不再生效", () => {
  let f = Object.assign(Core.initialFacts(), { skipped: true });
  assert.equal(Core.deriveStep(f), 0);
  f = Core.applyEvent(f, { type: "participants", count: 2, anyLoginOk: true });
  assert.equal(f.addedFirst, false);
  assert.equal(Core.isGraduated(f), false);
});

test("applyEvent 不修改原对象（popup 持有引用比对依赖）", () => {
  const f0 = Core.initialFacts();
  const f1 = Core.applyEvent(f0, { type: "participants", count: 1, anyLoginOk: false });
  assert.equal(f0.addedFirst, false);
  assert.equal(f1.addedFirst, true);
  assert.equal(Core.factsEqual(f0, f1), false);
  assert.equal(Core.factsEqual(f1, Core.applyEvent(f0, { type: "participants", count: 1 })), true);
});

test("旧版本 facts 缺字段时 applyEvent 补默认值（升级兼容）", () => {
  const legacy = { v: 1, addedFirst: true };  // 缺 loginOk 等字段
  const f = Core.applyEvent(legacy, { type: "participants", count: 1, anyLoginOk: false });
  assert.equal(f.loginOk, false);
  assert.equal(f.skipped, false);
  assert.equal(Core.deriveStep(f), 2);
});
