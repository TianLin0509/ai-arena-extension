import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// content-shared.js 是浏览器 IIFE，副作用挂 globalThis.ArenaShared
const require = createRequire(import.meta.url);
require("../content-shared.js");
const {
  detectStreaming,
  rememberResponseCursor,
  getLatestResponseCandidate,
  findReadableBlock,
} = globalThis.ArenaShared;

// ── 最小 DOM mock ────────────────────────────────────────────────
// detectStreaming 只用到：doc.querySelectorAll / el.tagName / el===el /
//   latestEl.contains(el) / el.getBoundingClientRect() / win.innerHeight
// 给受控的 DOM 快照验证判定逻辑（测真实函数，不是测 mock）。
function makeEl({ tag = "DIV", rect = { width: 100, height: 20, top: 10, bottom: 30 }, children = [] } = {}) {
  const el = {
    tagName: tag,
    _children: children,
    getBoundingClientRect: () => rect,
    contains(other) {
      if (other === el) return true;
      return children.some(c => c.contains && c.contains(other));
    },
  };
  return el;
}
function makeDoc(map) {
  return { querySelectorAll: (sel) => map[sel] || [] };
}
const VIEWPORT = { innerHeight: 800 };
const inView = { width: 200, height: 100, top: 100, bottom: 300 };       // 视口内
const aboveView = { width: 200, height: 100, top: -500, bottom: -400 };  // 滚出视口上方（历史残留）

const QK = '[class*="qk-markdown"]:not([class*="qk-markdown-complete"])';
const STOP = 'button[class*="stop"]';

// ── 核心回归：千问第二/三轮起提取慢 / 超时 5 分钟 ────────────────
test("千问：历史轮未完成 qk-markdown 滚出视口，最新轮已完成 → 不应判 streaming", () => {
  // 最新轮已加 complete class → selector 不命中它，只命中上方历史轮残留
  const historyMd = makeEl({ rect: aboveView });
  const latestMd = makeEl({ rect: inView });   // 最新回答容器（已完成，不被 :not(complete) 命中）
  const doc = makeDoc({ [QK]: [historyMd] });
  assert.equal(
    detectStreaming([QK], latestMd, VIEWPORT, doc),
    false,
    "上方历史轮残留 qk-markdown 不能再把 isStreaming 卡成 true（这是 5min 超时根因）"
  );
});

test("千问：最新回答容器自身仍在生成（未 complete）→ 应判 streaming", () => {
  const latestMd = makeEl({ rect: inView });
  const doc = makeDoc({ [QK]: [latestMd] });   // 命中的就是最新容器自己
  assert.equal(detectStreaming([QK], latestMd, VIEWPORT, doc), true);
});

// ── 全局 Stop 按钮：靠视口位置区分"当前"vs"残留" ─────────────────
test("Stop 按钮在视口内（正在生成）→ 应判 streaming", () => {
  const stop = makeEl({ tag: "BUTTON", rect: { width: 40, height: 40, top: 700, bottom: 740 } });
  const doc = makeDoc({ [STOP]: [stop] });
  const latest = makeEl({ rect: inView });
  assert.equal(detectStreaming([STOP], latest, VIEWPORT, doc), true);
});

test("Stop 按钮滚出视口上方（历史残留）→ 不应判 streaming", () => {
  const oldStop = makeEl({ tag: "BUTTON", rect: aboveView });
  const doc = makeDoc({ [STOP]: [oldStop] });
  const latest = makeEl({ rect: inView });
  assert.equal(detectStreaming([STOP], latest, VIEWPORT, doc), false);
});

// ── 边界 ────────────────────────────────────────────────────────
test("没有任何 streaming 元素命中 → false", () => {
  assert.equal(detectStreaming([STOP], null, VIEWPORT, makeDoc({})), false);
});

test("width=0 / height=0 的隐藏残留 → 不应判 streaming（裸 width>0 旧逻辑的坑）", () => {
  const hidden = makeEl({ tag: "BUTTON", rect: { width: 0, height: 0, top: 0, bottom: 0 } });
  const doc = makeDoc({ [STOP]: [hidden] });
  assert.equal(detectStreaming([STOP], null, VIEWPORT, doc), false);
});

test("streamingSelectors 非数组 / 选择器抛错 → 安全返回 false 不抛", () => {
  assert.equal(detectStreaming(null, null, VIEWPORT, makeDoc({})), false);
  const throwingDoc = { querySelectorAll: () => { throw new Error("bad selector"); } };
  assert.equal(detectStreaming([":::bad"], null, VIEWPORT, throwingDoc), false);
});

