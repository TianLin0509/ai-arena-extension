// tests/e2e/compare-view-real.mjs — v5.0.33 回答 Side-by-Side 对比视图
// 注入两个带 response 的参与者，点顶栏「对比」→ 全屏 overlay 并排列显示各 AI 回答。
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const EXT_PATH = path.join(PROJECT_ROOT, "src");
const USER_DATA_DIR = process.env.E2E_PROFILE_DIR || path.join(__dirname, ".compare-profile");
if (!process.env.E2E_PROFILE_DIR && fs.existsSync(USER_DATA_DIR)) {
  try { fs.rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch (_) {}
}
const ARTIFACTS = path.join(PROJECT_ROOT, ".arena", "artifacts", "compare");
fs.mkdirSync(ARTIFACTS, { recursive: true });

const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
  channel: "chromium", headless: false,
  args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`,
    "--no-first-run", "--no-default-browser-check", "--disable-features=DisableLoadExtensionCommandLineSwitch"],
  viewport: { width: 1380, height: 900 },
});
function log(s) { console.log(`[compare] ${s}`); }

try {
  let extId = ""; { const [sw] = ctx.serviceWorkers(); if (sw) extId = new URL(sw.url()).host; }
  if (!extId) extId = "ndiclbhabflkigblghlapmookalgglic";
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: "domcontentloaded" });
  await popup.waitForTimeout(900);
  for (const p of ctx.pages()) { if (p.url().includes("welcome.html")) await p.close().catch(() => {}); }

  // ① 空状态：无回答时点对比 → 提示
  await popup.click("#btn-compare");
  await popup.waitForSelector(".cmp-overlay.show", { timeout: 5000 });
  const emptyTxt = await popup.locator(".cmp-empty").innerText();
  assert.ok(emptyTxt.includes("还没有 AI 回答"), `空状态提示: ${emptyTxt}`);
  await popup.click('.cmp-overlay [data-cmp="close"]');
  await popup.waitForTimeout(300);
  log("① 空状态提示 ✓");

  // 注入两个带 response 的参与者（直接进 background StateMachine 不现实，改用真实加 AI + 注入 response）
  // 真实加 deepseek + doubao，然后用 chatBroadcast 触发（游客可能拿不到真回答），故改为
  // 直接在 background 用 addParticipant 后，通过 setLastSent 无法塞 response；
  // 这里用最可靠方式：加两个 AI 占位，再手动注入 response 到 state（通过 getState 验证结构）。
  await popup.evaluate(() => new Promise(res => chrome.runtime.sendMessage({ type: "addParticipant", service: "deepseek" }, () => res())));
  await popup.waitForTimeout(3500);
  await popup.evaluate(() => new Promise(res => chrome.runtime.sendMessage({ type: "addParticipant", service: "doubao" }, () => res())));
  await popup.waitForTimeout(3500);
  // 用 chatStreamUpdate(isDone) 让 popup 气泡渲染 + background 落 response（broadcast 链路）
  const QUESTION = "对比测试：什么是张量？";
  await popup.evaluate((q) => new Promise(res => chrome.runtime.sendMessage({ type: "chatBroadcast", text: q, targets: ["deepseek", "doubao"] }, () => res())), QUESTION);
  await popup.waitForTimeout(4000);

  // ② 打开对比视图 — 至少应有原问题展示；若已抓到回答则有列
  await popup.click("#btn-compare");
  await popup.waitForSelector(".cmp-overlay.show", { timeout: 5000 });
  const hasCols = await popup.locator(".cmp-col").count();
  const hasEmpty = await popup.locator(".cmp-empty").count();
  // 游客态可能没真回答 → 允许空态；但若有回答则验证列结构
  if (hasCols > 0) {
    const names = await popup.locator(".cmp-col-name").allInnerTexts();
    log(`② 对比视图渲染 ✓ ${hasCols} 列: ${names.join(" | ")}`);
    const hasLen = await popup.locator(".cmp-col-len").count();
    assert.ok(hasLen === hasCols, "每列应有字数标注");
    const hasBar = await popup.locator(".cmp-col-bar span").count();
    assert.ok(hasBar === hasCols, "每列应有长度条");
  } else {
    assert.ok(hasEmpty > 0, "无真实回答时应显示空态（游客态可接受）");
    log("② 游客态无真实回答，显示空态（结构正确，列渲染逻辑已由代码保证）");
  }
  // ④ mock 注入 response 验证并排列渲染（游客态无真实回答，用 stub 确保列逻辑被真实验证）
  await popup.evaluate(() => window.ChatCompare.close());
  await popup.waitForTimeout(200);
  const colInfo = await popup.evaluate(async () => {
    const orig = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = (msg, cb) => {
      if (msg && msg.type === "getState") {
        cb({ participants: [
          { service: "deepseek", name: "DeepSeek", response: "张量是多维数组：标量0维、向量1维、矩阵2维。" },
          { service: "doubao", name: "豆包", response: "张量是高维矩阵，深度学习里组织数据的基本结构，比矩阵更通用一些。" },
        ], debateSession: { originalQuestion: "什么是张量？" } });
        return;
      }
      return orig(msg, cb);
    };
    await window.ChatCompare.open();
    chrome.runtime.sendMessage = orig;
    await new Promise(r => setTimeout(r, 300));
    return {
      cols: document.querySelectorAll(".cmp-col").length,
      names: [...document.querySelectorAll(".cmp-col-name")].map(e => e.textContent),
      bars: document.querySelectorAll(".cmp-col-bar span").length,
      hasQ: !!document.querySelector(".cmp-q"),
      bodyText: document.querySelector(".cmp-col-body")?.innerText || "",
    };
  });
  assert.equal(colInfo.cols, 2, `mock 应渲染 2 列，实际 ${colInfo.cols}`);
  assert.equal(colInfo.bars, 2, "每列应有长度条");
  assert.ok(colInfo.hasQ, "应显示原问题");
  assert.ok(colInfo.bodyText.includes("张量"), "列正文应渲染回答内容");
  log(`④ 列渲染验证(mock) ✓ ${colInfo.names.join(" | ")}`);
  await popup.screenshot({ path: path.join(ARTIFACTS, "compare-view.png") });

  // ⑤ ESC 关闭
  await popup.keyboard.press("Escape");
  await popup.waitForTimeout(400);
  const stillOpen = await popup.locator(".cmp-overlay.show").count();
  assert.equal(stillOpen, 0, "ESC 应关闭对比视图");
  log("③ ESC 关闭 ✓");

  console.log("[compare] ✅ 对比视图验证通过");
} finally {
  await ctx.close();
}
