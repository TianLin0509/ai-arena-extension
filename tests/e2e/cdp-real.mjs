// AI Arena E2E — F27 真实 chrome.debugger API 端到端验证
// 目的：跑真实 chrome.debugger.attach / Page.setWebLifecycleState / detach
//       验证黑屏 bug 不再回归（detach 后 tab 仍正常渲染）
import { chromium } from "playwright";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const EXT_PATH = path.join(PROJECT_ROOT, "src");
const USER_DATA_DIR = path.join(os.tmpdir(), `arena-cdp-real-${Date.now()}`);

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`✅ ${name}`); }
  else { failed++; console.log(`❌ ${name}${detail ? "  → " + JSON.stringify(detail) : ""}`); }
}

console.log("═".repeat(70));
console.log("F27 真实 CDP API E2E（不 mock，跑真 chrome.debugger）");
console.log("═".repeat(70));

const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
  channel: "chromium",
  headless: false,
  args: [
    `--disable-extensions-except=${EXT_PATH}`,
    `--load-extension=${EXT_PATH}`,
    "--no-first-run",
    "--no-default-browser-check",
  ],
});

try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
  console.log("[cdp-real] service worker ready\n");

  // 1) 打开一个真实页（example.com 当 AI 网页 stub）
  const aiStub = await ctx.newPage();
  await aiStub.goto("https://example.com");
  await aiStub.waitForLoadState("domcontentloaded");
  const tabId = await sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: "https://example.com/*" });
    return tabs[0]?.id;
  });
  check("找到 stub tab", typeof tabId === "number", { tabId });

  // 2) 让该 tab 进入 background（聚焦到扩展 sidepanel page）
  const focusPage = await ctx.newPage();
  await focusPage.goto("about:blank");
  await focusPage.bringToFront();
  await new Promise(r => setTimeout(r, 500));

  // 3) 从 service worker 里调真 CDPExtractor.attachAndWake
  console.log("\n--- 测试 1: attach + lifecycle active ---");
  const attachResult = await sw.evaluate(async (tabId) => {
    const r = await self.CDPExtractor.attachAndWake(tabId);
    return { ok: r?.ok, reused: r?.reused, error: r?.error, code: r?.code };
  }, tabId);
  console.log("[cdp-real] attach result:", attachResult);
  check("真 attach 成功", attachResult.ok === true, attachResult);

  // 4) 验证 chrome.debugger.getTargets 真包含该 tab
  const attachedConfirm = await sw.evaluate(async (tabId) => {
    const targets = await chrome.debugger.getTargets();
    const target = targets.find(t => t.tabId === tabId);
    return {
      found: !!target,
      attached: target?.attached,
      type: target?.type,
    };
  }, tabId);
  check("chrome.debugger.getTargets 确认 attached=true", attachedConfirm.found && attachedConfirm.attached, attachedConfirm);

  // 5) 验证 attachedTabs Map 状态
  const statsAfter = await sw.evaluate(() => self.CDPExtractor.getStats());
  check("attachedCount=1", statsAfter.attachedCount === 1, statsAfter);

  // 6) attach 期间页面是否仍可正常渲染（关键：active 状态不应破坏渲染）
  const titleDuringAttach = await aiStub.evaluate(() => document.title);
  check("attach 期间 example.com 仍可读 title", titleDuringAttach.includes("Example"), { title: titleDuringAttach });

  // 7) 调真 detach
  console.log("\n--- 测试 2: detach（验证不黑屏） ---");
  await sw.evaluate(async (tabId) => {
    await self.CDPExtractor.detach(tabId);
  }, tabId);

  // 等 detach 落实
  await new Promise(r => setTimeout(r, 1000));

  // 8) 验证 attachedTabs Map 清空
  const statsAfterDetach = await sw.evaluate(() => self.CDPExtractor.getStats());
  check("detach 后 attachedCount=0", statsAfterDetach.attachedCount === 0, statsAfterDetach);

  // 9) 验证 chrome.debugger.getTargets 该 tab 不再 attached
  const detachedConfirm = await sw.evaluate(async (tabId) => {
    const targets = await chrome.debugger.getTargets();
    const target = targets.find(t => t.tabId === tabId);
    return { found: !!target, attached: target?.attached };
  }, tabId);
  check("detach 后该 tab attached=false", detachedConfirm.found && detachedConfirm.attached === false, detachedConfirm);

  // 10) ★★★ 关键防黑屏：detach 后 tab 必须仍能正常渲染 + JS 执行 ★★★
  //     bugfix2 之前的代码在这里会失败（frozen 状态下 JS 暂停）
  console.log("\n--- 测试 3: ★ 防黑屏 — detach 后 tab 仍渲染 + JS 跑 ★ ---");
  await aiStub.bringToFront();
  await new Promise(r => setTimeout(r, 500));

  // 切到 stub tab，验证 JS 仍能执行（frozen 状态下会卡死或返回 undefined）
  const jsAlive = await Promise.race([
    aiStub.evaluate(() => {
      // 测试 JS 真在跑：用 Date.now() + 同步操作返回当前时间
      const start = Date.now();
      return { now: start, frozen: false };
    }),
    new Promise(r => setTimeout(() => r({ frozen: true, timedOut: true }), 5000)),
  ]);
  check("detach 后 tab JS 执行正常（未 frozen）", jsAlive.frozen === false, jsAlive);

  // 测试 DOM 真在更新：注入元素 + 立即查询
  const domAlive = await aiStub.evaluate(() => {
    const el = document.createElement("div");
    el.id = "arena-test-marker";
    el.textContent = "marker";
    document.body.appendChild(el);
    return document.getElementById("arena-test-marker")?.textContent;
  });
  check("detach 后 DOM 可修改（未 frozen）", domAlive === "marker", { domAlive });

  // 11) 验证可视化：截图 stub tab 检查不是空白
  const screenshotBuf = await aiStub.screenshot();
  // 简单启发式：example.com 截图字节数应该 > 1KB（空白页通常 < 500B）
  check("detach 后 tab 截图非空（不黑屏）", screenshotBuf.length > 1000, { screenshotBytes: screenshotBuf.length });

  // 12) 重复 attach/detach 多次（验证幂等 + 无累积副作用）
  console.log("\n--- 测试 4: 多次 attach/detach 循环（验证无累积副作用） ---");
  for (let i = 0; i < 3; i++) {
    const r1 = await sw.evaluate(async (tabId) => {
      const a = await self.CDPExtractor.attachAndWake(tabId);
      const stats1 = self.CDPExtractor.getStats();
      await self.CDPExtractor.detach(tabId);
      const stats2 = self.CDPExtractor.getStats();
      return { attached: a.ok, count1: stats1.attachedCount, count2: stats2.attachedCount };
    }, tabId);
    check(`循环 ${i+1}: attach→detach 计数正确`, r1.attached && r1.count1 === 1 && r1.count2 === 0, r1);
  }

  // 13) 最终 JS 仍可用
  const finalJs = await aiStub.evaluate(() => 1 + 1);
  check("多次循环后 JS 仍正常", finalJs === 2);

} catch (e) {
  console.error("[cdp-real] FATAL:", e);
  failed++;
} finally {
  await ctx.close();
}

console.log("\n" + "═".repeat(70));
console.log(`结果：${passed} 通过 / ${failed} 失败`);
console.log("═".repeat(70));
process.exit(failed > 0 ? 1 : 0);
