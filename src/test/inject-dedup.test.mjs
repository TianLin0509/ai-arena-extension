// inject-dedup.test.mjs — content-shared dedupInject：幂等 token 防双发
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("../content-shared.js");           // IIFE 挂 globalThis.ArenaShared
const { dedupInject } = globalThis.ArenaShared;

const tick = () => new Promise(r => setTimeout(r, 5));

test("无 token：每次调用都执行（兼容单发路径）", async () => {
  let runs = 0;
  const run = () => { runs++; return Promise.resolve({ status: "sent" }); };
  await dedupInject(null, run);
  await dedupInject(undefined, run);
  await dedupInject("", run);
  assert.equal(runs, 3);
});

test("同 token 并发：只执行一次，后到者附着并标记 dedup:true", async () => {
  let runs = 0;
  const run = async () => { runs++; await tick(); return { status: "sent", site: "x" }; };
  const [a, b] = await Promise.all([
    dedupInject("tok-a", run),
    dedupInject("tok-a", run),
  ]);
  assert.equal(runs, 1);
  assert.equal(a.status, "sent");
  assert.equal(b.status, "sent");
  assert.equal(a.dedup, undefined);   // 首试结果不打标
  assert.equal(b.dedup, true);
  assert.equal(a.site, "x");
  assert.equal(b.site, "x");
});

test("同 token 完成后再来：仍附着缓存结果，不重复执行", async () => {
  let runs = 0;
  const run = () => { runs++; return Promise.resolve({ status: "sent" }); };
  await dedupInject("tok-b", run);
  const again = await dedupInject("tok-b", run);
  assert.equal(runs, 1);
  assert.equal(again.dedup, true);
});

test("首试 reject：同 token 重试拿到同一 rejection，绝不二次注入", async () => {
  let runs = 0;
  const run = async () => { runs++; await tick(); throw new Error("inject boom"); };
  const p1 = dedupInject("tok-c", run).catch(e => `caught:${e.message}`);
  const p2 = dedupInject("tok-c", run).catch(e => `caught:${e.message}`);
  assert.deepEqual(await Promise.all([p1, p2]), ["caught:inject boom", "caught:inject boom"]);
  assert.equal(runs, 1);
});

test("非对象结果原样透传（不强行加 dedup 标记）", async () => {
  const run = () => Promise.resolve("plain-string");
  await dedupInject("tok-d", run);
  assert.equal(await dedupInject("tok-d", () => Promise.resolve("other")), "plain-string");
});

test("容量上限淘汰最老 token 后，同 token 可再次执行", async () => {
  let runs = 0;
  const run = () => { runs++; return Promise.resolve({ status: "sent" }); };
  await dedupInject("tok-evict", run);
  for (let i = 0; i < 30; i++) await dedupInject(`tok-fill-${i}`, () => Promise.resolve({ status: "sent" }));
  await dedupInject("tok-evict", run);   // 已被挤出 → 重新执行
  assert.equal(runs, 2);
});
