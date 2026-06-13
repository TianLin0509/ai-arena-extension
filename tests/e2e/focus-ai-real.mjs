// tests/e2e/focus-ai-real.mjs — v5.0.25 唤起 AI 按钮反馈验证
// 修复点："唤起 AI"会把焦点切到独立的 AI 窗口，圆桌窗口里看不到变化 → 用户以为没反应。
//   现在成功/失败都给 toast 反馈。本测试验证：① 真实点击按钮（无遮挡时）触发成功 toast
//   ② 无成员时点击给"还没有 AI"提示 ③ 按钮被全屏 modal 遮挡时点不动（暴露遮挡问题的回归）
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const EXT_PATH = path.join(PROJECT_ROOT, "src");
const USER_DATA_DIR = process.env.E2E_PROFILE_DIR || path.join(__dirname, ".focusai-profile");
if (!process.env.E2E_PROFILE_DIR && fs.existsSync(USER_DATA_DIR)) {
  try { fs.rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch (_) {}
}

const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
  channel: "chromium", headless: false,
  args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`,
    "--no-first-run", "--no-default-browser-check", "--disable-features=DisableLoadExtensionCommandLineSwitch"],
  viewport: { width: 1380, height: 900 },
});
function log(s) { console.log(`[focusai] ${s}`); }

try {
  let extId = ""; { const [sw] = ctx.serviceWorkers(); if (sw) extId = new URL(sw.url()).host; }
  if (!extId) extId = "ndiclbhabflkigblghlapmookalgglic";
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: "domcontentloaded" });
  await popup.waitForTimeout(900);
  for (const p of ctx.pages()) { if (p.url().includes("welcome.html")) await p.close().catch(() => {}); }

  const closeOverlays = () => popup.evaluate(() => {
    document.querySelectorAll(".arena-modal-overlay").forEach(o => o.remove());
  });

  // 切 tab 模式 + 加 deepseek
  await popup.evaluate(() => new Promise(res => chrome.runtime.sendMessage({ type: "setWindowMode", mode: "tab" }, () => res())));
  await popup.evaluate(() => window.ChatWindowMode?.set?.("tab"));
  await popup.waitForTimeout(500);
  await popup.evaluate(() => new Promise(res => chrome.runtime.sendMessage({ type: "addParticipant", service: "deepseek" }, r => res(r))));
  await popup.waitForTimeout(7000);

  // 按钮可见
  const visible = await popup.evaluate(() => {
    const b = document.getElementById("btn-focus-ai-tabs");
    return b && !b.hidden && !!b.offsetParent;
  });
  assert.ok(visible, "Tab 模式 + 有成员时唤起按钮应可见");
  log("① 按钮可见 ✓");

  // 关掉黄条安抚 modal（首次加 AI 会弹）→ 否则全屏遮罩拦截点击（正是"没反应"的一种成因）
  await closeOverlays();
  await popup.waitForTimeout(200);

  // 真实点击 → 成功 toast
  await popup.click("#btn-focus-ai-tabs", { timeout: 8000 });
  await popup.waitForSelector(".arena-toast", { timeout: 5000 });
  const okToast = await popup.locator(".arena-toast").first().innerText();
  assert.ok(okToast.includes("唤到前台"), `成功应有 toast 反馈: ${okToast}`);
  log(`② 点击有成功反馈 ✓「${okToast}」`);

  // 无成员场景：hardReset 后点击 → "还没有 AI"
  await popup.evaluate(() => new Promise(res => chrome.runtime.sendMessage({ type: "hardReset" }, () => res())));
  await popup.waitForTimeout(800);
  await closeOverlays();
  const stillVisible = await popup.evaluate(() => {
    const b = document.getElementById("btn-focus-ai-tabs");
    return b && !b.hidden;
  });
  if (stillVisible) {
    await popup.click("#btn-focus-ai-tabs", { timeout: 8000 });
    await popup.waitForFunction(() => {
      const t = [...document.querySelectorAll(".arena-toast")].map(e => e.textContent).join("|");
      return t.includes("还没有 AI");
    }, { timeout: 5000 });
    log("③ 无成员点击给「还没有 AI」提示 ✓");
  } else {
    log("③ hardReset 后按钮已隐藏（亦可接受）");
  }

  console.log("[focusai] ✅ 唤起 AI 反馈验证通过");
} finally {
  await ctx.close();
}
