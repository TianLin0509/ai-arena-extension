import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// state-machine.js 是 SW 经典脚本（importScripts 全局可见），node 下用 chrome/self stub 加载
let capturedWrites = [];
globalThis.self = globalThis;
globalThis.chrome = {
  storage: {
    local: {
      get: async () => ({}),
      set: (obj) => { capturedWrites.push(obj); },
    },
  },
  runtime: {
    onSuspend: { addListener() {} },
    sendMessage: () => ({ catch() {} }),
  },
};
const require = createRequire(import.meta.url);
require("../state-machine.js");
const StateMachine = globalThis.StateMachine;

const ACTIVE_LIMIT = 60000;
const ARCHIVE_LIMIT = 4000;

function makeSession(roundTexts) {
  return {
    originalQuestion: "q",
    summaryText: "",
    rounds: roundTexts.map((text, i) => ({
      round: i + 1,
      responses: { p1: { name: "AI1", text } },
    })),
  };
}

test("compactDebateSessionForStorage：超限文本只压缩副本，内存全文不动（v5.0.16 P0-2）", () => {
  const longText = "字".repeat(ACTIVE_LIMIT + 10000);
  StateMachine.debateSession = makeSession([longText]);
  const compacted = StateMachine.compactDebateSessionForStorage();
  // 副本被压缩且带中文省略标记
  assert.ok(compacted.rounds[0].responses.p1.text.length < longText.length);
  assert.ok(compacted.rounds[0].responses.p1.text.includes("中间省略"));
  assert.equal(compacted.rounds[0].responses.p1.compactedForStorage, true);
  // 内存原文完整无标记 —— 辩论 prompt / 裁判总结读到的是全文
  assert.equal(StateMachine.debateSession.rounds[0].responses.p1.text.length, longText.length);
  assert.ok(!StateMachine.debateSession.rounds[0].responses.p1.text.includes("中间省略"));
  assert.equal(StateMachine.debateSession.rounds[0].responses.p1.compactedForStorage, undefined);
});

test("compactDebateSessionForStorage：全部在限内 → 返回原引用（快路径零拷贝）", () => {
  StateMachine.debateSession = makeSession(["短回答", "另一条短回答"]);
  assert.equal(StateMachine.compactDebateSessionForStorage(), StateMachine.debateSession);
});

test("compactDebateSessionForStorage：超过 12 轮的旧轮按 4000 归档限压缩，活跃轮不动", () => {
  const oldText = "旧".repeat(ARCHIVE_LIMIT + 2000);
  const recentText = "新".repeat(ARCHIVE_LIMIT + 2000); // 超归档限但在活跃限内
  const texts = [oldText, ...Array.from({ length: 12 }, () => recentText)];
  StateMachine.debateSession = makeSession(texts);
  const compacted = StateMachine.compactDebateSessionForStorage();
  assert.ok(compacted.rounds[0].responses.p1.text.length < oldText.length, "第 1 轮（归档区）应被压缩");
  assert.equal(compacted.rounds[12].responses.p1.text, recentText, "活跃轮在 60k 限内不应动");
});

test("_writeToStorage：写盘的是压缩副本，写完内存仍是全文", () => {
  capturedWrites = [];
  const longText = "字".repeat(ACTIVE_LIMIT + 5000);
  StateMachine.debateSession = makeSession([longText]);
  StateMachine._writeToStorage();
  assert.equal(capturedWrites.length, 1);
  const written = capturedWrites[0].sm_debateSession;
  assert.ok(written.rounds[0].responses.p1.text.length < longText.length);
  assert.equal(StateMachine.debateSession.rounds[0].responses.p1.text.length, longText.length);
});

test("压缩后的文本长度低于限值 → 重复压缩不叠加标记（幂等）", () => {
  const longText = "字".repeat(ACTIVE_LIMIT + 10000);
  StateMachine.debateSession = makeSession([longText]);
  const once = StateMachine.compactDebateSessionForStorage();
  StateMachine.debateSession = once;
  const twice = StateMachine.compactDebateSessionForStorage();
  assert.equal(twice, once, "已压缩的 session 应走快路径返回原引用");
});
