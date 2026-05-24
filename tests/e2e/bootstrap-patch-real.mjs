// AI Arena E2E — F32+ bootstrap-main-world.js 真实 throttle 验证 (v2)
// 修复 v1 两个问题：
// 1. Playwright 默认加 --disable-background-timer-throttling 让环境不 throttle，
//    用 ignoreDefaultArgs 禁掉这些 flag
// 2. data: URL 不能用 chrome.scripting.executeScript 注入，改用 page.evaluate
//    直接 eval bootstrap-main-world.js 文件内容（等价于 MAIN world 注入）
import { chromium } from "playwright";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const EXT_PATH = path.join(PROJECT_ROOT, "src");
const USER_DATA_DIR = path.join(os.tmpdir(), `arena-bootstrap-${Date.now()}`);
const BOOTSTRAP_PATH = path.join(EXT_PATH, "bootstrap-main-world.js");

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`✅ ${name}`); }
  else { failed++; console.log(`❌ ${name}${detail ? "  → " + JSON.stringify(detail) : ""}`); }
}

console.log("═".repeat(70));
console.log("F32+ bootstrap patch 真 throttle E2E（强制启用 Chrome background throttle）");
console.log("═".repeat(70));

const MOCK_HTML = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Mock SPA</title></head>
<body><h1>Arena E2E</h1>
<script>
  // 模拟 SPA chunk loop
  window.__chunks = 0;
  function pump() { window.__chunks++; setTimeout(pump, 16); }
  setTimeout(pump, 16);

  window.__runDiag = async () => {
    const t1 = performance.now();
    await new Promise(r => setTimeout(r, 100));
    const e1 = performance.now() - t1;

    const t2 = performance.now();
    await new Promise(r => setTimeout(r, 16));
    const e2 = performance.now() - t2;

    const t3 = performance.now();
    await new Promise(r => requestAnimationFrame(r));
    const e3 = performance.now() - t3;

    return {
      visibilityState: document.visibilityState,
      hidden: document.hidden,
      hasFocus: document.hasFocus(),
      patched: !!window.__arenaMainWorldPatched,
      setTimeout100ms: Math.round(e1),
      setTimeout16ms: Math.round(e2),
      rAFms: Math.round(e3),
      chunks: window.__chunks,
    };
  };
</script></body></html>`;

const BOOTSTRAP_CODE = fs.readFileSync(BOOTSTRAP_PATH, "utf8");

const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
  channel: "chromium",
  headless: false,
  // 关键：禁掉 Playwright 默认那些 disable-throttling 的 flag，让 chromium 行为接近真 Chrome
  ignoreDefaultArgs: [
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--disable-features=PaintHolding",
  ],
  args: [
    `--disable-extensions-except=${EXT_PATH}`,
    `--load-extension=${EXT_PATH}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--enable-features=IntensiveWakeUpThrottling,BackgroundTimerThrottling",
  ],
});

