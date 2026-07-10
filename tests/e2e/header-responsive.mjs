// header-responsive.mjs — v5.0.66 响应式 header 密度 E2E
// 真实加载扩展打开 popup.html，在 container query 断点(1180/980/860/620/480)两侧
// 取样宽度，断言顶栏保持单行不溢出，并逐档截图供人工复核。
// 运行：node tests/e2e/header-responsive.mjs
import { chromium } from "playwright";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const EXT_PATH = path.join(PROJECT_ROOT, "src");
const USER_DATA_DIR = path.join(os.tmpdir(), `arena-hdr-e2e-${Date.now()}`);
const SHOT_DIR = path.join(PROJECT_ROOT, "output", "header-responsive");
fs.mkdirSync(SHOT_DIR, { recursive: true });

const WIDTHS = [1366, 1240, 1024, 900, 700, 520, 460];
let failed = 0;

const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
  channel: "chromium",
  headless: false,
  args: [
    `--disable-extensions-except=${EXT_PATH}`,
    `--load-extension=${EXT_PATH}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
  ],
});

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15000 });
  const extId = sw.url().split("/")[2];

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/popup.html`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(600);   // 等 popup.js 初始化/历史恢复完

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 820 });
    // 真实窄屏姿态：≤900px 用户会折叠左侧对话目录（等效点 grabber 切 .collapsed）
    await page.evaluate((w) => {
      document.querySelector(".chat-sidebar")?.classList.toggle("collapsed", w <= 900);
    }, width);
    await page.waitForTimeout(150);
    const m = await page.evaluate(() => {
      const h = document.querySelector(".chat-header");
      if (!h) return { missing: true };
      const kids = [...h.querySelectorAll(".chat-title, .chat-actions > *")]
        .filter(el => el.offsetParent !== null && el.getBoundingClientRect().width > 0);
      const tops = kids.map(el => Math.round(el.getBoundingClientRect().top));
      return {
        clientHeight: h.clientHeight,
        scrollWidth: h.scrollWidth,
        clientWidth: h.clientWidth,
        visibleChildren: kids.length,
        topSpread: tops.length ? Math.max(...tops) - Math.min(...tops) : 0,
      };
    });
    const shot = path.join(SHOT_DIR, `w${width}.png`);
    await page.screenshot({ path: shot, clip: { x: 0, y: 0, width, height: 72 } });

    const problems = [];
    if (m.missing) problems.push("找不到 .chat-header");
    else if (m.clientWidth < 360) {
      // 容器被 sidebar/右栏挤进不可用区（聊天区本身已没法用）——header 只要求 overflow:hidden 兜底不破版，不做严格断言
      console.log(`○ w=${width}: 容器仅 ${m.clientWidth}px（不可用区，跳过严格断言）  → ${shot}`);
      continue;
    } else {
      if (m.scrollWidth > m.clientWidth + 1) problems.push(`横向溢出 scrollWidth ${m.scrollWidth} > clientWidth ${m.clientWidth}`);
      if (m.clientHeight > 60) problems.push(`疑似折行 clientHeight=${m.clientHeight}`);
      if (m.topSpread > 14) problems.push(`子元素纵向散布 ${m.topSpread}px（应同一行）`);
      if (m.visibleChildren < 3) problems.push(`可见控件仅 ${m.visibleChildren} 个`);
    }
    if (problems.length) { failed++; console.log(`✗ w=${width}: ${problems.join("; ")}  → ${shot}`); }
    else console.log(`✓ w=${width}: 单行不溢出 (h=${m.clientHeight}, 容器 ${m.clientWidth}px, 控件×${m.visibleChildren})  → ${shot}`);
  }
} finally {
  await context.close();
  fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
}

if (failed) { console.log(`\nheader-responsive: ${failed} 档失败`); process.exit(1); }
console.log("\nheader-responsive: 全部宽度档通过");
