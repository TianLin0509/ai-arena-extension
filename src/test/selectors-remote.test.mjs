// selectors-remote.test.mjs — 远程选择器热更新：校验/合并/版本比较/过期判定
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SR = require("../selectors-remote.js");

const EXT_V = "5.0.64";
const ok = (platforms, extra = {}) => SR.validateOverride({ schema: 1, platforms, ...extra }, EXT_V);

// ── validateOverride：整表拒绝 ───────────────────────────────────────────
test("validateOverride: 非对象 / 数组 / null 整表拒绝", () => {
  for (const bad of [null, undefined, 42, "x", [], true]) {
    assert.equal(SR.validateOverride(bad, EXT_V).ok, false);
  }
});

test("validateOverride: schema 不匹配拒绝", () => {
  assert.equal(SR.validateOverride({ schema: 2, platforms: {} }, EXT_V).ok, false);
  assert.equal(SR.validateOverride({ platforms: {} }, EXT_V).ok, false);
});

test("validateOverride: minExtVersion 高于当前版本拒绝；等于/低于放行", () => {
  assert.equal(ok({}, { minExtVersion: "5.0.65" }).ok, false);
  assert.equal(ok({}, { minExtVersion: "5.0.64" }).ok, true);
  assert.equal(ok({}, { minExtVersion: "5.0.1" }).ok, true);
  // 解析不了的版本串 fail-safe 拒绝
  assert.equal(ok({}, { minExtVersion: "abc" }).ok, false);
});

test("validateOverride: platforms 非对象拒绝", () => {
  assert.equal(SR.validateOverride({ schema: 1, platforms: [] }, EXT_V).ok, false);
  assert.equal(SR.validateOverride({ schema: 1 }, EXT_V).ok, false);
});

// ── validateOverride：单条消毒 ───────────────────────────────────────────
test("validateOverride: 未知 action 键 / 非法选择器条目被丢弃，合法保留", () => {
  const v = ok({
    claude: {
      input: ["div.a", "", "   ", 42, "x".repeat(401), "div.b"],
      hackKey: ["div.evil"],
      response: "not-array",
    },
  });
  assert.equal(v.ok, true);
  assert.deepEqual(v.platforms.claude.input, ["div.a", "div.b"]);
  assert.equal(v.platforms.claude.hackKey, undefined);
  assert.equal(v.platforms.claude.response, undefined);
});

test("validateOverride: 全部条目非法的平台被整体丢弃", () => {
  const v = ok({ qwen: { input: [42, ""] }, kimi: { input: ["div.k"] } });
  assert.equal(v.ok, true);
  assert.equal(v.platforms.qwen, undefined);
  assert.deepEqual(v.platforms.kimi.input, ["div.k"]);
});

test("validateOverride: 每 action 选择器数量截断到上限 24", () => {
  const v = ok({ claude: { input: Array.from({ length: 40 }, (_, i) => `div.c${i}`) } });
  assert.equal(v.platforms.claude.input.length, 24);
});

test("validateOverride: 平台数量截断到上限 24", () => {
  const platforms = {};
  for (let i = 0; i < 30; i++) platforms[`p${i}`] = { input: ["div.x"] };
  const v = ok(platforms);
  assert.equal(Object.keys(v.platforms).length, 24);
});

test("validateOverride: 返回的是消毒深拷贝，改原对象不影响结果", () => {
  const raw = { schema: 1, platforms: { claude: { input: ["div.a"] } } };
  const v = SR.validateOverride(raw, EXT_V);
  raw.platforms.claude.input.push("div.injected");
  assert.deepEqual(v.platforms.claude.input, ["div.a"]);
});

// ── mergeSelectors ───────────────────────────────────────────────────────
const DEFAULTS = {
  claude: { input: ["div.old1", "div.old2"], response: ["r.old"] },
  qwen: { input: ["q.old"] },
};

test("mergeSelectors: override 优先、内置追加去重、内置独有键保留", () => {
  const over = { claude: { input: ["div.new", "div.old2"] } };
  const m = SR.mergeSelectors(DEFAULTS, over, "claude");
  assert.deepEqual(m.input, ["div.new", "div.old2", "div.old1"]);
  assert.deepEqual(m.response, ["r.old"]);   // override 没给的键 → 内置原样
});

test("mergeSelectors: override 新增内置没有的键", () => {
  const over = { claude: { userMessage: ["u.new"] } };
  const m = SR.mergeSelectors(DEFAULTS, over, "claude");
  assert.deepEqual(m.userMessage, ["u.new"]);
  assert.deepEqual(m.input, ["div.old1", "div.old2"]);
});

test("mergeSelectors: 该平台无 override → 直接返回内置（零拷贝同引用）", () => {
  assert.equal(SR.mergeSelectors(DEFAULTS, { claude: { input: ["x"] } }, "qwen"), DEFAULTS.qwen);
  assert.equal(SR.mergeSelectors(DEFAULTS, null, "claude"), DEFAULTS.claude);
  assert.equal(SR.mergeSelectors(DEFAULTS, undefined, "claude"), DEFAULTS.claude);
});

test("mergeSelectors: 未知平台无内置无 override → 空对象不炸", () => {
  const m = SR.mergeSelectors(DEFAULTS, {}, "nonexist");
  assert.deepEqual(m, {});
});

// ── cmpVer / isStale ─────────────────────────────────────────────────────
test("cmpVer: 三段数字比较；非法输入返回 null", () => {
  assert.equal(SR.cmpVer("5.0.64", "5.0.64"), 0);
  assert.equal(SR.cmpVer("5.0.9", "5.0.10"), -1);
  assert.equal(SR.cmpVer("5.1.0", "5.0.99"), 1);
  assert.equal(SR.cmpVer("5.0", "5.0.1"), null);
  assert.equal(SR.cmpVer("v5.0.1", "5.0.1"), null);
});

test("isStale: 12h 边界；无效 fetchedAt 视为过期", () => {
  const now = 1_800_000_000_000;
  assert.equal(SR.isStale(now - SR.STALE_MS + 1000, now), false);
  assert.equal(SR.isStale(now - SR.STALE_MS, now), true);
  assert.equal(SR.isStale(0, now), true);
  assert.equal(SR.isStale(undefined, now), true);
});
