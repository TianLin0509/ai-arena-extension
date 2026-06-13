// tests/e2e/progressive-help-real.mjs — v5.0.26 四项萌新优化真实链路
// ① 渐进式披露：新用户 task 菜单进阶折叠 + 解锁行 → 点击展开
// ④ 下一步引导：首答（模拟 chatStreamUpdate）后浮出追问/辩论/裁判卡片 → 追问聚焦输入框
// ⑧ 欢迎页 SVG 动态演示存在
// ⑩ 帮助浮标 → 菜单 → 一键体检；体检全修按钮逻辑
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const EXT_PATH = path.join(PROJECT_ROOT, "src");
const USER_DATA_DIR = process.env.E2E_PROFILE_DIR || path.join(__dirname, ".prog-profile");
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
function log(s) { console.log(`[prog] ${s}`); }

try {
  let extId = ""; { const [sw] = ctx.serviceWorkers(); if (sw) extId = new URL(sw.url()).host; }
  if (!extId) extId = "ndiclbhabflkigblghlapmookalgglic";
  const POPUP = `chrome-extension://${extId}/popup.html`;

  let popup = await ctx.newPage();
  await popup.goto(POPUP, { waitUntil: "domcontentloaded" });
  await popup.waitForTimeout(1000);
  for (const p of ctx.pages()) { if (p.url().includes("welcome.html")) await p.close().catch(() => {}); }

  // ── ① 渐进式披露 ──
  const locked = await popup.evaluate(() => document.body.classList.contains("adv-locked"));
  assert.ok(locked, "全新用户应处于 adv-locked（进阶折叠）");
  await popup.click("#task-picker-btn");
  await popup.waitForSelector("#task-menu:not([hidden])", { timeout: 4000 });
  const advState = await popup.evaluate(() => {
    const adv = document.getElementById("task-adv");
    const unlock = document.querySelector(".task-adv-unlock");
    return { advVisible: !!adv.offsetParent, unlockVisible: !!unlock.offsetParent };
  });
  assert.equal(advState.advVisible, false, "进阶项应折叠隐藏");
  assert.equal(advState.unlockVisible, true, "解锁行应可见");
  await popup.screenshot({ path: path.join(ARTIFACTS, "progressive-locked.png") });
  // 点解锁行
  await popup.click(".task-adv-unlock");
  await popup.waitForTimeout(300);
  const afterUnlock = await popup.evaluate(() => ({
    locked: document.body.classList.contains("adv-locked"),
    advVisible: !!document.getElementById("task-adv").offsetParent,
  }));
  assert.equal(afterUnlock.locked, false, "解锁后 body 不应再 adv-locked");
  assert.equal(afterUnlock.advVisible, true, "解锁后进阶项应展开");
  log("① 渐进式披露 ✓ 折叠→点解锁→展开");
  await popup.keyboard.press("Escape").catch(() => {});

  // ── ⑧ 欢迎页 SVG 演示 ──
  const wc = await ctx.newPage();
  await wc.goto(`chrome-extension://${extId}/welcome.html`, { waitUntil: "domcontentloaded" });
  await wc.waitForSelector(".demo svg", { timeout: 4000 });
  const demo = await wc.evaluate(() => {
    const svg = document.querySelector(".demo svg");
    return { hasSvg: !!svg, animated: document.querySelectorAll(".d-q, .d-a1, .d-debate").length };
  });
  assert.ok(demo.hasSvg, "欢迎页应有演示 SVG");
  assert.ok(demo.animated >= 3, `应有动画元素，实际 ${demo.animated}`);
  await wc.screenshot({ path: path.join(ARTIFACTS, "welcome-demo.png") });
  await wc.close();
  log("⑧ 欢迎页 SVG 动态演示 ✓");

  // ── ⑩ 帮助浮标 → 体检 ──
  const hasFab = await popup.evaluate(() => !!document.getElementById("arena-help-fab"));
  assert.ok(hasFab, "应有帮助浮标");
  await popup.click("#arena-help-fab");
  await popup.waitForSelector("#arena-help-menu", { timeout: 4000 });
  const fabItems = await popup.locator("#arena-help-menu .hf-item").count();
  assert.ok(fabItems >= 4, `帮助菜单应有 ≥4 项，实际 ${fabItems}`);
  await popup.click('#arena-help-menu .hf-item[data-hf="doctor"]');
  await popup.waitForSelector(".doctor-modal.show", { timeout: 5000 });
  const docTitle = await popup.locator(".doctor-modal .arena-modal-title").innerText();
  assert.ok(docTitle.includes("还没有 AI"), `无成员体检提示: ${docTitle}`);
  await popup.screenshot({ path: path.join(ARTIFACTS, "help-fab-doctor.png") });
  await popup.click('.doctor-modal [data-role="cancel"]');
  log("⑩ 帮助浮标 → 一键体检 ✓");

  // 一键全修按钮逻辑：有成员时探测，制造红灯较难，这里验证"全绿无全修按钮、有可修红灯才出现"的逻辑
  // 用一个直接渲染校验：注入一个含红灯的假报告到 ChatDoctor 不暴露，故跳过深度闭环（如实记录）

  // ── ④ 下一步引导（首答后浮出）──
  // 前置：消除新手之旅卡片（设老用户），重开 popup
  await popup.evaluate(() => new Promise(res => chrome.storage.local.set({
    tutorialDismissed: true,
    onboardingFacts: { v: 1, skipped: true },
    nextStepHintShown: false,
  }, res)));
  await popup.close();
  popup = await ctx.newPage();
  await popup.goto(POPUP, { waitUntil: "domcontentloaded" });
  await popup.waitForTimeout(1000);
  // 确认无新手之旅卡片
  const obGone = await popup.evaluate(() => !document.getElementById("arena-onboarding"));
  assert.ok(obGone, "老用户不应有新手之旅卡片（否则会挡下一步引导）");
  // 从 sidepanel 页发 chatStreamUpdate（同页 sendMessage 自己收不到，故用另一扩展页广播）
  const broadcaster = await ctx.newPage();
  await broadcaster.goto(`chrome-extension://${extId}/sidepanel.html`, { waitUntil: "domcontentloaded" });
  await broadcaster.evaluate(() => new Promise(res => {
    chrome.runtime.sendMessage({
      type: "chatStreamUpdate", role: "ai", isDone: true,
      msgId: "t1", participantId: "deepseek", text: "这是一条测试回答",
    }, () => res());
  }));
  await popup.waitForSelector("#arena-nextstep.show", { timeout: 5000 });
  const nsBtns = await popup.locator("#arena-nextstep .ns-actions button").count();
  assert.equal(nsBtns, 3, `下一步应有 3 个选项，实际 ${nsBtns}`);
  await popup.screenshot({ path: path.join(ARTIFACTS, "nextstep-hint.png") });
  // 点"继续追问" → 输入框聚焦
  await popup.click('#arena-nextstep [data-ns="followup"]');
  await popup.waitForTimeout(400);
  const focused = await popup.evaluate(() => document.activeElement?.id === "chat-input");
  assert.ok(focused, "点继续追问应聚焦输入框");
  await broadcaster.close();
  log("④ 下一步引导 ✓ 首答浮出 + 追问聚焦");

  console.log("[prog] ✅ 全部通过（①渐进 ④下一步 ⑧演示 ⑩浮标）");
} finally {
  await ctx.close();
}
