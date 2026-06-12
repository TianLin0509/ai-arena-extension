// tests/e2e/welcome-chips-real.mjs — v5.0.23 P1 真实链路 E2E
// 覆盖：
//   1) 全新安装 → onInstalled(reason=install) 自动打开 welcome.html（仅一次，storage 标记）
//   2) 欢迎页 CTA → 圆桌 popup 窗口打开
//   3) 空状态示例问题 chips → 一键填入输入框
//   4) 添加 DeepSeek（游客态）→ 登录警告气泡内嵌「🔑 去登录页」按钮可点 → 激活 AI 页
// 用法：node tests/e2e/welcome-chips-real.mjs
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const EXT_PATH = path.join(PROJECT_ROOT, "src");
const USER_DATA_DIR = process.env.E2E_PROFILE_DIR || path.join(__dirname, ".welcome-profile");
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

function log(s) { console.log(`[wc-e2e] ${s}`); }

try {
  let extId = process.env.ARENA_EXT_ID || "";
  {
    const [sw] = ctx.serviceWorkers();
    if (sw) extId = new URL(sw.url()).host;
  }
  if (!extId) extId = "ndiclbhabflkigblghlapmookalgglic";
  log(`ext=${extId}`);

  // ── 场景 1：onInstalled 自动打开欢迎页 ──
  let welcome = null;
  for (let i = 0; i < 20 && !welcome; i++) {
    welcome = ctx.pages().find(p => p.url().includes("welcome.html")) || null;
    if (!welcome) await new Promise(r => setTimeout(r, 500));
  }
  assert.ok(welcome, "全新安装应自动打开 welcome.html");
  await welcome.waitForSelector("#btn-open", { timeout: 8000 });
  const h1 = await welcome.locator("h1").innerText();
  assert.ok(h1.includes("欢迎"), `欢迎页标题: ${h1}`);
  await welcome.screenshot({ path: path.join(ARTIFACTS, "welcome-page.png") });
  // storage 标记已写
  const flag = await welcome.evaluate(() => new Promise(res => chrome.storage.local.get(["welcomeShown"], res)));
  assert.equal(flag.welcomeShown, true, "welcomeShown 标记应已落盘");
  log("场景 1 ✓ 欢迎页自动打开 + 标记落盘");

  // ── 场景 2：CTA 打开圆桌窗口 ──
  const beforeN = ctx.pages().length;
  await welcome.click("#btn-open");
  let popup = null;
  for (let i = 0; i < 20 && !popup; i++) {
    popup = ctx.pages().find(p => p.url().includes("popup.html")) || null;
    if (!popup) await new Promise(r => setTimeout(r, 500));
  }
  assert.ok(popup, "CTA 应打开 popup.html 圆桌窗口");
  const doneVisible = await welcome.locator("#cta-done").isVisible();
  assert.ok(doneVisible, "CTA 点击后应显示成功提示");
  await popup.waitForTimeout(1200);
  log("场景 2 ✓ CTA → 圆桌窗口");

  // ── 场景 3：示例问题 chips 填入输入框 ──
  await popup.waitForSelector(".es-starter", { timeout: 8000 });
  const chipTxt = await popup.locator(".es-starter").first().innerText();
  await popup.locator(".es-starter").first().click();
  const inputTxt = await popup.locator("#chat-input").innerText();
  assert.ok(inputTxt.includes("5000 元预算买手机"), `chip 应填入输入框: ${inputTxt}`);
  log(`场景 3 ✓ chips（${chipTxt}）一键填入`);

  // ── 场景 4：登录警告气泡内嵌去登录按钮 ──
  await popup.evaluate(() => { window.ChatRightPanel?.activate("members"); });
  await popup.waitForTimeout(300);
  await popup.click('.rp-add-btn[data-service="deepseek"]');
  await popup.waitForSelector(".bubble-login-btn", { timeout: 25000 });
  await popup.screenshot({ path: path.join(ARTIFACTS, "login-bubble-action.png") });
  await popup.click(".bubble-login-btn");
  await popup.waitForTimeout(1200);
  assert.ok(ctx.pages().some(p => p.url().includes("chat.deepseek.com")), "去登录按钮应已打开/激活 deepseek 页");
  log("场景 4 ✓ 登录警告气泡 🔑 按钮可点");

  console.log("[wc-e2e] ✅ 全部 4 场景通过");
} finally {
  await ctx.close();
}
