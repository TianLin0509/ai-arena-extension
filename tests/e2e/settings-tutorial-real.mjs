// tests/e2e/settings-tutorial-real.mjs — v5.0.27
// ① 完整玩法手册修复：有对话(empty-state 隐藏)时点新手教程，modal 仍能显示（脱离 empty-state 挂 body）
// ② 新手/老手界面模式切换：设置 toggle → body.adv-locked
// ③ 📺 演示按钮 → 打开 welcome.html
// ④ FAQ 条数 ≥ 13
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const EXT_PATH = path.join(PROJECT_ROOT, "src");
const USER_DATA_DIR = process.env.E2E_PROFILE_DIR || path.join(__dirname, ".settut-profile");
if (!process.env.E2E_PROFILE_DIR && fs.existsSync(USER_DATA_DIR)) {
  try { fs.rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch (_) {}
}
const ARTIFACTS = path.join(PROJECT_ROOT, ".arena", "artifacts", "onboarding");
fs.mkdirSync(ARTIFACTS, { recursive: true });

const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
  channel: "chromium", headless: false,
  args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`,
    "--no-first-run", "--no-default-browser-check", "--disable-features=DisableLoadExtensionCommandLineSwitch"],
  viewport: { width: 1380, height: 900 },
});
function log(s) { console.log(`[settut] ${s}`); }

try {
  let extId = ""; { const [sw] = ctx.serviceWorkers(); if (sw) extId = new URL(sw.url()).host; }
  if (!extId) extId = "ndiclbhabflkigblghlapmookalgglic";
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: "domcontentloaded" });
  await popup.waitForTimeout(1000);
  for (const p of ctx.pages()) { if (p.url().includes("welcome.html")) await p.close().catch(() => {}); }

  // ── ① 教程手册修复：模拟"有对话"(empty-state display:none) 后点教程仍能显示 ──
  await popup.evaluate(() => {
    const es = document.getElementById("empty-state");
    if (es) es.style.display = "none";   // 复现 ensureEmptyHidden 的效果
    window.ChatTutorial?.show?.();
  });
  await popup.waitForTimeout(400);
  const tut = await popup.evaluate(() => {
    const el = document.getElementById("es-tutorial");
    if (!el) return { inBody: false, visible: false, isModal: false };
    const rect = el.getBoundingClientRect();
    // 注：position:fixed 元素 offsetParent 恒为 null，改用 display + 尺寸判可见
    return {
      inBody: el.parentElement === document.body,
      visible: !el.hidden && getComputedStyle(el).display !== "none" && rect.width > 0 && rect.height > 0,
      isModal: el.classList.contains("es-tutorial-modal"),
    };
  });
  assert.ok(tut.inBody, "教程应移到 body 脱离 empty-state");
  assert.ok(tut.visible, "有对话时点教程，modal 应可见（修复前不可见）");
  assert.ok(tut.isModal, "应为 modal 形态");
  await popup.screenshot({ path: path.join(ARTIFACTS, "tutorial-over-chat.png") });
  // 关闭教程
  await popup.click("#es-tutorial-close").catch(() => {});
  await popup.waitForTimeout(200);
  log("① 完整玩法手册修复 ✓ 有对话时可显示");

  // ── ② 新手/老手模式切换 ──
  await popup.evaluate(() => { window.ChatRightPanel?.activate("settings"); });
  await popup.waitForSelector("#rp-mode-toggle", { timeout: 4000 });
  const before = await popup.evaluate(() => ({
    label: document.getElementById("rp-mode-toggle").textContent.trim(),
    locked: document.body.classList.contains("adv-locked"),
  }));
  assert.ok(before.label.includes("新手"), `初始应是新手模式: ${before.label}`);
  assert.equal(before.locked, true, "新手模式 body 应 adv-locked");
  await popup.click("#rp-mode-toggle");
  await popup.waitForTimeout(300);
  const after = await popup.evaluate(() => ({
    label: document.getElementById("rp-mode-toggle").textContent.trim(),
    locked: document.body.classList.contains("adv-locked"),
  }));
  assert.ok(after.label.includes("老手"), `切换后应是老手模式: ${after.label}`);
  assert.equal(after.locked, false, "老手模式 body 不应 adv-locked");
  // 切回新手
  await popup.click("#rp-mode-toggle");
  await popup.waitForTimeout(300);
  const back = await popup.evaluate(() => document.body.classList.contains("adv-locked"));
  assert.equal(back, true, "切回新手应重新 adv-locked");
  log("② 新手/老手模式切换 ✓");

  // ── ④ FAQ 条数 ──
  const faqN = await popup.locator(".rp-faq details").count();
  assert.ok(faqN >= 13, `FAQ 应 ≥13 条，实际 ${faqN}`);
  log(`④ FAQ 扩充 ✓ 共 ${faqN} 条`);

  // ── ③ 演示按钮打开 welcome ──
  await popup.click("#rp-open-welcome");
  await popup.waitForTimeout(1200);
  const welcomeOpen = ctx.pages().some(p => p.url().includes("welcome.html"));
  assert.ok(welcomeOpen, "📺 演示应打开 welcome.html");
  log("③ 演示按钮 → 欢迎页 ✓");

  console.log("[settut] ✅ 全部通过（①手册修复 ②模式切换 ③演示入口 ④FAQ扩充）");
} finally {
  await ctx.close();
}
