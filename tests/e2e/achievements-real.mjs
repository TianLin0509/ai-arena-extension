// tests/e2e/achievements-real.mjs — v5.0.36 成就徽章
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const EXT_PATH = path.join(PROJECT_ROOT, "src");
const USER_DATA_DIR = process.env.E2E_PROFILE_DIR || path.join(__dirname, ".ach-profile");
if (!process.env.E2E_PROFILE_DIR && fs.existsSync(USER_DATA_DIR)) {
  try { fs.rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch (_) {}
}
const ARTIFACTS = path.join(PROJECT_ROOT, ".arena", "artifacts", "ach");
fs.mkdirSync(ARTIFACTS, { recursive: true });

const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
  channel: "chromium", headless: false,
  args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`,
    "--no-first-run", "--no-default-browser-check", "--disable-features=DisableLoadExtensionCommandLineSwitch"],
  viewport: { width: 1380, height: 900 },
});
function log(s) { console.log(`[ach] ${s}`); }

try {
  let extId = ""; { const [sw] = ctx.serviceWorkers(); if (sw) extId = new URL(sw.url()).host; }
  if (!extId) extId = "ndiclbhabflkigblghlapmookalgglic";
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: "domcontentloaded" });
  await popup.waitForTimeout(1200);   // 等 achievements init 完成（_initialized=true）
  for (const p of ctx.pages()) { if (p.url().includes("welcome.html")) await p.close().catch(() => {}); }

  // ① 注入达标 stats → storage.onChanged → 解锁 toast
  await popup.evaluate(() => new Promise(res => chrome.storage.local.set({
    arena_lifetime_stats: { conversations: 12, debates: 11, totalChars: 12000, models: { deepseek: {}, doubao: {}, kimi: {} }, taskCounts: { ask: 5, debate: 3, summary: 1, ppt: 1 } },
  }, res)));
  await popup.waitForSelector(".arena-toast", { timeout: 5000 });
  const toast = await popup.locator(".arena-toast").first().innerText();
  assert.ok(toast.includes("成就解锁"), `应弹成就解锁 toast: ${toast}`);
  log(`① 成就解锁 toast ✓「${toast.slice(0, 30)}…」`);

  // ② badges 落库
  await popup.waitForTimeout(500);
  const badges = await popup.evaluate(() => new Promise(res => chrome.storage.local.get(["arena_badges_earned"], d => res(d.arena_badges_earned || []))));
  assert.ok(badges.length >= 5, `达标后应解锁多个成就，实际 ${badges.length}`);
  log(`② badges 落库 ✓ ${badges.length} 个`);

  // ③ 统计 tab 成就墙渲染
  await popup.evaluate(() => { window.ChatRightPanel?.activate("stats"); });
  await popup.waitForSelector(".ach-wall .ach-item", { timeout: 5000 });
  const gotN = await popup.locator(".ach-item.got").count();
  assert.ok(gotN >= 5, `成就墙应有 ≥5 个已解锁，实际 ${gotN}`);
  await popup.screenshot({ path: path.join(ARTIFACTS, "achievements.png") });
  log(`③ 成就墙渲染 ✓ ${gotN} 个已点亮`);

  console.log("[ach] ✅ 成就徽章验证通过");
} finally {
  await ctx.close();
}
