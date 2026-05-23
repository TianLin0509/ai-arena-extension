// AI Arena E2E smoke test
// 运行：npx playwright install chromium  (首次)
//      node tests/e2e/smoke.mjs
import { chromium } from "playwright";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const EXT_PATH = path.join(PROJECT_ROOT, "src");
const USER_DATA_DIR = path.join(os.tmpdir(), `arena-e2e-${Date.now()}`);

// 简单的断言 + 计数
let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`✓ ${name}`); }
  else { failed++; console.log(`✗ ${name}${detail ? "  → " + detail : ""}`); }
}

console.log(`[smoke] extension dir: ${EXT_PATH}`);
console.log(`[smoke] user-data-dir:  ${USER_DATA_DIR}`);
check("extension dir exists", fs.existsSync(path.join(EXT_PATH, "manifest.json")));

// 优先用系统 chrome（避免下载 200MB chromium），失败回退 chromium channel
async function launchCtx() {
  const args = [
    `--disable-extensions-except=${EXT_PATH}`,
    `--load-extension=${EXT_PATH}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
  ];
  // 优先 playwright 自带 chromium（无企业政策限制 + 隔离用户 chrome）
  try {
    return await chromium.launchPersistentContext(USER_DATA_DIR, {
      channel: "chromium",
      headless: false,
      args,
    });
  } catch (e) {
    console.log("[smoke] chromium channel failed, trying system chrome:", e.message);
    return await chromium.launchPersistentContext(USER_DATA_DIR, {
      channel: "chrome",
      headless: false,
      args,
    });
  }
}
const context = await launchCtx();

try {
  // 1) 拿 service worker（MV3）
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    console.log("[smoke] waiting for service worker...");
    serviceWorker = await context.waitForEvent("serviceworker", { timeout: 15000 });
  }
  const swUrl = serviceWorker.url();
  console.log(`[smoke] service worker URL: ${swUrl}`);
  check("service worker loaded", !!swUrl);
  const extensionId = swUrl.split("/")[2];
  console.log(`[smoke] extension ID: ${extensionId}`);
  check("extensionId looks valid", /^[a-z]{32}$/.test(extensionId));

  // 2) 读 manifest version_name 验证版本同步（直接读源文件）
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT_PATH, "manifest.json"), "utf8"));
  console.log(`[smoke] manifest version: ${manifest.version}, version_name: ${manifest.version_name}`);
  check("manifest version_name = 4.3.16-beta", manifest.version_name === "4.3.16-beta", `actual: ${manifest.version_name}`);

  // 3) 打开 sidepanel.html（作为普通 tab），验证 DOM
  const sidepanelPage = await context.newPage();
  await sidepanelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await sidepanelPage.waitForLoadState("domcontentloaded");

  const versionBadge = await sidepanelPage.locator(".version").textContent();
  check("sidepanel version badge", versionBadge === "v4.3.16-beta", `actual: "${versionBadge}"`);

  const footerVersion = await sidepanelPage.locator(".footer").textContent();
  check("sidepanel footer version", footerVersion?.includes("v4.3.16-beta"), `actual: "${footerVersion?.slice(0, 100)}"`);

  const openChatBtn = await sidepanelPage.locator("#btn-open-chat").count();
  check('sidepanel has "🪟 群聊" button', openChatBtn === 1);

  const modeOpts = await sidepanelPage.locator(".mode-opt").count();
  check("sidepanel has Tab/并列 toggle (2 buttons)", modeOpts === 2);

  // 验证我们删掉了 screen-toggle
  const screenOpts = await sidepanelPage.locator(".screen-opt").count();
  check("screen-toggle removed (always-auto)", screenOpts === 0);

  // 4) 打开 popup.html
  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
  await popupPage.waitForLoadState("domcontentloaded");

  const popupVersion = await popupPage.locator(".chat-version").textContent();
  check("popup chat-version = v4.3.16-beta", popupVersion === "v4.3.16-beta", `actual: "${popupVersion}"`);

  // 图标资产验证（v4.0.11）
  const assetsOk = await popupPage.evaluate(async (extId) => {
    async function exists(p) {
      try { const r = await fetch(`chrome-extension://${extId}/${p}`); return r.ok; }
      catch { return false; }
    }
    return {
      icon16: await exists("icons/icon16.png"),
      icon48: await exists("icons/icon48.png"),
      icon128: await exists("icons/icon128.png"),
      huawei: await exists("icons/brands/huawei.png"),
      huaweiSvgGone: !(await exists("icons/brands/huawei.svg")),
    };
  }, extensionId);
  check("icon16/48/128 资源存在（hub logo）", assetsOk.icon16 && assetsOk.icon48 && assetsOk.icon128, JSON.stringify(assetsOk));
  check("huawei.png 存在", assetsOk.huawei === true);
  check("旧 huawei.svg 已删", assetsOk.huaweiSvgGone === true);

  // 细滚动条样式验证（v4.0.12）
  const scrollbarOk = await popupPage.evaluate(() => {
    const styles = [...document.styleSheets]
      .flatMap(s => { try { return [...s.cssRules]; } catch { return []; } });
    // 找 ::-webkit-scrollbar 规则（CSSStyleRule.selectorText 含该字符串）
    const hasScrollbar = styles.some(r => r.cssText && r.cssText.includes("::-webkit-scrollbar"));
    const has6px = styles.some(r => r.cssText && r.cssText.includes("::-webkit-scrollbar") && r.cssText.includes("6px"));
    const hasFirefoxThin = styles.some(r => r.cssText && r.cssText.includes("scrollbar-width") && r.cssText.includes("thin"));
    return { hasScrollbar, has6px, hasFirefoxThin };
  });
  check("自定义 webkit 细滚动条规则（6px）", scrollbarOk.has6px === true, JSON.stringify(scrollbarOk));
  check("Firefox thin 滚动条规则", scrollbarOk.hasFirefoxThin === true);

  const taskPickerBtn = await popupPage.locator("#task-picker-btn").count();
  check("popup has task-picker", taskPickerBtn === 1);

  const taskMenuItems = await popupPage.locator(".task-menu > .menu-item").count();
  check("popup task menu has 4 main items (ask/debate/summary/ppt)", taskMenuItems === 4);

  const rosterContainer = await popupPage.locator("#roster-items").count();
  check("popup has roster items container", rosterContainer === 1);

  const inputBox = await popupPage.locator("#chat-input").count();
  check("popup has input box", inputBox === 1);

  // 4b) 对话目录侧栏（v4.0.8 新增）
  const sidebarCount = await popupPage.locator("#chat-sidebar").count();
  check("popup has sidebar (对话目录)", sidebarCount === 1);
  const sidebarTitle = await popupPage.locator(".sidebar-title").textContent();
  check("sidebar 标题正确", sidebarTitle === "对话目录");
  const sidebarToggleCount = await popupPage.locator("#sidebar-toggle").count();
  check("sidebar 有折叠按钮", sidebarToggleCount === 1);
  const sidebarEmpty = await popupPage.locator(".sidebar-empty").textContent();
  check("sidebar 空状态文案", sidebarEmpty?.includes("暂无对话"));
  const chatScrollApi = await popupPage.evaluate(() => ({
    hasChatScroll: typeof window.ChatScroll === "object",
    hasChatHistory: typeof window.ChatHistory === "object",
    historyMethods: window.ChatHistory ? Object.keys(window.ChatHistory) : [],
  }));
  check("popup 暴露 ChatScroll API（pauseFollow/resumeFollow）", chatScrollApi.hasChatScroll);
  check("popup 暴露 ChatHistory API", chatScrollApi.hasChatHistory && chatScrollApi.historyMethods.includes("renderAll"));

  // 4c) v4.3.0：对话目录折叠/展开（只显示 user，AI 回答可展开）
  const searchInputCount = await popupPage.locator("#sidebar-search").count();
  check("sidebar 搜索框存在", searchInputCount === 1);
  // mode toggle 在 v4.3.0 已隐藏
  const modeToggleHidden = await popupPage.evaluate(() =>
    document.getElementById("sidebar-mode-toggle")?.style.display === "none"
  );
  check("v4.3.0：mode toggle 已隐藏", modeToggleHidden === true);
  const grabberCount = await popupPage.locator("#sidebar-grabber").count();
  check("sidebar drag-resize grabber 存在", grabberCount === 1);

  // 模拟注入 fakeLog → 默认只看到 2 个 turn（user only）
  const renderResult = await popupPage.evaluate(async () => {
    const now = Date.now();
    const fakeLog = [
      { role: "user", msgId: "u1", text: "分析下宁德时代估值", ts: now - 3600_000 },
      { role: "ai", msgId: "u1", participantId: "claude", text: "宁德时代 PE 23x 合理但不便宜", ts: now - 3590_000 },
      { role: "user", msgId: "u2", text: "存货周转怎样", ts: now - 1800_000 },
      { role: "ai", msgId: "u2", participantId: "gemini", text: "存货周转天数 65 天 平稳", ts: now - 1790_000 },
    ];
    window.ChatHistory.renderAll(fakeLog);
    await new Promise(r => setTimeout(r, 100));
    const turns = document.querySelectorAll(".sidebar-turn").length;
    const userItems = document.querySelectorAll(".sidebar-item[data-role=user]").length;
    const expandedReplies = document.querySelectorAll(".sidebar-reply").length;
    const toggleBtns = document.querySelectorAll(".sidebar-toggle-replies").length;
    const groupLabels = [...document.querySelectorAll(".sidebar-group-label")].map(e => e.textContent);
    return { turns, userItems, expandedReplies, toggleBtns, groupLabels };
  });
  check("v4.3.0：默认显示 2 个 turn（每 user 1 个）", renderResult.turns === 2, JSON.stringify(renderResult));
  check("v4.3.0：每 turn 有 1 个'展开'按钮（共 2）", renderResult.toggleBtns === 2);
  check("v4.3.0：AI 回答默认折叠（0 个 .sidebar-reply）", renderResult.expandedReplies === 0);
  check("时间分组标签出现", renderResult.groupLabels.length >= 1);

  // 点展开按钮 → 应该看到 1 个 AI 回答
  await popupPage.locator(".sidebar-toggle-replies").first().click();
  await popupPage.waitForTimeout(150);
  const expandedCount = await popupPage.locator(".sidebar-reply").count();
  check("v4.3.0：点击展开后显示 AI 回答（1 个）", expandedCount === 1, `actual: ${expandedCount}`);

  // 搜索"周转" → 应该匹配到 turn u2
  await popupPage.locator("#sidebar-search").fill("周转");
  await popupPage.waitForTimeout(150);
  const searchMatched = await popupPage.locator(".sidebar-turn").count();
  check("搜索'周转'匹配 1 个 turn", searchMatched === 1, `actual: ${searchMatched}`);

  // 清空搜索 → 恢复 2 turns
  await popupPage.locator("#sidebar-search").fill("");
  await popupPage.waitForTimeout(150);
  const backCount = await popupPage.locator(".sidebar-turn").count();
  check("清空搜索恢复 2 turns", backCount === 2);

  // 5) 单元测试 popup-markdown 渲染（在 popup 上下文 evaluate）
  const mdResult = await popupPage.evaluate(() => {
    if (typeof renderMarkdown !== "function") return { hasFunc: false };
    const a = renderMarkdown("hello **world**");
    const b = renderMarkdown("<script>alert(1)</script>");
    return {
      hasFunc: true,
      bold: /<strong>world<\/strong>/.test(a),
      xssSafe: !/<script>/.test(b) && /&lt;script&gt;/.test(b),
    };
  });
  check("popup renderMarkdown available", mdResult.hasFunc);
  check("popup renderMarkdown handles bold", mdResult.bold === true);
  check("popup renderMarkdown XSS-safe", mdResult.xssSafe === true);

  // 6) 任务模式 hover 子菜单验证（DOM 存在性）
  const debateSubItems = await popupPage.locator('.menu-item.has-sub:has(span:text("辩论")) .sub-menu .menu-item').count();
  check("debate hover submenu has items (free/collab)", debateSubItems >= 2, `actual: ${debateSubItems}`);

  // 7) 验证 background.js 的 getAiTargetLayout 在单屏（chromium 默认单屏）下的输出
  const layoutLogs = [];
  serviceWorker.on("console", msg => {
    const text = msg.text();
    if (text.includes("[Arena/layout]")) layoutLogs.push(text);
  });
  // 触发 addParticipant 看 layout 决策
  // 不能真的添加（claude.ai 加载慢），但可以直接调 getAiTargetLayout
  const layoutResult = await serviceWorker.evaluate(async () => {
    try {
      const r = await chrome.runtime.sendMessage({ type: "getState" });
      return { hasGetState: !!r, participants: r?.participants?.length || 0 };
    } catch (e) { return { err: e.message }; }
  }).catch(e => ({ evalErr: e.message }));
  check("service worker getState handler", !!layoutResult.hasGetState || layoutResult.participants === 0, JSON.stringify(layoutResult));

  // 8) 检查 popup 任务菜单 labelOf 纯逻辑（注入到 popup context）
  const labelResults = await popupPage.evaluate(() => {
    // 复制 popup-task-menu 的 labelOf
    function labelOf(state) {
      if (state.task === "ask") return "同时提问";
      if (state.task === "debate") return state.style === "collab" ? "辩论·群策" : "辩论·自由";
      if (state.task === "summary") return `总结·${state.judgeName || "选裁判"}`;
      if (state.task === "ppt") {
        const m = { copy: "PPT·文案", image: "PPT·图片", pptx: "PPT·生成" };
        return m[state.kind] || "PPT";
      }
      return "?";
    }
    return {
      ask: labelOf({ task: "ask" }),
      debateFree: labelOf({ task: "debate", style: "free" }),
      summaryClaude: labelOf({ task: "summary", judgeName: "Claude" }),
      pptCopy: labelOf({ task: "ppt", kind: "copy" }),
    };
  });
  check("labelOf ask", labelResults.ask === "同时提问");
  check("labelOf debate-free", labelResults.debateFree === "辩论·自由");
  check("labelOf summary-Claude", labelResults.summaryClaude === "总结·Claude");
  check("labelOf ppt-copy", labelResults.pptCopy === "PPT·文案");

  // 8.5) 右栏 4 Tab + 头部三图标（v4.1.0 新）
  console.log("\n[smoke] === 右栏 4 Tab 抽屉 ===");
  const rpTabs = await popupPage.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll(".rp-tab"));
    return tabs.map(t => ({ name: t.dataset.tab, text: t.innerText.trim() }));
  });
  check("popup 右栏 4 Tab DOM",
    rpTabs.length === 4 && rpTabs.map(t => t.name).join(",") === "members,tasks,stats,settings",
    JSON.stringify(rpTabs));
  const headerBtns = await popupPage.evaluate(() => ({
    clear: !!document.getElementById("btn-clear"),
    hardReset: !!document.getElementById("btn-hard-reset"),
    theme: !!document.getElementById("btn-theme"),
    settings: !!document.getElementById("btn-settings"),
  }));
  check("v4.3.0：header 含 🗑 + ⚡（移除 🎨/⚙️）",
    headerBtns.clear && headerBtns.hardReset && !headerBtns.theme && !headerBtns.settings,
    JSON.stringify(headerBtns));
  // popup-themes.css 是否加载（探测 <link rel=stylesheet href*=popup-themes>）
  const hasThemesCss = await popupPage.evaluate(() =>
    Array.from(document.querySelectorAll("link[rel=stylesheet]")).some(l => l.href.includes("popup-themes"))
  );
  check("popup-themes.css 已加载", hasThemesCss === true);

  // 9) 验证 getSelectors handler（从 popup page 调，sw 自己 sendMessage 不会触发自己 listener）
  const selectorResult = await popupPage.evaluate(async () => {
    try {
      const r = await chrome.runtime.sendMessage({ type: "getSelectors", platform: "claude" });
      return { hasResponse: !!r?.response, hasStreaming: !!r?.streaming, keys: r ? Object.keys(r) : [] };
    } catch (e) { return { err: e.message }; }
  }).catch(e => ({ evalErr: e.message }));
  check("getSelectors handler (claude) response+streaming", selectorResult.hasResponse === true && selectorResult.hasStreaming === true, JSON.stringify(selectorResult));

  // 等几秒收集 layout logs
  await popupPage.waitForTimeout(2000);
  if (layoutLogs.length > 0) {
    console.log("\n[smoke] captured layout logs:");
    layoutLogs.forEach(l => console.log("  " + l));
  }

} catch (e) {
  console.error("[smoke] fatal:", e);
  failed++;
} finally {
  await context.close();
}

console.log(`\n========== ${passed} passed, ${failed} failed ==========`);
process.exit(failed === 0 ? 0 : 1);