try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });

  // ═════════════════════════════════════════════════════════
  // PHASE A: 对比组 — 不注入 patch，验证 throttle 是否生效
  // ═════════════════════════════════════════════════════════
  console.log("\n=== PHASE A: 对比组（无 patch，验证 throttle 生效）===");

  const baselinePage = await ctx.newPage();
  await baselinePage.goto("data:text/html;charset=UTF-8," + encodeURIComponent(MOCK_HTML));
  await baselinePage.waitForLoadState("domcontentloaded");

  // 前台基线
  await baselinePage.bringToFront();
  await new Promise(r => setTimeout(r, 500));
  const blFG = await baselinePage.evaluate(() => window.__runDiag());
  console.log("[对比 前台] visibility:", blFG.visibilityState, "chunks:", blFG.chunks,
    "setTimeout(100):", blFG.setTimeout100ms, "ms");
  const blChunksAtFG = blFG.chunks;

  // 推到 background — 创建新 page focus
  const fgPage = await ctx.newPage();
  await fgPage.goto("about:blank");
  await fgPage.bringToFront();

  // 强制让 baseline 进入 hidden
  await new Promise(r => setTimeout(r, 2000));

  const blChunksBeforeBG = await baselinePage.evaluate(() => window.__chunks);
  await new Promise(r => setTimeout(r, 5000));  // 5 秒看增长
  const blChunksAfterBG = await baselinePage.evaluate(() => window.__chunks);
  const blChunkGrowth = blChunksAfterBG - blChunksBeforeBG;
  const blBG = await baselinePage.evaluate(() => window.__runDiag());
  console.log("[对比 background 5s] chunks 增长:", blChunkGrowth);
  console.log("[对比 background] visibility:", blBG.visibilityState,
    "setTimeout(100):", blBG.setTimeout100ms, "ms",
    "setTimeout(16):", blBG.setTimeout16ms, "ms",
    "rAF:", blBG.rAFms, "ms");

  // 判定 throttle 是否真生效
  const throttleActive =
    blBG.visibilityState === "hidden" &&
    blBG.setTimeout100ms > 500;  // 真 throttle 时 setTimeout(100) 会到 1000ms+
  console.log("\n💡 throttle 在此环境是否真生效?", throttleActive ? "✅ 是" : "❌ 否（环境未模拟真 Chrome throttle）");

  // ═════════════════════════════════════════════════════════
  // PHASE B: patch 组 — 注入 bootstrap，对比 throttle 是否解除
  // ═════════════════════════════════════════════════════════
  console.log("\n=== PHASE B: patch 组（注入 bootstrap）===");

  const patchedPage = await ctx.newPage();
  await patchedPage.goto("data:text/html;charset=UTF-8," + encodeURIComponent(MOCK_HTML));
  await patchedPage.waitForLoadState("domcontentloaded");

  // 用 page.addInitScript 模式注入 — 但 page 已经加载，用 page.evaluate 直接 eval
  // 等价于 manifest world:MAIN document_start 注入（页面 JS 加载前注入更早，但事后注入也工作）
  await patchedPage.evaluate(BOOTSTRAP_CODE);

  // 验证 patch 注入成功
  const patchedFlag = await patchedPage.evaluate(() => !!window.__arenaMainWorldPatched);
  check("PHASE B: patch 注入成功", patchedFlag === true);

  // 前台基线
  await patchedPage.bringToFront();
  await new Promise(r => setTimeout(r, 500));
  const pFG = await patchedPage.evaluate(() => window.__runDiag());
  console.log("[patch 前台] visibility:", pFG.visibilityState, "(锁死=" + pFG.patched + ")",
    "setTimeout(100):", pFG.setTimeout100ms, "ms");

  // 推到 background
  await fgPage.bringToFront();
  await new Promise(r => setTimeout(r, 2000));

  const pChunksBefore = await patchedPage.evaluate(() => window.__chunks);
  await new Promise(r => setTimeout(r, 5000));
  const pChunksAfter = await patchedPage.evaluate(() => window.__chunks);
  const pChunkGrowth = pChunksAfter - pChunksBefore;
  const pBG = await patchedPage.evaluate(() => window.__runDiag());

  console.log("\n[patch background 5s] chunks 增长:", pChunkGrowth);
  console.log("[patch background] visibility:", pBG.visibilityState,
    "hidden:", pBG.hidden,
    "hasFocus:", pBG.hasFocus);
  console.log("[patch background] setTimeout(100):", pBG.setTimeout100ms, "ms",
    "setTimeout(16):", pBG.setTimeout16ms, "ms",
    "rAF:", pBG.rAFms, "ms");

  // ═════════════════════════════════════════════════════════
  // 判定
  // ═════════════════════════════════════════════════════════
  console.log("\n=== 关键判定 ===");
  check("patch 后 visibilityState 锁死 'visible'", pBG.visibilityState === "visible");
  check("patch 后 hidden 锁死 false", pBG.hidden === false);
  check("patch 后 hasFocus 锁死 true", pBG.hasFocus === true);

  if (throttleActive) {
    // 真 throttle 环境下，patch 应解除节流
    check("★ throttle 生效且 patch 后 setTimeout(100) 不被节流 (<500ms)",
      pBG.setTimeout100ms < 500, { actual: pBG.setTimeout100ms, baseline: blBG.setTimeout100ms });
    check("★ throttle 生效且 patch 后 setTimeout(16) 不被节流 (<500ms)",
      pBG.setTimeout16ms < 500, { actual: pBG.setTimeout16ms });
    check("★ patch 后 chunks 增长显著快于对比组 (>3x)",
      pChunkGrowth > blChunkGrowth * 3,
      { patched: pChunkGrowth, baseline: blChunkGrowth });
  } else {
    console.log("\n⚠️  环境未真 throttle (对比组也快)，无法证明 patch 价值");
    console.log("    对比组 5s chunks:", blChunkGrowth, "/ patch 组 5s chunks:", pChunkGrowth);
    console.log("    对比组 setTimeout(100):", blBG.setTimeout100ms, "ms / patch 组:", pBG.setTimeout100ms, "ms");
    console.log("    结论：本机 chromium 版本不复现真 Chrome 的 throttle。需要用真 Chrome 验证 patch 效果。");
    // 至少验证 patch 不破坏功能
    check("[降级] patch 不破坏 setTimeout 基本行为 (<1000ms)",
      pBG.setTimeout100ms < 1000, { actual: pBG.setTimeout100ms });
  }

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
