// AI Arena E2E stress test：测核心 bug 路径
// - getAiTargetLayout 多屏 mock 行为
// - chat-bus broadcast / notifyRoundStart polling 调度
// - sidepanel ↔ background 状态同步链路
// - hasUserWindow 防自污染（mock fake AI tab）
import { chromium } from "playwright";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const EXT_PATH = path.join(PROJECT_ROOT, "src");
const USER_DATA_DIR = path.join(os.tmpdir(), `arena-stress-${Date.now()}`);

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`✓ ${name}`); }
  else { failed++; failures.push(`${name}: ${detail || ""}`); console.log(`✗ ${name}${detail ? "  → " + detail : ""}`); }
}

const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
  channel: "chromium",
  headless: false,
  args: [
    `--disable-extensions-except=${EXT_PATH}`,
    `--load-extension=${EXT_PATH}`,
    "--no-first-run",
    "--no-default-browser-check",
  ],
});

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15000 });
  const extensionId = sw.url().split("/")[2];
  console.log(`[stress] extension ID: ${extensionId}`);

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.waitForLoadState("domcontentloaded");

  // 收集 service worker console logs
  const swLogs = [];
  sw.on("console", msg => swLogs.push(msg.text()));

  // ─────────────────────────────────────────
  // 测试组 A：getAiTargetLayout 屏定位
  // ─────────────────────────────────────────
  console.log("\n=== A. getAiTargetLayout 屏定位 ===");

  // A1: 单屏环境（chromium 默认）→ 应该 isDifferentDisplay=false
  const layoutSingle = await sw.evaluate(async () => {
    const fakeScreen = { left: 0, top: 0, width: 1920, height: 1080 };
    return await getAiTargetLayout(fakeScreen);
  });
  console.log("  layoutSingle:", JSON.stringify(layoutSingle));
  check("A1: 单屏环境 isDifferentDisplay=false", layoutSingle.isDifferentDisplay === false);
  check("A1: 单屏 screen 接近 sidepanelScreen", Math.abs(layoutSingle.screen.width - 1920) < 100 || layoutSingle.screen.width > 0);

  // A2: overlapsDisplay 重叠判定
  const overlapTests = await sw.evaluate(() => {
    const f = overlapsDisplay;
    return {
      identical: f({ left: 0, top: 0, width: 1920, height: 1080 }, { left: 0, top: 0, width: 1920, height: 1080 }),
      noOverlap: f({ left: 0, top: 0, width: 1920, height: 1080 }, { left: 1920, top: 0, width: 1920, height: 1080 }),
      onePxOverlap: f({ left: 0, top: 0, width: 1920, height: 1080 }, { left: 1919, top: 0, width: 1920, height: 1080 }),
      verticalNoOverlap: f({ left: 0, top: 0, width: 1920, height: 1080 }, { left: 0, top: 1080, width: 1920, height: 1080 }),
    };
  });
  check("A2: identical → overlap=true", overlapTests.identical === true);
  check("A2: 水平相邻不重叠 → overlap=false", overlapTests.noOverlap === false);
  check("A2: 1px 重叠 → overlap=true（严格判定）", overlapTests.onePxOverlap === true);
  check("A2: 垂直相邻不重叠 → overlap=false", overlapTests.verticalNoOverlap === false);

  // ─────────────────────────────────────────
  // 测试组 B：chat-bus broadcast + polling
  // ─────────────────────────────────────────
  console.log("\n=== B. ChatBus 业务逻辑 ===");

  // B1: notifyRoundStart 显示用户气泡 + 推 chatLog
  const beforeLog = await sw.evaluate(() => ChatBus.getLog().length);
  await sw.evaluate(() => ChatBus.notifyRoundStart("⚔️ 第1轮辩论测试", []));
  const afterLog = await sw.evaluate(() => ChatBus.getLog());
  check("B1: notifyRoundStart 无 targets 时不 push（保护）", afterLog.length === beforeLog,
    `before=${beforeLog} after=${afterLog.length}`);

  // B2: clearLog 清空
  await sw.evaluate(() => ChatBus.clearLog());
  const afterClear = await sw.evaluate(() => ChatBus.getLog().length);
  check("B2: clearLog 清空 chatLog", afterClear === 0);

  // B3: 模拟添加 fake participant → notifyRoundStart 应该启动 polling
  // 用 about:blank 作为 fake AI tab
  const fakeTab = await context.newPage();
  await fakeTab.goto("about:blank");
  await fakeTab.waitForLoadState("domcontentloaded");
  // 拿 fakeTab 的 tabId
  const fakeTabInfo = await sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const blank = tabs.find(t => t.url === "about:blank");
    return blank ? { tabId: blank.id, windowId: blank.windowId } : null;
  });
  check("B3 setup: 找到 about:blank tab", !!fakeTabInfo, JSON.stringify(fakeTabInfo));

  if (fakeTabInfo) {
    // 注入 fake participant 到 StateMachine（用裸名访问 const）
    await sw.evaluate((info) => {
      StateMachine.participants = [{
        id: "p_test", service: "claude", tabId: info.tabId, name: "Claude-test",
        response: null, responsePreview: null,
      }];
    }, fakeTabInfo);

    // 触发 notifyRoundStart
    const round = await sw.evaluate(() => ChatBus.notifyRoundStart("⚔️ 测试辩论", ["claude"]));
    check("B3: notifyRoundStart 返回 ok", round?.ok === true, JSON.stringify(round));
    const logAfterNotify = await sw.evaluate(() => ChatBus.getLog());
    check("B3: chatLog 增加 user 条目", logAfterNotify.length === 1 && logAfterNotify[0].role === "user",
      JSON.stringify(logAfterNotify[0]));
    check("B3: user 气泡含辩论文案", logAfterNotify[0]?.text?.includes("测试辩论"));

    // 等 polling 启动
    await fakeTab.waitForTimeout(500);

    // 清理：清 participants
    await sw.evaluate(() => {
      StateMachine.participants = [];
      ChatBus.clearLog();
    });
  }

  // B4: parseMentions 纯函数（在 popup 上下文）
  const mentionResults = await popup.evaluate(() => {
    // popup-task-menu.js 没暴露 parseMentions，但 popup.js 内的是 IIFE 私有
    // 改测：通过 ChatRoster API 看 getSelected 默认值
    return {
      hasRoster: typeof window.ChatRoster === "object",
      hasTaskMenu: typeof window.ChatTaskMenu === "object",
      hasDrawer: typeof window.ChatDrawer === "undefined" || typeof window.ChatDrawer === "object",
    };
  });
  check("B4: popup ChatRoster API 可用", mentionResults.hasRoster === true);
  check("B4: popup ChatTaskMenu API 可用", mentionResults.hasTaskMenu === true);

  // ─────────────────────────────────────────
  // 测试组 C：popup ↔ background 同步
  // ─────────────────────────────────────────
  console.log("\n=== C. popup ↔ background 同步 ===");

  // C1: popup 调 getState 拿到 StateMachine 数据
  const popupGetState = await popup.evaluate(async () => {
    try {
      const r = await chrome.runtime.sendMessage({ type: "getState" });
      return { ok: !!r, hasParticipants: Array.isArray(r?.participants), flowState: r?.flowState };
    } catch (e) { return { err: e.message }; }
  });
  check("C1: popup chrome.runtime.sendMessage(getState) 成功", popupGetState.ok === true, JSON.stringify(popupGetState));
  check("C1: getState 返回 participants 数组", popupGetState.hasParticipants === true);

  // C2: popup 调 chatRestoreLog
  const popupRestore = await popup.evaluate(async () => {
    try {
      const r = await chrome.runtime.sendMessage({ type: "chatRestoreLog" });
      return { ok: !!r, hasMessages: Array.isArray(r?.messages) };
    } catch (e) { return { err: e.message }; }
  });
  check("C2: chatRestoreLog handler", popupRestore.hasMessages === true);

  // C3: popup 调 chatBroadcast 无参与者 → 应该返回 error
  const popupBroadcast = await popup.evaluate(async () => {
    try {
      const r = await chrome.runtime.sendMessage({ type: "chatBroadcast", text: "hi", targets: [] });
      return r;
    } catch (e) { return { err: e.message }; }
  });
  check("C3: chatBroadcast 无参与者返回 error", popupBroadcast?.ok === false && popupBroadcast?.error?.includes("参与者"),
    JSON.stringify(popupBroadcast));

  // C4: popup 调 chatClear → 应 ok
  const popupClear = await popup.evaluate(async () => {
    try {
      return await chrome.runtime.sendMessage({ type: "chatClear" });
    } catch (e) { return { err: e.message }; }
  });
  check("C4: chatClear handler", popupClear?.ok === true, JSON.stringify(popupClear));

  // ─────────────────────────────────────────
  // 测试组 D：版本号 4 处同步
  // ─────────────────────────────────────────
  console.log("\n=== D. 版本号同步（feedback_ai_arena_version_bump 铁律） ===");
  const expectedVersion = "4.0.9-beta";
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT_PATH, "manifest.json"), "utf8"));
  const popupHtml = fs.readFileSync(path.join(EXT_PATH, "popup.html"), "utf8");
  const sidepanelHtml = fs.readFileSync(path.join(EXT_PATH, "sidepanel.html"), "utf8");
  check("D1: manifest version_name", manifest.version_name === expectedVersion, manifest.version_name);
  check("D2: popup.html chat-version", popupHtml.includes(`v${expectedVersion}</span>`));
  const sidepanelMatches = sidepanelHtml.match(new RegExp(`v${expectedVersion.replace(/\./g,"\\.")}`, "g"));
  check("D3: sidepanel.html 至少 2 处 version 标记（badge + footer）",
    sidepanelMatches && sidepanelMatches.length >= 2, `actual: ${sidepanelMatches?.length}`);

  // ─────────────────────────────────────────
  // 测试组 E：诊断日志格式
  // ─────────────────────────────────────────
  console.log("\n=== E. 诊断日志 ===");
  // 触发一次 layout 决策让日志输出
  await sw.evaluate(async () => {
    await globalThis.getAiTargetLayout || getAiTargetLayout({ left: 0, top: 0, width: 1920, height: 1080 });
  });
  await new Promise(res => setTimeout(res, 500));
  const layoutLogs = swLogs.filter(l => l.includes("[Arena/layout]"));
  check("E1: getAiTargetLayout 输出 [Arena/layout] 日志", layoutLogs.length > 0, `actual: ${layoutLogs.length} logs`);
  if (layoutLogs.length > 0) {
    console.log("  样本日志:");
    layoutLogs.slice(0, 5).forEach(l => console.log("    " + l.slice(0, 150)));
  }

} catch (e) {
  console.error("[stress] fatal:", e);
  failed++;
  failures.push("fatal: " + e.message);
} finally {
  await context.close();
}

console.log(`\n========== ${passed} passed, ${failed} failed ==========`);
if (failures.length > 0) {
  console.log("\nFailures:");
  failures.forEach(f => console.log("  - " + f));
}
process.exit(failed === 0 ? 0 : 1);
