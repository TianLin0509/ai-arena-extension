// tests/e2e/onboarding-real.mjs — v5.0.22 萌新引导真实链路 E2E
// 覆盖：
//   1) 全新安装 → 新手之旅卡片步骤 1 可见，旧 5 页教程不再自动弹
//   2) 添加区按"国内直连/需国际网络"分组，国内组在前
//   3) 真实添加 DeepSeek → toast 提示 + 步骤推进 + 游客态登录探测 → 🔑去登录角标 → 点击激活 tab
//   4) facts 断点恢复：预置 addedFirst+loginOk → 重开 popup 直接步骤 3，示例问题一键填入输入框
//   5) 调试黄条安抚：Tab 模式下添加成员 → 一次性 modal 弹出 + storage 标记 + 不重复弹
//   6) 老用户豁免：tutorialDismissed=true → 零打扰（无卡片）
//   7) 设置 → 🔰 新手之旅 重开
// 用法：node tests/e2e/onboarding-real.mjs   （一次性干净 profile，全新安装无 SW 缓存）
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const EXT_PATH = path.join(PROJECT_ROOT, "src");
const USER_DATA_DIR = process.env.E2E_PROFILE_DIR || path.join(__dirname, ".onboarding-profile");
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

function log(s) { console.log(`[ob-e2e] ${s}`); }

