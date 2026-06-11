import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// debate-engine.js 是经典脚本（importScripts 全局可见），node 下直接 require；
// ArenaTemplateStore 缺省 → mainPrompt/roundHint 为空串，不影响 contextText 断言
globalThis.self = globalThis;
const require = createRequire(import.meta.url);
require("../debate-engine.js");
const { DebateEngine, compactTextForRelay } = globalThis;

const PER_CAP = 3000;
const TOTAL_BUDGET = 8000;

function makeResponses(lens) {
  const out = {};
  Object.entries(lens).forEach(([id, len], i) => {
    out[id] = { name: `AI${i + 1}`, text: "字".repeat(len) };
  });
  return out;
}

test("compactTextForRelay: 超限截断保留首尾 + 中文省略标记；限内不动", () => {
  const long = "字".repeat(5000);
  const out = compactTextForRelay(long, 3000);
  assert.ok(out.length < long.length);
  assert.ok(out.includes("中间省略"));
  assert.equal(compactTextForRelay("短文本", 3000), "短文本");
});

test("compress=false（默认）：队友回答全文转发，行为与旧版一致", () => {
  const responses = makeResponses({ p1: 100, p2: 6000 });
  const prompt = DebateEngine.buildDebatePrompt("p1", responses, "free", 2, "", false);
  assert.ok(prompt.includes("字".repeat(6000)), "未开压缩时 6000 字全文在 prompt 里");
  assert.ok(!prompt.includes("中间省略"));
});

test("compress=true：单个队友回答按 3000 上限压缩", () => {
  const responses = makeResponses({ p1: 100, p2: 6000 });
  const prompt = DebateEngine.buildDebatePrompt("p1", responses, "free", 2, "", false, true);
  assert.ok(!prompt.includes("字".repeat(6000)), "6000 字全文不应出现");
  assert.ok(prompt.includes("中间省略"));
  // 压缩后该队友段落不超过上限 + 标记冗余
  assert.ok(prompt.length < 100 + PER_CAP + 600);
});

test("compress=true：多队友合计超总预算 → 均分收紧", () => {
  // 2 个队友各 6000 字：各按 3000 截后合计 6000 ≤ 8000 不收紧；
  // 3 个队友各 6000 字：各按 3000 截后合计 9000 > 8000 → 均分 floor(8000/3)=2666
  const responses = makeResponses({ p1: 10, p2: 6000, p3: 6000, p4: 6000 });
  const prompt = DebateEngine.buildDebatePrompt("p1", responses, "free", 3, "", false, true);
  const budgetWithOverhead = TOTAL_BUDGET + 3 * 600;
  assert.ok(prompt.length < budgetWithOverhead + 500, `prompt ${prompt.length} 字应被压到总预算附近`);
});

test("compress=true：不压缩自己的回答引用（只压队友），且短回答不加标记", () => {
  const responses = makeResponses({ p1: 5000, p2: 200 });
  const prompt = DebateEngine.buildDebatePrompt("p1", responses, "free", 2, "", false, true);
  // p1 是收件人自己，不进 contextText；p2 只有 200 字不触发压缩
  assert.ok(prompt.includes("字".repeat(200)));
  assert.ok(!prompt.includes("中间省略"));
});
