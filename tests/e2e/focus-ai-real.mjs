// tests/e2e/focus-ai-real.mjs — v5.0.28 唤起 AI（用户反馈：并列模式点了没反应）
// 修复：唤起 = 对每个 AI 执行"点 logo 跳原页"同款动作（windows.update focused + tabs.update active），
//   去掉旧的 windowMode!=="tab" 守卫，按钮两种模式都显示可用。本测试主测并列(tiled)模式。
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
  await popup.waitForTimeout(1000);
  for (const p of ctx.pages()) { if (p.url().includes("welcome.html")) await p.close().catch(() => {}); }

  // 显式并列(tiled)模式 —— 用户场景
  await popup.evaluate(() => new Promise(res => chrome.runtime.sendMessage({ type: "setWindowMode", mode: "tiled" }, () => res())));
  await popup.evaluate(() => window.ChatWindowMode?.set?.("tiled"));
  await popup.waitForTimeout(400);

  // ① 并列模式下按钮应可见（修复前 hidden）
  const visIdle = await popup.evaluate(() => {
    const b = document.getElementById("btn-focus-ai-tabs");
    return b && !b.hidden;
  });
  assert.ok(visIdle, "并列模式下唤起按钮应可见（修复前仅 Tab 模式显示）");
  log("① 并列模式按钮可见 ✓");

  // 加两个 AI（并列模式 → 各自独立窗口）
  await popup.evaluate(() => new Promise(res => chrome.runtime.sendMessage({ type: "addParticipant", service: "deepseek" }, r => res(r))));
  await popup.waitForTimeout(3500);
  await popup.evaluate(() => new Promise(res => chrome.runtime.sendMessage({ type: "addParticipant", service: "kimi" }, r => res(r))));
  await popup.waitForTimeout(3500);

  // ② 直接调 focusAllAiTabs 应成功（不再被 windowMode 守卫拦）
  const r = await popup.evaluate(() => new Promise(res => chrome.runtime.sendMessage({ type: "focusAllAiTabs" }, resp => res(resp))));
  assert.ok(r?.ok, `并列模式 focusAllAiTabs 应成功: ${JSON.stringify(r)}`);
  assert.ok(r.focused >= 2, `应唤起 ≥2 个 AI，实际 ${r.focused}`);
  log(`② focusAllAiTabs 并列模式成功 ✓ focused=${r.focused}/${r.total}`);

  // ③ 真实点击按钮 → 成功 toast
  await popup.bringToFront();
  await popup.click("#btn-focus-ai-tabs", { timeout: 8000 });
  await popup.waitForSelector(".arena-toast", { timeout: 5000 });
  const toast = await popup.locator(".arena-toast").first().innerText();
  assert.ok(toast.includes("唤到前台"), `点击应有成功反馈: ${toast}`);
  log(`③ 点击按钮有成功反馈 ✓「${toast}」`);

  // ④ 无成员场景：hardReset → 点击给"还没有 AI"
  await popup.evaluate(() => new Promise(res => chrome.runtime.sendMessage({ type: "hardReset" }, () => res())));
  await popup.waitForTimeout(800);
  await popup.bringToFront();
  await popup.click("#btn-focus-ai-tabs", { timeout: 8000 });
  await popup.waitForFunction(() => {
    const t = [...document.querySelectorAll(".arena-toast")].map(e => e.textContent).join("|");
    return t.includes("还没有 AI");
  }, { timeout: 5000 });
  log("④ 无成员点击给「还没有 AI」提示 ✓");

  console.log("[focusai] ✅ 唤起 AI（并列模式）修复验证通过");
} finally {
  await ctx.close();
}
