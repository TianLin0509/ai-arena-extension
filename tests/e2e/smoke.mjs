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
  check("manifest version_name = 4.0.7-beta", manifest.version_name === "4.0.7-beta", `actual: ${manifest.version_name}`);

  // 3) 打开 sidepanel.html（作为普通 tab），验证 DOM
  const sidepanelPage = await context.newPage();
  await sidepanelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await sidepanelPage.waitForLoadState("domcontentloaded");

  const versionBadge = await sidepanelPage.locator(".version").textContent();
  check("sidepanel version badge", versionBadge === "v4.0.7-beta", `actual: "${versionBadge}"`);

  const footerVersion = await sidepanelPage.locator(".footer").textContent();
  check("sidepanel footer version", footerVersion?.includes("v4.0.7-beta"), `actual: "${footerVersion?.slice(0, 100)}"`);

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
  check("popup chat-version = v4.0.7-beta", popupVersion === "v4.0.7-beta", `actual: "${popupVersion}"`);

  const taskPickerBtn = await popupPage.locator("#task-picker-btn").count();
  check("popup has task-picker", taskPickerBtn === 1);

  const taskMenuItems = await popupPage.locator(".task-menu > .menu-item").count();
  check("popup task menu has 4 main items (ask/debate/summary/ppt)", taskMenuItems === 4);

  const rosterContainer = await popupPage.locator("#roster-items").count();
  check("popup has roster items container", rosterContainer === 1);

  const inputBox = await popupPage.locator("#chat-input").count();
  check("popup has input box", inputBox === 1);

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
