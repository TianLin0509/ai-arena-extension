// simple-mode.mjs — v5.0.67 渐进披露矩阵 E2E
// 真实加载扩展验证两态可见性矩阵 + ⋯更多菜单行为 + 解锁往返，逐态截图。
// 运行：node tests/e2e/simple-mode.mjs
import { chromium } from "playwright";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const EXT_PATH = path.join(PROJECT_ROOT, "src");
const USER_DATA_DIR = path.join(os.tmpdir(), `arena-simple-${Date.now()}`);
const OUT = path.join(PROJECT_ROOT, "output", "simple-mode");
fs.mkdirSync(OUT, { recursive: true });

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`✓ ${name}`); }
  else { failed++; console.log(`✗ ${name}${detail ? " → " + detail : ""}`); }
}

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
  await page.waitForTimeout(1200);

  const vis = sel => page.evaluate(s => {
    const el = document.querySelector(s);
    return !!(el && el.offsetParent !== null && getComputedStyle(el).display !== "none");
  }, sel);

  // ── 首启 = 新手精简模式 ──
  check("首启进入精简模式（body.adv-locked）", await page.evaluate(() => document.body.classList.contains("adv-locked")));
  for (const [name, sel, expect] of [
    ["header 折叠到顶 隐藏", "#btn-mini-mode", false],
    ["header 简洁 隐藏", "#btn-compact-mode", false],
    ["header PPT 隐藏", "#btn-ppt-super", false],
    ["header 对比 隐藏", "#btn-compare", false],
    ["header 彻底重置 隐藏（全等级收纳）", "#btn-hard-reset", false],
    ["header ⋯更多 可见", "#btn-more", true],
    ["header 清空群聊 可见", "#btn-clear", true],
    ["右栏 成员 tab 可见", '.rp-tab[data-tab="members"]', true],
    ["右栏 设置 tab 可见", '.rp-tab[data-tab="settings"]', true],
    ["右栏 任务 tab 隐藏", '.rp-tab[data-tab="tasks"]', false],
    ["右栏 统计 tab 隐藏", '.rp-tab[data-tab="stats"]', false],
    ["右栏 模板 tab 隐藏", '.rp-tab[data-tab="templates"]', false],
    ["右栏 备忘 tab 隐藏", '.rp-tab[data-tab="memos"]', false],
    ["角色帽 section 隐藏", ".rp-hat-section", false],
    ["状态日志 隐藏", "#rp-bottom", false],
    ["空状态 7 玩法词条 隐藏", "#es-features", false],
    ["安全说明横条 可见（新手教育）", ".roster-upload-hint", true],
  ]) {
    check(`精简: ${name}`, (await vis(sel)) === expect);
  }
  const visibleButtons = await page.evaluate(() =>
    [...document.querySelectorAll("button")].filter(el => el.offsetParent !== null && el.getBoundingClientRect().width > 0).length);
  console.log(`  (精简模式可见按钮数: ${visibleButtons})`);
  await page.screenshot({ path: path.join(OUT, "01-simple.png") });

  // ── ⋯更多菜单：精简模式列出全部进阶项 + 解锁入口，代理点击可用 ──
  await page.click("#btn-more");
  await page.waitForTimeout(200);
  check("⋯菜单展开", await vis("#hdr-more-menu"));
  for (const [name, sel] of [
    ["菜单含 折叠到顶", '[data-more="btn-mini-mode"]'],
    ["菜单含 简洁", '[data-more="btn-compact-mode"]'],
    ["菜单含 PPT", '[data-more="btn-ppt-super"]'],
    ["菜单含 对比", '[data-more="btn-compare"]'],
    ["菜单含 解锁完整界面", '[data-more="unlock"]'],
    ["菜单含 彻底重置", '[data-more="btn-hard-reset"]'],
  ]) check(`精简: ${name}`, await vis(sel));
  await page.screenshot({ path: path.join(OUT, "02-simple-more-menu.png") });
  await page.keyboard.press("Escape");
  check("Escape 关闭菜单", !(await vis("#hdr-more-menu")));

  // ── 菜单「解锁完整界面」→ 完整模式 ──
  await page.click("#btn-more");
  await page.click('[data-more="unlock"]');
  await page.waitForTimeout(400);
  check("解锁后退出精简（无 adv-locked）", await page.evaluate(() => !document.body.classList.contains("adv-locked")));
  for (const [name, sel, expect] of [
    ["header 折叠到顶 出现", "#btn-mini-mode", true],
    ["header PPT 出现", "#btn-ppt-super", true],
    ["右栏 统计 tab 出现", '.rp-tab[data-tab="stats"]', true],
    ["右栏 备忘 tab 出现", '.rp-tab[data-tab="memos"]', true],
    ["状态日志 出现", "#rp-bottom", true],
    ["空状态玩法词条 出现", "#es-features", true],
    ["彻底重置仍收纳（不回 header）", "#btn-hard-reset", false],
    ["安全横条不再常驻", ".roster-upload-hint", false],
  ]) check(`完整: ${name}`, (await vis(sel)) === expect);

  // 完整模式下 ⋯菜单只剩彻底重置（不重复列常驻按钮）
  await page.click("#btn-more");
  await page.waitForTimeout(200);
  check("完整: 菜单不再列 PPT", !(await vis('[data-more="btn-ppt-super"]')));
  check("完整: 菜单保留 彻底重置", await vis('[data-more="btn-hard-reset"]'));
  await page.screenshot({ path: path.join(OUT, "03-full-more-menu.png") });
  await page.keyboard.press("Escape");
  await page.screenshot({ path: path.join(OUT, "04-full.png") });

  // ── 设置「完整模式→精简模式」回切 + 被藏 tab 防御回成员页 ──
  await page.evaluate(() => window.ChatRightPanel?.activate("stats"));
  await page.waitForTimeout(200);
  await page.evaluate(() => window.ChatProgressive?.lock());
  await page.waitForTimeout(300);
  check("回切精简后 active tab 防御回成员页", await page.evaluate(() =>
    document.querySelector('.rp-tab.active')?.dataset.tab === "members"));
  check("回切精简后统计 tab 复隐", !(await vis('.rp-tab[data-tab="stats"]')));
} finally {
  await context.close();
  fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
}

console.log(`\nsimple-mode: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
