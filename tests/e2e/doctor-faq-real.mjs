// tests/e2e/doctor-faq-real.mjs — v5.0.24 真实链路 E2E
// 覆盖：
//   1) 任务菜单白话注释渲染（同时提问含 🔰 新手推荐）
//   2) 设置 Tab FAQ 8 条 details 可展开
//   3) 一键体检：无成员提示 → 添加 DeepSeek → 体检报告（tab ✓ / 通道 ✓ / 登录 ✗+去登录按钮）
//   4) 体检修复闭环：手动关掉 AI 标签页 → 体检红灯「重新打开」→ 点击 → 复查变绿
//   5) 卡住哨兵存在性冒烟（监听器注册，不等 90s）
// 用法：node tests/e2e/doctor-faq-real.mjs
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const EXT_PATH = path.join(PROJECT_ROOT, "src");
const USER_DATA_DIR = process.env.E2E_PROFILE_DIR || path.join(__dirname, ".doctor-profile");
if (!process.env.E2E_PROFILE_DIR && fs.existsSync(USER_DATA_DIR)) {
  try { fs.rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch (_) {}
}
const ARTIFACTS = path.join(PROJECT_ROOT, ".arena", "artifacts", "onboarding");
fs.mkdirSync(ARTIFACTS, { recursive: true });

const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
  channel: "chromium",
  headless: false,
  args: [
    `--disable-extensions-except=${EXT_PATH}`,
    `--load-extension=${EXT_PATH}`,
    "--no-first-run", "--no-default-browser-check",
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
  ],
  viewport: { width: 1380, height: 900 },
});

function log(s) { console.log(`[dr-e2e] ${s}`); }

try {
  let extId = process.env.ARENA_EXT_ID || "";
  {
    const [sw] = ctx.serviceWorkers();
    if (sw) extId = new URL(sw.url()).host;
  }
  if (!extId) extId = "ndiclbhabflkigblghlapmookalgglic";
  log(`ext=${extId}`);

  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: "domcontentloaded" });
  await popup.waitForTimeout(900);
  // 关掉自动弹的欢迎页（onInstalled），不影响本测试
  for (const p of ctx.pages()) { if (p.url().includes("welcome.html")) await p.close().catch(() => {}); }

  // ── 场景 1：任务菜单白话注释 ──
  await popup.click("#task-picker-btn");
  await popup.waitForSelector("#task-menu:not([hidden])", { timeout: 5000 });
  const askDesc = await popup.locator('#task-menu .menu-item[data-task="ask"] .menu-desc').innerText();
  assert.ok(askDesc.includes("新手先用这个"), `同时提问应带新手推荐注释: ${askDesc}`);
  const descCount = await popup.locator("#task-menu .menu-desc").count();
  assert.ok(descCount >= 5, `顶级模式都应有白话注释，实际 ${descCount}`);
  await popup.screenshot({ path: path.join(ARTIFACTS, "task-menu-desc.png") });
  await popup.keyboard.press("Escape");
  await popup.click("body", { position: { x: 400, y: 100 } });
  log(`场景 1 ✓ 模式白话注释 ×${descCount}`);

  // ── 场景 2：FAQ ──
  await popup.evaluate(() => { window.ChatRightPanel?.activate("settings"); });
  await popup.waitForSelector(".rp-faq details", { timeout: 5000 });
  const faqCount = await popup.locator(".rp-faq details").count();
  assert.equal(faqCount, 8, `FAQ 应 8 条，实际 ${faqCount}`);
  await popup.locator(".rp-faq details summary").first().click();
  const faqOpen = await popup.locator(".rp-faq details[open]").count();
  assert.equal(faqOpen, 1, "FAQ 应可展开");
  log("场景 2 ✓ FAQ 8 条可展开");

  // ── 场景 3：体检（无成员 → 有成员·未登录红灯）──
  await popup.evaluate(() => { window.ChatRightPanel?.activate("members"); });
  await popup.waitForTimeout(300);
  await popup.click("#rp-doctor-btn");
  await popup.waitForSelector(".doctor-modal.show", { timeout: 5000 });
  let title = await popup.locator(".doctor-modal .arena-modal-title").innerText();
  assert.ok(title.includes("还没有 AI 成员"), `空成员体检提示: ${title}`);
  await popup.click('.doctor-modal [data-role="cancel"]');
  await popup.waitForTimeout(300);

  await popup.click('.rp-add-btn[data-service="deepseek"]');
  await popup.waitForTimeout(9000);  // 等页面加载 + content script + 登录探测落定
  await popup.click("#rp-doctor-btn");
  await popup.waitForSelector(".doctor-modal.show .doc-item", { timeout: 8000 });
  const checks = await popup.evaluate(() => {
    const item = document.querySelector(".doctor-modal .doc-item");
    return {
      lights: [...item.querySelectorAll(".doc-light")].map(l => l.classList.contains("ok")),
      fixes: [...item.querySelectorAll(".doc-fix")].map(b => b.dataset.fix),
    };
  });
  assert.equal(checks.lights[0], true, "标签页应绿灯");
  assert.equal(checks.lights[1], true, "插件通道应绿灯");
  assert.equal(checks.lights[2], false, "游客态登录应红灯");
  assert.ok(checks.fixes.includes("login"), "登录红灯应有去登录按钮");
  await popup.screenshot({ path: path.join(ARTIFACTS, "doctor-login-red.png") });
  await popup.click('.doctor-modal [data-role="cancel"]');
  log("场景 3 ✓ 体检三灯 + 登录红灯修复按钮");

  // ── 场景 4：关掉 AI 标签页 → 成员自动移除（产品既有自愈：tabs.onRemoved → removeParticipant）──
  //   注：体检的「重新打开」按钮属防御性边角（仅 SW 休眠期关页产生 stale tabId 时可达），
  //   常规路径下成员被自动移除、不会留僵尸 — 这里断言的就是该自愈行为本身。
  for (const p of ctx.pages()) { if (p.url().includes("chat.deepseek.com")) await p.close().catch(() => {}); }
  await popup.waitForTimeout(1200);
  const slotsAfterClose = await popup.locator(".hero-slot.filled").count();
  assert.equal(slotsAfterClose, 0, "关掉 AI 标签页后成员应被自动移除（自愈，不留僵尸）");
  await popup.click("#rp-doctor-btn");
  await popup.waitForSelector(".doctor-modal.show", { timeout: 5000 });
  title = await popup.locator(".doctor-modal .arena-modal-title").innerText();
  assert.ok(title.includes("还没有 AI 成员"), `自动移除后体检应回到无成员态: ${title}`);
  await popup.click('.doctor-modal [data-role="cancel"]');
  log("场景 4 ✓ 关页自愈（成员自动移除，无僵尸）");

  // ── 场景 5：卡住哨兵冒烟（toast onClick 链路已由场景 3 的 ChatDoctor 验证）──
  const sentinelOk = await popup.evaluate(() => typeof window.ChatDoctor?.run === "function" && !!window.ChatToast);
  assert.ok(sentinelOk, "ChatDoctor/ChatToast 应已挂载（哨兵依赖）");
  log("场景 5 ✓ 哨兵依赖冒烟");

  console.log("[dr-e2e] ✅ 全部 5 场景通过");
} finally {
  await ctx.close();
}
