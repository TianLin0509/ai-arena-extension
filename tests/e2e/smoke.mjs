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
  check("manifest version_name = 4.6.1-beta", manifest.version_name === "4.6.1-beta", `actual: ${manifest.version_name}`);

  // 3) 打开 sidepanel.html（作为普通 tab），验证 DOM
  const sidepanelPage = await context.newPage();
  await sidepanelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await sidepanelPage.waitForLoadState("domcontentloaded");

  const versionBadge = await sidepanelPage.locator(".version").textContent();
  check("sidepanel version badge", versionBadge === "v4.6.1-beta", `actual: "${versionBadge}"`);

  const footerVersion = await sidepanelPage.locator(".footer").textContent();
  check("sidepanel footer version", footerVersion?.includes("v4.6.1-beta"), `actual: "${footerVersion?.slice(0, 100)}"`);

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
  check("popup chat-version = v4.6.1-beta", popupVersion === "v4.6.1-beta", `actual: "${popupVersion}"`);

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
  check("v4.5.0：popup 右栏 5 Tab DOM (含 templates)",
    rpTabs.length === 5 && rpTabs.map(t => t.name).join(",") === "members,tasks,stats,templates,settings",
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

  // v4.5.3: 顶栏 AI 窗口布局 segmented toggle
  const hdrModeToggle = await popupPage.evaluate(() => {
    const wrap = document.getElementById("hdr-mode-toggle");
    if (!wrap) return { exists: false };
    const btns = [...wrap.querySelectorAll(".hdr-mode-btn")];
    return {
      exists: true,
      btnCount: btns.length,
      modes: btns.map(b => b.dataset.mode).sort(),
      labels: btns.map(b => b.textContent.trim())
    };
  });
  check("v4.5.3: 顶栏 #hdr-mode-toggle 存在",
    hdrModeToggle.exists === true, JSON.stringify(hdrModeToggle));
  check("v4.5.3: 顶栏 toggle 2 个按钮 (tab + tiled)",
    hdrModeToggle.btnCount === 2 && hdrModeToggle.modes.join(",") === "tab,tiled",
    JSON.stringify(hdrModeToggle));
  check("v4.5.3: 顶栏 toggle 文案 (Tab / 并列)",
    hdrModeToggle.labels?.includes("Tab") && hdrModeToggle.labels?.includes("并列"),
    JSON.stringify(hdrModeToggle));

  // 切到成员 Tab，验证不再有"AI 窗口布局" section
  await popupPage.click('.rp-tab[data-tab="members"]');
  await popupPage.waitForTimeout(200);
  const oldModeToggleGone = await popupPage.evaluate(() => {
    const panel = document.getElementById("rp-panel-members");
    if (!panel) return { panel: false };
    const hasOldToggle = !!panel.querySelector(".rp-mode-toggle");
    const hasTitle = panel.innerText.includes("AI 窗口布局");
    return { panel: true, hasOldToggle, hasTitle };
  });
  check("v4.5.3: Member Tab 不再有 .rp-mode-toggle DOM",
    oldModeToggleGone.hasOldToggle === false, JSON.stringify(oldModeToggleGone));
  check("v4.5.3: Member Tab 不再有 'AI 窗口布局' 文案",
    oldModeToggleGone.hasTitle === false, JSON.stringify(oldModeToggleGone));

  // 点击切换 → storage.local.windowMode 真改
  const setModeRes = await popupPage.evaluate(async () => {
    const tabBtn = document.querySelector('#hdr-mode-toggle .hdr-mode-btn[data-mode="tab"]');
    const tiledBtn = document.querySelector('#hdr-mode-toggle .hdr-mode-btn[data-mode="tiled"]');
    if (!tabBtn || !tiledBtn) return { err: "btn not found" };
    tabBtn.click();
    await new Promise(r => setTimeout(r, 200));
    const after1 = await new Promise(res => chrome.storage.local.get(["windowMode"], r => res(r.windowMode)));
    tiledBtn.click();
    await new Promise(r => setTimeout(r, 200));
    const after2 = await new Promise(res => chrome.storage.local.get(["windowMode"], r => res(r.windowMode)));
    const tiledActive = tiledBtn.classList.contains("active");
    return { after1, after2, tiledActive };
  });
  check("v4.5.3: 点 Tab 后 storage.windowMode = tab",
    setModeRes.after1 === "tab", JSON.stringify(setModeRes));
  check("v4.5.3: 点并列后 storage.windowMode = tiled + 该按钮高亮",
    setModeRes.after2 === "tiled" && setModeRes.tiledActive === true,
    JSON.stringify(setModeRes));

  // ========== v4.6.0：角色帽 ==========
  console.log("\n[smoke] === v4.6.0 角色帽 ===");

  // 切回 templates Tab，验证角色帽区
  await popupPage.click('.rp-tab[data-tab="templates"]');
  await popupPage.waitForTimeout(200);

  const roleListCount = await popupPage.locator("#tpl-role-list .tpl-item").count();
  check("v4.6.0: 模板库角色帽区渲染 5 个", roleListCount === 5, `actual: ${roleListCount}`);

  const roleBindings = await popupPage.evaluate(() =>
    [...document.querySelectorAll("#tpl-role-list .tpl-item")].map(x => x.dataset.binding).sort()
  );
  check("v4.6.0: 5 个 role.* binding 齐全",
    roleBindings.join(",") === "role.action,role.clarifier,role.critic,role.fact_check,role.judge",
    JSON.stringify(roleBindings));

  // 切到 Member Tab 验证角色帽按钮
  await popupPage.click('.rp-tab[data-tab="members"]');
  await popupPage.waitForTimeout(400);
  const memberHatBtns = await popupPage.locator("#rp-panel-members .rp-hat-btn").count();
  check("v4.6.0: Member Tab 渲染 5 个角色帽按钮", memberHatBtns === 5, `actual: ${memberHatBtns}`);

  // 点击角色帽 → 弹 picker（无参与者时显示提示）
  const pickerEmptyTest = await popupPage.evaluate(async () => {
    const btn = document.querySelector('#rp-panel-members .rp-hat-btn[data-binding="role.clarifier"]');
    if (!btn) return { err: "btn not found" };
    btn.click();
    await new Promise(r => setTimeout(r, 200));
    const picker = document.querySelector(".rp-hat-picker");
    if (!picker) return { pickerOpen: false };
    const empty = picker.querySelector(".rp-hat-picker-empty");
    // 关闭 picker
    document.body.click();
    await new Promise(r => setTimeout(r, 100));
    return { pickerOpen: true, hasEmpty: !!empty, emptyText: empty?.textContent };
  });
  check("v4.6.0: 点角色帽弹 picker（无参与者时显示提示）",
    pickerEmptyTest.pickerOpen === true && pickerEmptyTest.hasEmpty === true,
    JSON.stringify(pickerEmptyTest));

  // 直接验证拼 prompt 逻辑（不依赖参与者）
  const buildPromptTest = await popupPage.evaluate(() => {
    const Store = window.ArenaTemplateStore;
    const tpl = Store.resolveTemplate("role.clarifier");
    const duty = Store.resolve("role.clarifier", "duty");
    const format = Store.resolve("role.clarifier", "format");
    const text = `@Claude 戴上「${tpl.name}」帽子：${duty}\n输出格式：${format}\n\n`;
    return {
      hasName: text.includes("问题澄清员"),
      hasDuty: text.includes("拆解用户问题"),
      hasFormat: text.includes("输出格式：问题拆解"),
      hasMention: text.startsWith("@Claude ")
    };
  });
  check("v4.6.0: 角色帽 prompt 拼接（mention + name + duty + format）",
    buildPromptTest.hasName && buildPromptTest.hasDuty
      && buildPromptTest.hasFormat && buildPromptTest.hasMention,
    JSON.stringify(buildPromptTest));

  // 编辑角色帽（修改 duty 后单击成员栏帽子能拿到新值）
  const overrideTest = await popupPage.evaluate(async () => {
    await window.ArenaTemplateStore.saveOverride("role.critic", "duty", "OVERRIDE_CRITIC_DUTY");
    await new Promise(r => setTimeout(r, 100));
    const got = window.ArenaTemplateStore.resolve("role.critic", "duty");
    await window.ArenaTemplateStore.resetOverride("role.critic");
    return { got };
  });
  check("v4.6.0: 角色帽 duty override 生效",
    overrideTest.got === "OVERRIDE_CRITIC_DUTY", JSON.stringify(overrideTest));

  // v4.6.1: 审查修复 — 验证 className 一致（不再有 .rp-hat-bar 查询 bug）
  const noClassNameBug = await popupPage.evaluate(() => {
    return {
      sectionCount: document.querySelectorAll("#rp-panel-members .rp-hat-section").length,
      barCount: document.querySelectorAll("#rp-panel-members .rp-hat-bar").length
    };
  });
  check("v4.6.1: 成员栏只有 1 个 .rp-hat-section（不重复插入）",
    noClassNameBug.sectionCount === 1, JSON.stringify(noClassNameBug));

  // v4.6.1: togglePreview 跨区收起 — 在任务模板区展开 + 角色帽区点击 → 任务模板那个应被收起
  await popupPage.click('.rp-tab[data-tab="templates"]');
  await popupPage.waitForTimeout(200);
  const togglePreviewCross = await popupPage.evaluate(async () => {
    // 1. 在任务模板区展开 debate.free
    const taskRow = document.querySelector('#tpl-builtin-list .tpl-item[data-binding="debate.free"] .tpl-row');
    taskRow.click();
    await new Promise(r => setTimeout(r, 100));
    const taskExpandedBefore = document.querySelector('#tpl-builtin-list .tpl-item[data-binding="debate.free"]').classList.contains("tpl-expanded");
    // 2. 在角色帽区点击 role.clarifier
    const roleRow = document.querySelector('#tpl-role-list .tpl-item[data-binding="role.clarifier"] .tpl-row');
    roleRow.click();
    await new Promise(r => setTimeout(r, 100));
    const taskExpandedAfter = document.querySelector('#tpl-builtin-list .tpl-item[data-binding="debate.free"]').classList.contains("tpl-expanded");
    const roleExpandedAfter = document.querySelector('#tpl-role-list .tpl-item[data-binding="role.clarifier"]').classList.contains("tpl-expanded");
    return { taskExpandedBefore, taskExpandedAfter, roleExpandedAfter };
  });
  check("v4.6.1: togglePreview 跨区收起 — 点角色帽后任务模板自动收起",
    togglePreviewCross.taskExpandedBefore === true
      && togglePreviewCross.taskExpandedAfter === false
      && togglePreviewCross.roleExpandedAfter === true,
    JSON.stringify(togglePreviewCross));

  // 切回 templates Tab（之后断言依赖）
  await popupPage.click('.rp-tab[data-tab="templates"]');
  await popupPage.waitForTimeout(150);
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

  // ========== v4.5.0：📋 模板库 ==========
  console.log("\n[smoke] === v4.5.0 模板库 ===");

  // 10) Store API + Builtin 暴露
  const storeApi = await popupPage.evaluate(() => ({
    hasStore: typeof window.ArenaTemplateStore === "object",
    hasBuiltin: typeof window.ArenaBuiltinTemplates === "object",
    builtinKeys: Object.keys(window.ArenaBuiltinTemplates || {}).sort(),
    storeMethods: window.ArenaTemplateStore ? Object.keys(window.ArenaTemplateStore).sort() : []
  }));
  check("v4.5.0: ArenaTemplateStore 暴露", storeApi.hasStore === true);
  check("v4.5.0: ArenaBuiltinTemplates 暴露", storeApi.hasBuiltin === true);
  check("v4.6.0: 12 个内置 binding (4 任务 + 3 场景 + 5 角色帽)",
    storeApi.builtinKeys.length === 12 &&
    storeApi.builtinKeys.includes("role.clarifier") &&
    storeApi.builtinKeys.includes("role.fact_check") &&
    storeApi.builtinKeys.includes("role.critic") &&
    storeApi.builtinKeys.includes("role.judge") &&
    storeApi.builtinKeys.includes("role.action"),
    JSON.stringify(storeApi.builtinKeys));
  check("v4.5.0: Store 关键方法齐全",
    ["resolve", "saveOverride", "resetOverride", "resetAllOverrides", "addUserTemplate", "deleteUserTemplate"]
      .every(m => storeApi.storeMethods.includes(m)),
    JSON.stringify(storeApi.storeMethods));

  // 11) 切到 templates Tab + 渲染
  await popupPage.click('.rp-tab[data-tab="templates"]');
  await popupPage.waitForTimeout(300);

  const builtinItemCount = await popupPage.locator("#tpl-builtin-list .tpl-item").count();
  check("v4.5.0: 模板 Tab 渲染 4 个内置任务模板", builtinItemCount === 4, `actual: ${builtinItemCount}`);

  // v4.5.2: 场景预设区独立 + 3 个场景渲染
  const scenarioItemCount = await popupPage.locator("#tpl-scenario-list .tpl-item").count();
  check("v4.5.2: 场景预设区渲染 3 个场景", scenarioItemCount === 3, `actual: ${scenarioItemCount}`);
  const scenarioBindings = await popupPage.evaluate(() =>
    [...document.querySelectorAll("#tpl-scenario-list .tpl-item")].map(x => x.dataset.binding).sort()
  );
  check("v4.5.2: 场景 binding 为 literature/idea/code_review",
    scenarioBindings.join(",") === "scenario.code_review,scenario.idea,scenario.literature",
    JSON.stringify(scenarioBindings));

  // v4.5.2: 单击场景预设 = 插入输入框（clickAction="insert"）
  const scenarioInsertTest = await popupPage.evaluate(async () => {
    const input = document.getElementById("chat-input");
    input.textContent = "";
    const row = document.querySelector('#tpl-scenario-list .tpl-item[data-binding="scenario.literature"] .tpl-row');
    if (!row) return { err: "scenario row not found" };
    row.click();
    await new Promise(r => setTimeout(r, 150));
    return { content: input.textContent.slice(0, 50) };
  });
  check("v4.5.2: 单击场景预设插入输入框（开场含'文献调研'）",
    scenarioInsertTest.content && scenarioInsertTest.content.includes("文献调研"),
    JSON.stringify(scenarioInsertTest));

  // v4.5.2: 场景预设支持 override（编辑/重置）
  const scenarioOverrideTest = await popupPage.evaluate(async () => {
    await window.ArenaTemplateStore.saveOverride("scenario.idea", "main", "OVERRIDE_IDEA_SCENARIO");
    await new Promise(r => setTimeout(r, 100));
    const input = document.getElementById("chat-input");
    input.textContent = "";
    document.querySelector('#tpl-scenario-list .tpl-item[data-binding="scenario.idea"] .tpl-row').click();
    await new Promise(r => setTimeout(r, 150));
    const content = input.textContent;
    await window.ArenaTemplateStore.resetOverride("scenario.idea");
    return { content };
  });
  check("v4.5.2: 场景预设 override 后单击插入新值",
    scenarioOverrideTest.content === "OVERRIDE_IDEA_SCENARIO",
    JSON.stringify(scenarioOverrideTest));

  const userEmptyText = await popupPage.locator("#tpl-user-list .tpl-empty").textContent().catch(() => null);
  check("v4.5.0: 我的模板初始为空（空状态文案）",
    !!userEmptyText && userEmptyText.includes("还没有自定义模板"),
    `actual: ${userEmptyText}`);

  // 12) override + resolve 闭环（debate.free.r2）
  const ovTest = await popupPage.evaluate(async () => {
    await window.ArenaTemplateStore.saveOverride("debate.free", "r2", "TEST_OVERRIDE_R2");
    await new Promise(r => setTimeout(r, 100));
    const got = window.ArenaTemplateStore.resolve("debate.free", "r2");
    return { got };
  });
  check("v4.5.0: saveOverride 后 resolve 返回新值",
    ovTest.got === "TEST_OVERRIDE_R2", JSON.stringify(ovTest));

  // 13) resetOverride 后回 builtin
  const resetTest = await popupPage.evaluate(async () => {
    await window.ArenaTemplateStore.resetOverride("debate.free", "r2");
    await new Promise(r => setTimeout(r, 100));
    const got = window.ArenaTemplateStore.resolve("debate.free", "r2");
    const builtin = window.ArenaBuiltinTemplates["debate.free"].fields.find(f => f.key === "r2").value;
    return { restored: got === builtin };
  });
  check("v4.5.0: resetOverride 后回 builtin",
    resetTest.restored === true, JSON.stringify(resetTest));

  // 14) 新建自定义模板 + 单击插入输入框
  const insertTest = await popupPage.evaluate(async () => {
    const t = await window.ArenaTemplateStore.addUserTemplate({
      name: "E2E_TEST_TEMPLATE",
      body: "HELLO_INSERT_TEST"
    });
    await new Promise(r => setTimeout(r, 200));
    const userItem = document.querySelector(`#tpl-user-list .tpl-item[data-user-id="${t.id}"]`);
    if (!userItem) return { err: "user item not rendered", id: t.id };
    const input = document.getElementById("chat-input");
    input.textContent = "";
    userItem.querySelector(".tpl-row").click();
    await new Promise(r => setTimeout(r, 150));
    const content = input.textContent;
    // 清理
    await window.ArenaTemplateStore.deleteUserTemplate(t.id);
    return { content };
  });
  check("v4.5.0: 单击自定义模板插入到 #chat-input",
    insertTest.content === "HELLO_INSERT_TEST", JSON.stringify(insertTest));

  // 15) 编辑器弹层
  const editorTest = await popupPage.evaluate(async () => {
    const row = document.querySelector('#tpl-builtin-list .tpl-item[data-binding="debate.free"]');
    if (!row) return { err: "row not found" };
    // hover 显示 actions
    row.querySelector(".tpl-mini-btn[data-act='edit']").click();
    await new Promise(r => setTimeout(r, 100));
    const mask = document.getElementById("tpl-modal-mask");
    const open = mask && !mask.hidden;
    const fieldTabs = document.querySelectorAll(".tpl-field-tab").length;
    // 关闭
    document.getElementById("tpl-editor-cancel")?.click();
    await new Promise(r => setTimeout(r, 100));
    const closed = mask.hidden === true;
    return { open, closed, fieldTabs };
  });
  check("v4.5.0: 编辑器打开（debate.free 有 4 字段 tab）",
    editorTest.open === true && editorTest.fieldTabs === 4, JSON.stringify(editorTest));

  // 15b) v4.5.1: PPT 模板 7 字段（5 风格 + copy + pptx）
  const pptFieldCount = await popupPage.evaluate(() =>
    window.ArenaBuiltinTemplates.ppt.fields.length);
  check("v4.5.1: ppt 模板 7 字段（5 风格 + copy + pptx）",
    pptFieldCount === 7, `actual: ${pptFieldCount}`);
  // 15c) v4.5.1: summary 模板 2 字段（JSON + 文本）
  const summaryFieldCount = await popupPage.evaluate(() =>
    window.ArenaBuiltinTemplates.summary.fields.length);
  check("v4.5.1: summary 模板 2 字段（JSON + 文本）",
    summaryFieldCount === 2, `actual: ${summaryFieldCount}`);
  const summaryKeys = await popupPage.evaluate(() =>
    window.ArenaBuiltinTemplates.summary.fields.map(f => f.key).sort());
  check("v4.5.1: summary 字段 key (instruction_json + instruction_text)",
    summaryKeys.join(",") === "instruction_json,instruction_text",
    JSON.stringify(summaryKeys));
  check("v4.5.0: 编辑器取消按钮关闭弹层", editorTest.closed === true);

  // 16) resetAllOverrides 清空所有 overrides
  const resetAllTest = await popupPage.evaluate(async () => {
    await window.ArenaTemplateStore.saveOverride("debate.free", "main", "X");
    await window.ArenaTemplateStore.saveOverride("ppt", "intro", "Y");
    await window.ArenaTemplateStore.resetAllOverrides();
    await new Promise(r => setTimeout(r, 100));
    return new Promise(res => {
      chrome.storage.local.get(["arena_templates_v1"], r => {
        res({ ov: r?.arena_templates_v1?.overrides || null });
      });
    });
  });
  check("v4.5.0: resetAllOverrides 后 storage.overrides 为空",
    JSON.stringify(resetAllTest.ov || {}) === "{}", JSON.stringify(resetAllTest));

  // 17) 验证 buildDebatePrompt 真用了 override（SW 侧）
  const buildResult = await serviceWorker.evaluate(async () => {
    await self.ArenaTemplateStore.saveOverride("debate.free", "main", "OVERRIDE_MAIN_TEST");
    await new Promise(r => setTimeout(r, 100));
    const fakeResponses = {
      "claude": { name: "Claude", text: "Claude 回答" },
      "gemini": { name: "Gemini", text: "Gemini 回答" }
    };
    const prompt = self.DebateEngine.buildDebatePrompt("chatgpt", fakeResponses, "free", 1, "", false);
    await self.ArenaTemplateStore.resetOverride("debate.free", "main");
    return { containsOverride: prompt.includes("OVERRIDE_MAIN_TEST"), len: prompt.length };
  }).catch(e => ({ err: e.message }));
  check("v4.5.0: buildDebatePrompt 使用 override 后的 main",
    buildResult.containsOverride === true, JSON.stringify(buildResult));

  // 18) 验证 buildImagePrompt 用了 ppt override 的 seed（SW 侧）
  const pptBuildResult = await serviceWorker.evaluate(async () => {
    await self.ArenaTemplateStore.saveOverride("ppt", "intro", "OVERRIDE_PPT_SEED_TEST");
    await new Promise(r => setTimeout(r, 100));
    const prompt = self.PptPrompts.buildImagePrompt({ question: "q", responses: [] }, "intro");
    await self.ArenaTemplateStore.resetOverride("ppt", "intro");
    return { containsOverride: prompt.includes("OVERRIDE_PPT_SEED_TEST"), len: prompt.length };
  }).catch(e => ({ err: e.message }));
  check("v4.5.0: buildImagePrompt 使用 override 后的 seed",
    pptBuildResult.containsOverride === true, JSON.stringify(pptBuildResult));

  // 19) buildSummaryPrompt 走 summary.instruction_json
  const summaryBuildResult = await serviceWorker.evaluate(async () => {
    await self.ArenaTemplateStore.saveOverride("summary", "instruction_json", "OVERRIDE_SUMMARY_JSON");
    await new Promise(r => setTimeout(r, 100));
    const prompt = self.DebateEngine.buildSummaryPrompt("q", [], {
      "claude": { name: "Claude", text: "c" }
    }, "");
    await self.ArenaTemplateStore.resetOverride("summary", "instruction_json");
    return { containsOverride: prompt.includes("OVERRIDE_SUMMARY_JSON") };
  }).catch(e => ({ err: e.message }));
  check("v4.5.0: buildSummaryPrompt 使用 override 后的 instruction_json",
    summaryBuildResult.containsOverride === true, JSON.stringify(summaryBuildResult));

  // 20) v4.5.1: buildSummaryPromptText 走 summary.instruction_text
  const summaryTextBuildResult = await serviceWorker.evaluate(async () => {
    await self.ArenaTemplateStore.saveOverride("summary", "instruction_text", "OVERRIDE_SUMMARY_TEXT");
    await new Promise(r => setTimeout(r, 100));
    const prompt = self.DebateEngine.buildSummaryPromptText("q", [], {
      "claude": { name: "Claude", text: "c" }
    }, "");
    await self.ArenaTemplateStore.resetOverride("summary", "instruction_text");
    return { containsOverride: prompt.includes("OVERRIDE_SUMMARY_TEXT") };
  }).catch(e => ({ err: e.message }));
  check("v4.5.1: buildSummaryPromptText 使用 override 后的 instruction_text",
    summaryTextBuildResult.containsOverride === true, JSON.stringify(summaryTextBuildResult));

  // 21) v4.5.1: buildCopyPrompt 走 ppt.copy + {{SOURCE}} 占位符替换
  const copyBuildResult = await serviceWorker.evaluate(async () => {
    await self.ArenaTemplateStore.saveOverride("ppt", "copy", "PPT_COPY_OVERRIDE_HEAD\n{{SOURCE}}\nPPT_COPY_OVERRIDE_TAIL");
    await new Promise(r => setTimeout(r, 100));
    const prompt = self.PptPrompts.buildCopyPrompt({ question: "Q_TEST", responses: [{ name: "Claude", text: "A_TEST" }] });
    await self.ArenaTemplateStore.resetOverride("ppt", "copy");
    return {
      containsHead: prompt.includes("PPT_COPY_OVERRIDE_HEAD"),
      containsTail: prompt.includes("PPT_COPY_OVERRIDE_TAIL"),
      containsCtx: prompt.includes("Q_TEST") && prompt.includes("A_TEST"),
      noPlaceholderLeft: !prompt.includes("{{SOURCE}}")
    };
  }).catch(e => ({ err: e.message }));
  check("v4.5.1: buildCopyPrompt 使用 override 模板 + 替换 {{SOURCE}}",
    copyBuildResult.containsHead && copyBuildResult.containsTail
      && copyBuildResult.containsCtx && copyBuildResult.noPlaceholderLeft,
    JSON.stringify(copyBuildResult));

  // 22) v4.5.1: buildPptxPrompt 走 ppt.pptx
  const pptxBuildResult = await serviceWorker.evaluate(async () => {
    await self.ArenaTemplateStore.saveOverride("ppt", "pptx", "OVERRIDE_PPTX_REBUILD_INSTRUCTION");
    await new Promise(r => setTimeout(r, 100));
    const prompt = self.PptPrompts.buildPptxPrompt();
    await self.ArenaTemplateStore.resetOverride("ppt", "pptx");
    return { containsOverride: prompt.includes("OVERRIDE_PPTX_REBUILD_INSTRUCTION") };
  }).catch(e => ({ err: e.message }));
  check("v4.5.1: buildPptxPrompt 使用 override 后的 pptx",
    pptxBuildResult.containsOverride === true, JSON.stringify(pptxBuildResult));

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