test("response cursor only considers candidates after the send-time cursor", () => {
  const oldA = { innerText: "old answer A", textContent: "", isConnected: true, compareDocumentPosition: (other) => other === oldB || other === next ? 4 : 0 };
  const oldB = { innerText: "old answer B", textContent: "", isConnected: true, compareDocumentPosition: (other) => other === next ? 4 : 0 };
  const next = { innerText: "new answer", textContent: "", isConnected: true, compareDocumentPosition: () => 0 };
  rememberResponseCursor("unit-cursor", [oldA, oldB]);
  assert.equal(getLatestResponseCandidate([oldA, oldB], "unit-cursor"), null);
  assert.equal(getLatestResponseCandidate([oldA, oldB, next], "unit-cursor"), next);
  assert.equal(getLatestResponseCandidate([next], "unit-cursor"), next);
});

test("cursor 锚点被 SPA 重渲染摘除（detached）→ 回退尾部候选而非永远空（v5.0.16 P0-1）", () => {
  // detached 节点对文档内元素 compareDocumentPosition 只返回 DISCONNECTED(1)，永远不含 FOLLOWING(4)
  const detachedAnchor = { innerText: "old answer", textContent: "", isConnected: false, compareDocumentPosition: () => 1 };
  const fresh = { innerText: "new answer", textContent: "", isConnected: true, compareDocumentPosition: () => 0 };
  rememberResponseCursor("unit-cursor-detached", [detachedAnchor]);
  assert.equal(getLatestResponseCandidate([fresh], "unit-cursor-detached"), fresh);
});

test("cursor 锚点仍在文档中且其后无新元素 → 返回空（等待新回答，不误读旧回答）", () => {
  const before = { innerText: "older", textContent: "", isConnected: true, compareDocumentPosition: () => 4 };
  const anchor = { innerText: "old answer", textContent: "", isConnected: true, compareDocumentPosition: () => 2 };
  rememberResponseCursor("unit-cursor-nonew", [before, anchor]);
  assert.equal(getLatestResponseCandidate([before], "unit-cursor-nonew"), null);
});

test("发送失败清锚点（clearResponseCursorAnchor）→ 提取回退尾部候选", () => {
  const { clearResponseCursorAnchor } = globalThis.ArenaShared;
  const anchor = { innerText: "old", textContent: "", isConnected: true, compareDocumentPosition: () => 2 };
  const oldAnswer = { innerText: "previous answer", textContent: "", isConnected: true, compareDocumentPosition: () => 4 };
  rememberResponseCursor("unit-cursor-clear", [oldAnswer, anchor]);
  assert.equal(getLatestResponseCandidate([oldAnswer], "unit-cursor-clear"), null);
  clearResponseCursorAnchor("unit-cursor-clear");
  assert.equal(getLatestResponseCandidate([oldAnswer], "unit-cursor-clear"), oldAnswer);
});

test("textHash：同文本同哈希、异文本异哈希、内嵌长度防碰撞（v5.0.20 同文本省略协议）", () => {
  const { textHash } = globalThis.ArenaShared;
  const a = "这是一段回答".repeat(100);
  assert.equal(textHash(a), textHash(a));
  assert.notEqual(textHash(a), textHash(a + "尾巴"));
  assert.ok(textHash(a).endsWith(":" + a.length), "哈希串内嵌长度");
  assert.equal(textHash(""), textHash(""));
  assert.notEqual(textHash(""), textHash(" "));
  assert.equal(typeof textHash(null), "string");
});

test("fallback block scan is bounded to the tail candidates", () => {
  const makeBlock = (text, height = 80) => ({
    innerText: text,
    textContent: text,
    getBoundingClientRect: () => ({ width: 100, height }),
  });
  const oldReadable = makeBlock("x".repeat(200));
  const tail = Array.from({ length: 5 }, (_, i) => makeBlock(`short ${i}`, 20));
  assert.equal(findReadableBlock([oldReadable, ...tail], { minTextLength: 100, minHeight: 50, limit: 5 }), null);
  const newest = makeBlock("y".repeat(200));
  assert.equal(findReadableBlock([oldReadable, ...tail, newest], { minTextLength: 100, minHeight: 50, limit: 5 }), newest);
});
