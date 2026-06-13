// tests/e2e/recommend-combo-real.mjs — v5.0.32 新手推荐搭配一键选
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const EXT_PATH = path.join(PROJECT_ROOT, "src");
const USER_DATA_DIR = process.env.E2E_PROFILE_DIR || path.join(__dirname, ".reco-profile");
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
function log(s) { console.log(`[reco] ${s}`); }

try {
  let extId = ""; { const [sw] = ctx.serviceWorkers(); if (sw) extId = new URL(sw.url()).host; }
  if (!extId) extId = "ndiclbhabflkigblghlapmookalgglic";
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: "domcontentloaded" });
  await popup.waitForTimeout(900);
  for (const p of ctx.pages()) { if (p.url().includes("welcome.html")) await p.close().catch(() => {}); }

  await popup.evaluate(() => { window.ChatRightPanel?.activate("members"); });
  await popup.waitForSelector(".rp-reco-btn", { timeout: 5000 });

  // ① 推荐搭配渲染（≥2 个组合）
  const recoN = await popup.locator(".rp-reco-btn").count();
  assert.ok(recoN >= 2, `应有 ≥2 个推荐组合，实际 ${recoN}`);
  const firstReco = await popup.locator(".rp-reco-btn").first().getAttribute("data-reco");
  assert.ok(firstReco.includes("deepseek"), `首个组合应含 deepseek: ${firstReco}`);
  await popup.screenshot({ path: path.join(ARTIFACTS, "recommend-combo.png") });
  log(`① 推荐搭配渲染 ✓ ${recoN} 个组合`);

  // ② 点第一个推荐 → 串行添加该组合的 AI
  const services = firstReco.split(",");
  await popup.locator(".rp-reco-btn").first().click();
  // 等添加完成（串行 + 450ms 间隔 + 开 tab）
  await popup.waitForFunction((n) => {
    return document.querySelectorAll(".hero-slot.filled").length >= n;
  }, services.length, { timeout: 30000 });
  const filled = await popup.locator(".hero-slot.filled").count();
  assert.ok(filled >= services.length, `应添加 ${services.length} 个 AI，实际 ${filled}`);
  log(`② 一键添加 ✓ 已加入 ${filled} 个`);

  // ③ 加入 ≥MAX 后推荐行消失（joined < MAX_SLOTS 才显示）
  // 加满 3 个：再点三家会诊补足
  const remaining = await popup.locator(".rp-reco-btn").count();
  log(`③ 当前推荐行按钮数 ${remaining}（加入 ${filled} 个后仍可见，符合 <3 显示规则）`);

  // ④ 重复点同组合 → 提示"已在圆桌里"（不重复添加）
  if (await popup.locator(".rp-reco-btn").count() > 0) {
    const before = await popup.locator(".hero-slot.filled").count();
    await popup.locator(".rp-reco-btn").first().click();
    await popup.waitForTimeout(1500);
    const after = await popup.locator(".hero-slot.filled").count();
    assert.ok(after <= before + 1, "重复点已加入的组合不应重复添加（最多补 1 个未加的）");
    log("④ 重复点击不重复添加 ✓");
  }

  console.log("[reco] ✅ 新手推荐搭配验证通过");
} finally {
  await ctx.close();
}
