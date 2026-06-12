import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// memo-store.js 是 SW 经典脚本，node 下用 chrome stub 真实执行（v5.0.21 划线收藏）
globalThis.self = globalThis;
let store = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        const out = {};
        (Array.isArray(keys) ? keys : [keys]).forEach(k => { if (k in store) out[k] = store[k]; });
        return out;
      },
      set: async (obj) => { Object.assign(store, JSON.parse(JSON.stringify(obj))); },
    },
  },
  runtime: { sendMessage: async () => {} },
};
const require = createRequire(import.meta.url);
require("../memo-store.js");
const Memo = globalThis.ArenaMemoStore;

test("add/list/remove/clear 基本闭环", async () => {
  store = {};
  const r1 = await Memo.add("第一条金句", { type: "site", service: "deepseek" });
  assert.equal(r1.ok, true);
  const r2 = await Memo.add("第二条", { type: "popup", service: "kimi" });
  assert.equal(r2.count, 2);
  let items = await Memo.list();
  assert.equal(items.length, 2);
  assert.equal(items[0].text, "第一条金句");
  assert.equal(items[0].source.service, "deepseek");
  await Memo.remove(items[0].id);
  items = await Memo.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].text, "第二条");
  await Memo.clear();
  assert.equal((await Memo.list()).length, 0);
});

test("空白内容拒绝；超长截断到 MAX_TEXT", async () => {
  store = {};
  const r = await Memo.add("   \n  ");
  assert.equal(r.ok, false);
  const long = "字".repeat(Memo.MAX_TEXT + 1000);
  const r2 = await Memo.add(long);
  assert.equal(r2.ok, true);
  const items = await Memo.list();
  assert.equal(items[0].text.length, Memo.MAX_TEXT);
});

test("超过 MAX_ITEMS 上限 FIFO 淘汰最旧", async () => {
  store = {};
  for (let i = 0; i < Memo.MAX_ITEMS + 5; i++) {
    await Memo.add(`memo-${i}`);
  }
  const items = await Memo.list();
  assert.equal(items.length, Memo.MAX_ITEMS);
  assert.equal(items[0].text, "memo-5", "最旧的 5 条被淘汰");
  assert.equal(items[items.length - 1].text, `memo-${Memo.MAX_ITEMS + 4}`);
});
