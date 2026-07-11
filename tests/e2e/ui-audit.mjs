// ui-audit.mjs — 新用户首启视角 UI 审计（只读，不改产品）
// 全新 profile 加载扩展开 popup：全景截图、header 按钮清单、右栏 tabs、
// 任务菜单、浮层/toast 盘点。运行：node tests/e2e/ui-audit.mjs
import { chromium } from "playwright";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const EXT_PATH = path.join(PROJECT_ROOT, "src");
const USER_DATA_DIR = path.join(os.tmpdir(), `arena-audit-${Date.now()}`);
const OUT = path.join(PROJECT_ROOT, "output", "ui-audit");
fs.mkdirSync(OUT, { recursive: true });

const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
  channel: "chromium", headless: false,
  args: [
    `--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`,
    "--no-first-run", "--no-default-browser-check",
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
  ],
});

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15000 });
  const extId = sw.url().split("/")[2];
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.goto(`chrome-extension://${extId}/popup.html`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2500);   // 等首启弹层/toast/引导全部冒出来

  await page.screenshot({ path: path.join(OUT, "01-first-run-full.png") });

  const audit = await page.evaluate(() => {
    const vis = el => el && el.offsetParent !== null && el.getBoundingClientRect().width > 0;
    const cls = el => (el.getAttribute && el.getAttribute("class")) || "";
    const txt = el => (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);

    // header 按钮
    const headerBtns = [...document.querySelectorAll(".chat-header .chat-actions > *")]
      .map(el => ({ id: el.id || cls(el).split(" ")[0], text: txt(el) || el.title?.slice(0, 30) || "(icon)", visible: vis(el) }));

    // 右栏 tabs
    const rpTabs = [...document.querySelectorAll(".chat-rightpanel [class*='tab'], .rightpanel-tabs > *, [class*='rp-tab']")]
      .filter(vis).map(el => ({ cls: cls(el).split(" ").slice(0, 2).join("."), text: txt(el) }));

    // 明显的浮层/遮罩/toast（首启噪音）
    const overlaySel = [
      "[class*='overlay']", "[class*='modal']", "[class*='toast']", "[class*='tour']",
      "[class*='onboard']", "[class*='tutorial']", "[class*='fab']", "[class*='badge-pop']",
      "[class*='banner']", "[class*='notice']", "[id*='doctor']", "[class*='achievement']",
    ];
    const overlays = [...new Set(overlaySel.flatMap(s => [...document.querySelectorAll(s)]))]
      .filter(vis)
      .map(el => ({ tag: el.tagName.toLowerCase(), idOrCls: el.id || cls(el).split(" ").slice(0, 2).join("."), text: txt(el), z: getComputedStyle(el).zIndex }));

    // 空状态区
    const empty = document.querySelector("[class*='empty-state'], [class*='empty']");
    // 输入区附近的控件
    const composer = [...document.querySelectorAll(".chat-input-area button, .chat-composer button, [class*='input'] ~ * button")]
      .filter(vis).slice(0, 15).map(el => ({ id: el.id || cls(el).split(" ")[0], text: txt(el) || el.title?.slice(0, 20) }));

    // 成员/roster 区域可见按钮
    const roster = [...document.querySelectorAll("[class*='roster'] button, [class*='member'] button")]
      .filter(vis).slice(0, 20).map(el => ({ id: el.id || cls(el).split(" ")[0], text: txt(el) || el.title?.slice(0, 20) }));

    return {
      headerBtns, rpTabs, overlays,
      emptyStateText: empty && vis(empty) ? txt(empty) : "(不可见或不存在)",
      composer, roster,
      bodyMode: document.body.dataset.mode || "(default)",
      totalVisibleButtons: [...document.querySelectorAll("button")].filter(vis).length,
    };
  });
  console.log(JSON.stringify(audit, null, 2));

  // 打开任务菜单截图（若存在）
  const taskBtn = page.locator("#btn-task-menu, [id*='task-menu'], [class*='task-picker'] button").first();
  if (await taskBtn.count()) {
    await taskBtn.click().catch(() => {});
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, "02-task-menu.png") });
    await page.keyboard.press("Escape").catch(() => {});
  }

  // 右栏每个 tab 截图
  const tabs = page.locator(".rightpanel-tabs > *, [class*='rp-tab']");
  const n = Math.min(await tabs.count(), 8);
  for (let i = 0; i < n; i++) {
    await tabs.nth(i).click().catch(() => {});
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT, `03-rptab-${i}.png`) });
  }

  console.log(`[audit] 截图目录: ${OUT}`);
} finally {
  await context.close();
  fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
}
