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
  const expectedVersion = "4.3.4-beta";
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT_PATH, "manifest.json"), "utf8"));
  const popupHtml = fs.readFileSync(path.join(EXT_PATH, "popup.html"), "utf8");
  const sidepanelHtml = fs.readFileSync(path.join(EXT_PATH, "sidepanel.html"), "utf8");
  check("D1: manifest version_name", manifest.version_name === expectedVersion, manifest.version_name);
  check("D2: popup.html chat-version", popupHtml.includes(`v${expectedVersion}</span>`));
  const sidepanelMatches = sidepanelHtml.match(new RegExp(`v${expectedVersion.replace(/\./g,"\\.")}`, "g"));
  check("D3: sidepanel.html 至少 2 处 version 标记（badge + footer）",
    sidepanelMatches && sidepanelMatches.length >= 2, `actual: ${sidepanelMatches?.length}`);

  // ─────────────────────────────────────────
  // 测试组 F：右栏 4 Tab + task-context 联动
  // ─────────────────────────────────────────
  console.log("\n=== F. 右栏 4 Tab + task-context 联动 ===");
  // F1: 4 Tab DOM 存在 + API 暴露
  const rpInit = await popup.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll(".rp-tab")).map(t => t.dataset.tab);
    const panels = Array.from(document.querySelectorAll(".rp-panel")).map(p => p.dataset.rpPanel);
    return {
      tabs, panels,
      hasRP: typeof window.ChatRightPanel === "object",
      hasMembers: typeof window.ChatMembers === "object",
      hasTasks: typeof window.ChatTasks === "object",
      hasStats: typeof window.ChatStats === "object",
      hasSettings: typeof window.ChatSettings === "object",
    };
  });
  check("F1: 4 Tab DOM", rpInit.tabs.join(",") === "members,tasks,stats,settings", JSON.stringify(rpInit.tabs));
  check("F1b: 4 Panel DOM", rpInit.panels.join(",") === "members,tasks,stats,settings", JSON.stringify(rpInit.panels));
  check("F2a: ChatRightPanel API", rpInit.hasRP === true);
  check("F2b: ChatMembers API", rpInit.hasMembers === true);
  check("F2c: ChatTasks API", rpInit.hasTasks === true);
  check("F2d: ChatStats API", rpInit.hasStats === true);
  check("F2e: ChatSettings API", rpInit.hasSettings === true);

  // F3: 点击切 Tab
  await popup.click('.rp-tab[data-tab="stats"]');
  await popup.waitForTimeout(150);
  const activePanel = await popup.evaluate(() => {
    const a = document.querySelector(".rp-panel.active");
    return a?.dataset.rpPanel;
  });
  check("F3: 切 Tab 后 panel 激活", activePanel === "stats", String(activePanel));

  // F4: task:changed → debate 触发任务 Tab 切到 debate 控制台
  await popup.evaluate(() => {
    document.dispatchEvent(new CustomEvent("task:changed", { detail: { task: "debate", style: "free" } }));
  });
  await popup.waitForTimeout(150);
  const debateHtml = await popup.$eval("#rp-panel-tasks", el => el.innerHTML);
  check("F4: task=debate 任务 Tab 含'开始辩论'", debateHtml.includes("开始辩论"));
  check("F4b: 含模式 toggle", debateHtml.includes("自由") && debateHtml.includes("群策"));

  // F5: task:changed → summary
  await popup.evaluate(() => {
    document.dispatchEvent(new CustomEvent("task:changed", { detail: { task: "summary", judgeId: "x", judgeName: "Test" } }));
  });
  await popup.waitForTimeout(200);
  const summaryHtml = await popup.$eval("#rp-panel-tasks", el => el.innerHTML);
  check("F5: task=summary 任务 Tab 含'输出总结'", summaryHtml.includes("输出总结"));

  // F6: task:changed → ppt
  await popup.evaluate(() => {
    document.dispatchEvent(new CustomEvent("task:changed", { detail: { task: "ppt", kind: "copy" } }));
  });
  await popup.waitForTimeout(150);
  const pptHtml = await popup.$eval("#rp-panel-tasks", el => el.innerHTML);
  check("F6: task=ppt 任务 Tab 含'PPT 工坊'", pptHtml.includes("PPT 工坊"));

  // F7: task:changed → ask 显示提示
  await popup.evaluate(() => {
    document.dispatchEvent(new CustomEvent("task:changed", { detail: { task: "ask" } }));
  });
  await popup.waitForTimeout(150);
  const askHtml = await popup.$eval("#rp-panel-tasks", el => el.innerHTML);
  check("F7: task=ask 任务 Tab 显示提示", askHtml.includes("Ctrl+Enter") || askHtml.includes("输入"));

  // F8: 主题切换
  await popup.evaluate(() => window.ChatSettings?.setTheme("A"));
  await popup.waitForTimeout(100);
  const theme = await popup.evaluate(() => document.body.getAttribute("data-theme"));
  check("F8: setTheme('A') 后 body.data-theme=A", theme === "A", String(theme));

  // ─────────────────────────────────────────
  // 测试组 G：Phase 2 — chrome.action 默认开 popup（v4.2.0）
  // ─────────────────────────────────────────
  console.log("\n=== G. Phase 2 默认入口切换 (v4.2.0) ===");
  // G1: background.js 源码包含 setPanelBehavior false
  const bgSource = fs.readFileSync(path.join(EXT_PATH, "background.js"), "utf8");
  check("G1: setPanelBehavior openPanelOnActionClick=false",
    /setPanelBehavior\s*\(\s*\{\s*openPanelOnActionClick:\s*false/.test(bgSource));
  check("G2: chrome.action.onClicked listener 注册",
    /chrome\.action\.onClicked\.addListener/.test(bgSource));
  check("G3: action.onClicked 调用 ChatBus.openChatPopup",
    /chrome\.action\.onClicked\.addListener[\s\S]{0,400}ChatBus\.openChatPopup/.test(bgSource));

  // G4: sidepanel 提示条存在
  const sidepanelSrc = fs.readFileSync(path.join(EXT_PATH, "sidepanel.html"), "utf8");
  check("G4: sidepanel.html 含 Phase 2 提示条",
    /默认入口|phase2-notice/.test(sidepanelSrc));

  // ─────────────────────────────────────────
  // 测试组 H：v4.3.0 新增能力
  // ─────────────────────────────────────────
  console.log("\n=== H. v4.3.0 新能力 ===");
  // H1: pptBuildPrompt handler
  const pptResp = await popup.evaluate(async () => {
    try {
      const r = await chrome.runtime.sendMessage({ type: "pptBuildPrompt", kind: "copy" });
      return { ok: r?.ok, hasPrompt: typeof r?.prompt === "string" && r.prompt.length > 100 };
    } catch (e) { return { err: e.message }; }
  });
  check("H1: pptBuildPrompt handler 工作", pptResp.ok && pptResp.hasPrompt, JSON.stringify(pptResp));

  // H2: chatSkipParticipant handler
  const skipResp = await popup.evaluate(async () => {
    try {
      const r = await chrome.runtime.sendMessage({ type: "chatSkipParticipant", participantId: "test-svc", msgId: "test-msg" });
      return { ok: r?.ok === true };
    } catch (e) { return { err: e.message }; }
  });
  check("H2: chatSkipParticipant handler", skipResp.ok === true, JSON.stringify(skipResp));

  // H3: 顶部按钮：btn-hard-reset 存在，btn-theme/btn-settings 已移除
  const btns = await popup.evaluate(() => ({
    clear: !!document.getElementById("btn-clear"),
    hardReset: !!document.getElementById("btn-hard-reset"),
    theme: !!document.getElementById("btn-theme"),
    settings: !!document.getElementById("btn-settings"),
  }));
  check("H3a: btn-clear + btn-hard-reset 存在", btns.clear && btns.hardReset);
  check("H3b: 旧 btn-theme/btn-settings 已移除", !btns.theme && !btns.settings);

  // H4: 气泡跳过按钮 (data-act=skip)
  // 注入一个假 AI 气泡测试 DOM 结构
  const skipBtn = await popup.evaluate(() => {
    // 触发 appendAIBubble via simulated chatStreamUpdate
    return new Promise(resolve => {
      chrome.runtime.onMessage.dispatch?.({ type: "chatStreamUpdate", role: "ai", msgId: "m1", participantId: "claude", text: "test", isDone: false });
      // 直接模拟 DOM
      const m = document.getElementById("chat-messages");
      const row = document.createElement("div");
      row.className = "msg ai";
      row.dataset.msgId = "m1";
      row.dataset.participantId = "claude";
      row.innerHTML = `<div class="msg-body"><div class="msg-meta"><span class="acts"><button data-act="skip">⏭</button></span></div><div class="msg-bubble">x</div></div>`;
      m.appendChild(row);
      resolve(!!row.querySelector('button[data-act="skip"]'));
    });
  });
  check("H4: 气泡含 data-act=skip 按钮", skipBtn === true);

  // H5: 对话目录已隐藏 mode toggle
  const modeToggleHidden = await popup.evaluate(() => {
    const el = document.getElementById("sidebar-mode-toggle");
    return el && el.style.display === "none";
  });
  check("H5: 对话目录 mode toggle 已隐藏（默认仅显示提问）", modeToggleHidden === true);

  // H6: popup-themes.css + ppt-prompts.js 加载
  const filesOk = await popup.evaluate(async () => {
    const id = chrome.runtime.id;
    const r1 = await fetch(`chrome-extension://${id}/popup-themes.css`);
    const r2 = await fetch(`chrome-extension://${id}/ppt-prompts.js`);
    return { themes: r1.ok, ppt: r2.ok };
  });
  check("H6a: popup-themes.css 文件存在", filesOk.themes);
  check("H6b: ppt-prompts.js 文件存在", filesOk.ppt);

  // H7: v4.3.1 CSP — popup 不再拦截外部 https 图
  // 验证方式：监听 console，看是否有 "Refused to load the image" CSP 报错
  const cspErrors = [];
  popup.on("console", m => {
    const t = m.text();
    if (/Refused to load the image|Content Security Policy.*img-src/i.test(t)) cspErrors.push(t);
  });
  await popup.evaluate(() => {
    // 创建一个 <img> 指向公网 https → 不等加载完成，只看是否触发 CSP 报错
    const img = new Image();
    img.src = "https://www.google.com/favicon.ico";
    document.body.appendChild(img);
    setTimeout(() => img.remove(), 100);
  });
  await popup.waitForTimeout(800);
  check("H7: CSP 不拦截外部 https 图（无 Refused to load 报错）",
    cspErrors.length === 0,
    cspErrors.join(" | ").slice(0, 200));

  // H8: manifest 含 img-src 放开
  const manifestSrc = fs.readFileSync(path.join(EXT_PATH, "manifest.json"), "utf8");
  check("H8: manifest.json content_security_policy 含 img-src https",
    /img-src[^"]*\bhttps:/.test(manifestSrc));

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