try {
  let extId = process.env.ARENA_EXT_ID || "";
  {
    const [sw] = ctx.serviceWorkers();
    if (sw) extId = new URL(sw.url()).host;
  }
  if (!extId) extId = "ndiclbhabflkigblghlapmookalgglic";
  log(`ext=${extId}`);
  const POPUP_URL = `chrome-extension://${extId}/popup.html`;

  const openPopup = async () => {
    const p = await ctx.newPage();
    await p.goto(POPUP_URL, { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(900);
    return p;
  };
  const getStorage = (p, keys) => p.evaluate(
    (ks) => new Promise(res => chrome.storage.local.get(ks, res)), keys);
  const setStorage = (p, obj) => p.evaluate(
    (o) => new Promise(res => chrome.storage.local.set(o, res)), obj);
  const clearParticipants = async (p) => {
    await p.evaluate(() => new Promise(res => chrome.runtime.sendMessage({ type: "hardReset" }, () => res())));
    await p.waitForTimeout(400);
  };

  // ── 场景 1：全新安装首启 ──
  let popup = await openPopup();
  await popup.waitForSelector("#arena-onboarding", { timeout: 8000 });
  const step1Txt = await popup.locator("#arena-onboarding .ob-step.ob-now").innerText();
  assert.ok(step1Txt.includes("添加第一个 AI"), `首启应在步骤 1，实际: ${step1Txt}`);
  const tutorialVisible = await popup.evaluate(() => {
    const el = document.getElementById("es-tutorial");
    return el ? !el.hidden : false;
  });
  assert.equal(tutorialVisible, false, "旧 5 页教程不应再自动弹出");
  log("场景 1 ✓ 首启步骤 1 + 教程不自动弹");

  // ── 场景 2：添加区分组 ──
  const groups = await popup.evaluate(() => {
    const lbls = [...document.querySelectorAll(".rp-add-group-lbl")].map(e => e.textContent.trim());
    const order = [...document.querySelectorAll(".rp-add-btn")].map(b => b.dataset.service);
    return { lbls, order };
  });
  assert.equal(groups.lbls.length, 2, "应有两个分组标签");
  assert.ok(groups.lbls[0].includes("国内直连"), `第一组应是国内直连: ${groups.lbls[0]}`);
  assert.ok(groups.lbls[1].includes("国际网络"), `第二组应是国际网络: ${groups.lbls[1]}`);
  assert.ok(groups.order.indexOf("deepseek") < groups.order.indexOf("claude"), "deepseek 应排在 claude 前");
  log(`场景 2 ✓ 分组 ${JSON.stringify(groups.lbls)}`);

  // ── 场景 3：真实添加 DeepSeek（游客态 → 登录探测红灯 → 去登录） ──
  await popup.click('.rp-add-btn[data-service="deepseek"]');
  // toast 可见
  await popup.waitForSelector(".arena-toast", { timeout: 5000 });
  const toastTxt = await popup.locator(".arena-toast").first().innerText();
  assert.ok(toastTxt.includes("已在后台打开"), `添加 toast 文案: ${toastTxt}`);
  // 步骤推进到 2
  await popup.waitForFunction(() => {
    const now = document.querySelector("#arena-onboarding .ob-step.ob-now");
    return now && now.textContent.includes("登录 AI 网页");
  }, { timeout: 10000 });
  log("场景 3a ✓ 添加后 toast + 步骤 2");
  // 登录探测（3.5s 后跑，游客态 deepseek 应判未登录）→ 成员卡 🔑 角标
  await popup.waitForSelector(".hero-slot-login", { timeout: 20000 });
  // 新手之旅 hint 同步给出"去登录页"按钮
  await popup.waitForFunction(() => {
    const btn = document.querySelector("#arena-onboarding .ob-action");
    return btn && btn.textContent.includes("去登录");
  }, { timeout: 8000 });
  await popup.screenshot({ path: path.join(ARTIFACTS, "step2-login-required.png") });
  // 点角标 → deepseek tab 被激活
  await popup.click(".hero-slot-login", { force: true });  // 角标带入场动画，force 跳过 stable 判定
  await popup.waitForTimeout(1200);
  const dsActive = ctx.pages().some(pg => pg.url().includes("chat.deepseek.com"));
  assert.ok(dsActive, "deepseek 页应已打开");
  log("场景 3b ✓ 登录红灯角标 + 去登录可点");

  // ── 场景 5：调试黄条安抚（Tab 模式）──
  await clearParticipants(popup);
  await setStorage(popup, { windowMode: "tab" });
  await popup.evaluate(() => new Promise(res => chrome.runtime.sendMessage({ type: "setWindowMode", mode: "tab" }, () => res())));
  await popup.waitForTimeout(300);
  await popup.evaluate(() => { window.ChatRightPanel?.activate("members"); });
  await popup.waitForTimeout(300);
  await popup.click('.rp-add-btn[data-service="deepseek"]');
  await popup.waitForSelector(".arena-modal-overlay.show", { timeout: 8000 });
  const modalTitle = await popup.locator(".arena-modal-title").innerText();
  assert.ok(modalTitle.includes("黄色提示"), `黄条安抚 modal 标题: ${modalTitle}`);
  await popup.screenshot({ path: path.join(ARTIFACTS, "debugger-notice.png") });
  await popup.click(".arena-modal-btn.primary");
  const flag = await getStorage(popup, ["debuggerNoticeShown"]);
  assert.equal(flag.debuggerNoticeShown, true, "storage 应记录已弹过");
  // 再添加一个成员 → 不应再弹
  await popup.click('.rp-add-btn[data-service="kimi"]');
  await popup.waitForTimeout(2500);
  const modalAgain = await popup.locator(".arena-modal-overlay.show").count();
  assert.equal(modalAgain, 0, "黄条安抚只弹一次");
  log("场景 5 ✓ 黄条安抚一次性 modal");

  // ── 场景 4：facts 断点恢复 → 步骤 3 示例问题填入 ──
  await clearParticipants(popup);
  await popup.close();
  // 审查修复：旧 popup 内可能有未触发的 loginFallback 定时器（45s）+ persist 防抖，
  //   它们落盘会覆盖这里预置的 facts → 改在无 onboarding 模块的 sidepanel 页写 storage
  {
    const util = await ctx.newPage();
    await util.goto(`chrome-extension://${extId}/sidepanel.html`, { waitUntil: "domcontentloaded" });
    await setStorage(util, {
      windowMode: "tiled",
      onboardingFacts: { v: 1, addedFirst: true, loginOk: true, firstAnswerDone: false, addedSecond: false, skipped: false },
    });
    await util.close();
  }
  popup = await openPopup();
  await popup.waitForFunction(() => {
    const now = document.querySelector("#arena-onboarding .ob-step.ob-now");
    return now && now.textContent.includes("问出第一个问题");
  }, { timeout: 8000 });
  await popup.click("#arena-onboarding .ob-action.wide");
  const inputTxt = await popup.locator("#chat-input").innerText();
  assert.ok(inputTxt.includes("5000 元预算买手机"), `示例问题应已填入输入框: ${inputTxt}`);
  await popup.screenshot({ path: path.join(ARTIFACTS, "step3-example-filled.png") });
  log("场景 4 ✓ 断点恢复步骤 3 + 示例一键填入");

  // ── 场景 6：老用户豁免 ──
  await popup.evaluate(() => new Promise(res => chrome.storage.local.remove(["onboardingFacts"], res)));
  await setStorage(popup, { tutorialDismissed: true });
  await popup.close();
  popup = await openPopup();
  await popup.waitForTimeout(1500);
  assert.equal(await popup.locator("#arena-onboarding").count(), 0, "老用户（tutorialDismissed）不应看到新手之旅");
  const exempt = await getStorage(popup, ["onboardingFacts"]);
  assert.equal(exempt.onboardingFacts?.skipped, true, "豁免应落 skipped 标记");
  log("场景 6 ✓ 老用户零打扰");

  // ── 场景 7：设置里重开新手之旅 ──
  await popup.evaluate(() => { window.ChatRightPanel?.activate("settings"); });
  await popup.waitForTimeout(400);
  await popup.click("#rp-restart-onboarding");
  await popup.waitForSelector("#arena-onboarding", { timeout: 5000 });
  const restartStep = await popup.locator("#arena-onboarding .ob-step.ob-now").innerText();
  assert.ok(restartStep.includes("添加第一个 AI"), "重开应回到步骤 1");
  log("场景 7 ✓ 设置重开新手之旅");

  console.log("[ob-e2e] ✅ 全部 7 场景通过");
} finally {
  await ctx.close();
}
