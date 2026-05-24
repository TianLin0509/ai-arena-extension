// AI Arena E2E — F34+ activateAiWindowsOnce 真实效果验证
// 目的：验证 chrome.windows.update({focused:true}) 真的让 window focused
// （Windows OS Foreground Lock 可能拒绝程序化 focus 请求）
import { chromium } from "playwright";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const EXT_PATH = path.join(PROJECT_ROOT, "src");
const USER_DATA_DIR = path.join(os.tmpdir(), `arena-f34-${Date.now()}`);

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`✅ ${name}`); }
  else { failed++; console.log(`❌ ${name}${detail ? "  → " + JSON.stringify(detail) : ""}`); }
}

console.log("═".repeat(70));
console.log("F34+ activateAiWindowsOnce 真实效果 E2E");
console.log("═".repeat(70));

const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
  channel: "chromium",
  headless: false,
  ignoreDefaultArgs: [
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
  ],
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

  // 1) 创建一个 example.com page（manifest content_scripts 不会自动注入，
  //    模拟"现有 AI tab"在 reload 扩展前已经打开的场景）
  console.log("\n--- Phase 1: 创建 mock AI tab ---");
  const aiPage = await ctx.newPage();
  await aiPage.goto("https://example.com");
  await aiPage.waitForLoadState("domcontentloaded");

  const aiTabInfo = await sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: "https://example.com/*" });
    const tab = tabs[0];
    return tab ? { id: tab.id, windowId: tab.windowId, url: tab.url } : null;
  });
  check("找到 AI tab", aiTabInfo != null, aiTabInfo);
  console.log("AI tab info:", aiTabInfo);

  // 2) 推到 background — 创建另一个 page focus
  console.log("\n--- Phase 2: 推 AI tab 到 background ---");
  const fgPage = await ctx.newPage();
  await fgPage.goto("about:blank");
  await fgPage.bringToFront();
  await new Promise(r => setTimeout(r, 1500));

  // 验证 AI window 现在 not focused
  const winBefore = await sw.evaluate(async (winId) => {
    const win = await chrome.windows.get(winId);
    return { focused: win.focused, state: win.state };
  }, aiTabInfo.windowId);
  console.log("AI window state before activate:", winBefore);
  check("AI window 是 not focused 状态", winBefore.focused === false, winBefore);

  // 3) 调 activateAiWindowsOnce 逻辑（直接 chrome.windows.update）
  console.log("\n--- Phase 3: ★ 调 F34+ 核心 API 链 ★ ---");
  const activateResult = await sw.evaluate(async ({ winId, tabId }) => {
    const events = [];
    try {
      events.push("start");
      await chrome.windows.update(winId, { state: "normal", focused: true });
      events.push("windows.update done");

      // 立即查 window 状态
      const winAfterUpdate = await chrome.windows.get(winId);
      events.push(`win.focused after update = ${winAfterUpdate.focused}`);

      await chrome.tabs.update(tabId, { active: true });
      events.push("tabs.update done");

      // 等 800ms（F34+ 的 sleep）
      await new Promise(r => setTimeout(r, 800));
      events.push("slept 800ms");

      // 再查 window 状态
      const winAfter800ms = await chrome.windows.get(winId);
      events.push(`win.focused after 800ms = ${winAfter800ms.focused}`);

      return {
        events,
        finalFocused: winAfter800ms.focused,
        finalState: winAfter800ms.state,
      };
    } catch (e) {
      return { events, error: e?.message || String(e) };
    }
  }, { winId: aiTabInfo.windowId, tabId: aiTabInfo.id });

  console.log("\nActivate result events:");
  activateResult.events.forEach(e => console.log("  -", e));
  if (activateResult.error) console.log("  ⚠️ ERROR:", activateResult.error);

  check("★ chrome.windows.update 成功调用",
    !activateResult.error, activateResult.error);
  check("★ chrome.windows.update 之后 win.focused = true（OS 没拒绝）",
    activateResult.finalFocused === true,
    { finalFocused: activateResult.finalFocused, finalState: activateResult.finalState });

  // 4) 在 AI page 里检测 visibilityState 变化（间接验证 chrome 内核 SetHidden 是否触发）
  console.log("\n--- Phase 4: AI page visibilityState 变化检测 ---");
  // 重新推 AI 到 background，再测一次
  await fgPage.bringToFront();
  await new Promise(r => setTimeout(r, 1500));

  // 此时 AI page 应该是 hidden
  const visBeforeActivate = await aiPage.evaluate(() => document.visibilityState);
  console.log("[before activate] visibilityState:", visBeforeActivate);

  // 调 activate
  await sw.evaluate(async ({ winId, tabId }) => {
    await chrome.windows.update(winId, { state: "normal", focused: true });
    await chrome.tabs.update(tabId, { active: true });
    await new Promise(r => setTimeout(r, 800));
  }, { winId: aiTabInfo.windowId, tabId: aiTabInfo.id });

  const visAfterActivate = await aiPage.evaluate(() => document.visibilityState);
  console.log("[after activate] visibilityState:", visAfterActivate);

  if (visBeforeActivate === "hidden" && visAfterActivate === "visible") {
    check("★ AI page 真的从 hidden 切到 visible（chrome SetHidden(false) 触发）", true);
  } else if (visBeforeActivate === "visible") {
    console.log("⚠️ AI page 一开始就是 visible（Playwright 环境特性），无法测 hidden→visible 切换");
    check("[skipped] hidden→visible 切换（Playwright 不模拟真 throttle）", false,
      { vis_before: visBeforeActivate, vis_after: visAfterActivate });
  } else {
    check("★ AI page hidden→visible 切换",
      visBeforeActivate === "hidden" && visAfterActivate === "visible",
      { vis_before: visBeforeActivate, vis_after: visAfterActivate });
  }

  // 5) 检查 Playwright 环境到底有没有 background throttle
  console.log("\n--- Phase 5: Playwright 环境 throttle 检测 ---");
  await fgPage.bringToFront();
  await new Promise(r => setTimeout(r, 1500));

  // 在 AI page 里测 setTimeout
  const stRes = await aiPage.evaluate(async () => {
    const t = performance.now();
    await new Promise(r => setTimeout(r, 100));
    return Math.round(performance.now() - t);
  });
  console.log("[background] setTimeout(100) actual:", stRes, "ms");
  console.log(
    stRes < 200
      ? "⚠️ Playwright 没真 throttle (setTimeout 正常)，无法测 F34+ 解 throttle 效果"
      : "✅ 环境有 throttle, F34+ 必须解才能恢复"
  );

} catch (e) {
  console.error("[FATAL]", e);
  failed++;
} finally {
  await ctx.close();
}

console.log("\n" + "═".repeat(70));
console.log(`结果: ${passed} 通过 / ${failed} 失败`);
console.log("═".repeat(70));
process.exit(failed > 0 ? 1 : 0);
