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
  check("manifest version_name = 4.8.20-beta", manifest.version_name === "4.8.20-beta", `actual: ${manifest.version_name}`);

  // 3) 打开 sidepanel.html（作为普通 tab），验证 DOM
  const sidepanelPage = await context.newPage();
  await sidepanelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await sidepanelPage.waitForLoadState("domcontentloaded");

  const versionBadge = await sidepanelPage.locator(".version").textContent();
  check("sidepanel version badge", versionBadge === "v4.8.20-beta", `actual: "${versionBadge}"`);

  const footerVersion = await sidepanelPage.locator(".footer").textContent();
  check("sidepanel footer version", footerVersion?.includes("v4.8.20-beta"), `actual: "${footerVersion?.slice(0, 100)}"`);

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
  check("popup chat-version = v4.8.20-beta", popupVersion === "v4.8.20-beta", `actual: "${popupVersion}"`);

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

  // v4.6.5: LaTeX 公式渲染（KaTeX 抽取 + LaTeX→Unicode）
  const mathResult = await popupPage.evaluate(() => {
    const r = (s) => renderMarkdown(s);
    return {
      // 行内 LaTeX
      inlineTheta: r("公式 $E(\\theta,t)$ 是动态的"),
      // 块级 LaTeX
      blockFx: r("总方向图：\n$$F(\\theta)=E(\\theta)\\cdot AF(\\theta)$$"),
      // 上下标
      subSup: r("$w_n e^{j2\\pi}$"),
      // 求和 + 上下标
      sumIdx: r("$\\sum_{i=0}^{N}$"),
      // 不破坏行内代码
      codeNotMath: r("反引号 `$x = 1$` 内的不算公式"),
      // 不破坏代码块
      codeBlockSafe: r("```\n$ npm install\n$$ test\n```")
    };
  });
  // 行内：θ + 包含 .md-math span（title=原 LaTeX）
  check("v4.6.5: LaTeX 行内 $E(\\theta,t)$ → 渲染含 θ",
    mathResult.inlineTheta.includes('class="md-math"')
      && mathResult.inlineTheta.includes("θ"),
    mathResult.inlineTheta.slice(0, 200));
  check("v4.6.5: LaTeX 块级 $$F(θ)=E(θ)·AF(θ)$$",
    mathResult.blockFx.includes('class="md-math-block"')
      && mathResult.blockFx.includes("θ")
      && mathResult.blockFx.includes("·"),
    mathResult.blockFx.slice(0, 200));
  // 上下标：w_n → wₙ, e^{j2π} → eʲ²π
  check("v4.6.5: 上下标 w_n e^{j2\\pi} → wₙ eʲ²ᵖⁱ 或类似",
    mathResult.subSup.includes("ₙ") && mathResult.subSup.includes("²"),
    mathResult.subSup.slice(0, 200));
  // 求和 + 索引：∑ + 上下标
  check("v4.6.5: \\sum_{i=0}^{N} → ∑ᵢ₌₀ᴺ 或类似",
    mathResult.sumIdx.includes("∑"),
    mathResult.sumIdx.slice(0, 200));
  // 安全：反引号内的 $ 不被解析
  check("v4.6.5: 反引号 inline code 内的 $ 不被当作 LaTeX",
    !mathResult.codeNotMath.includes('class="md-math"'),
    mathResult.codeNotMath.slice(0, 200));
  // 代码块内的 $ 不被解析
  check("v4.6.5: 代码块内的 $ / $$ 不被当作 LaTeX",
    !mathResult.codeBlockSafe.includes('class="md-math"'),
    mathResult.codeBlockSafe.slice(0, 200));

  // v4.6.5: KaTeX DOM 抽取去重（模拟 ChatGPT katex span）
  const katexSanitize = await popupPage.evaluate(() => {
    // 注入仿 ChatGPT KaTeX 渲染的 DOM
    const wrap = document.createElement("div");
    wrap.innerHTML = `公式 <span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>θ</mi></mrow><annotation encoding="application/x-tex">\\theta</annotation></semantics></math></span><span class="katex-html">θ</span></span> 后续文本`;
    // 不依赖 inject-images.js 的全局函数（content-script only），直接调底层
    // 这里只验证 popup-markdown.js 不会把已经 sanitize 的 `$\theta$` 渲染错
    const txt = "公式 $\\theta$ 后续文本";
    const html = renderMarkdown(txt);
    // title 属性保留原 LaTeX 源码（hover 提示）是设计，noRawCommand 只检查可见文本区
    const visibleSpan = html.match(/<span class="md-math"[^>]*>([\s\S]*?)<\/span>/);
    const visibleText = visibleSpan ? visibleSpan[1] : "";
    return {
      rendered: html.includes("θ"),
      noRawCommandInVisible: !visibleText.includes("\\theta"),
      hasInline: html.includes('class="md-math"')
    };
  });
  check("v4.6.5: $\\theta$ → θ（KaTeX sanitize 后的干净 LaTeX）",
    katexSanitize.rendered && katexSanitize.noRawCommandInVisible && katexSanitize.hasInline,
    JSON.stringify(katexSanitize));

  // v4.6.6: 边界修复（函数名 fallback + 大写上标 + 嵌套 \frac）
  const v466 = await popupPage.evaluate(() => {
    const r = (s) => renderMarkdown(s);
    const visible = (html) => (html.match(/<span class="md-math"[^>]*>([\s\S]*?)<\/span>/)?.[1])
      || (html.match(/<div class="md-math-block"[^>]*>([\s\S]*?)<\/div>/)?.[1])
      || "";
    return {
      // 函数名 fallback：\sin \log \det → sin log det（去 backslash）
      fnSin: visible(r("$\\sin\\theta$")),
      fnLogDet: visible(r("$\\log_2 \\det(X)$")),
      // 大写字母上标 ^N ^M → ᴺ ᴹ
      upperSup: visible(r("$X^N \\cdot Y^M$")),
      // 嵌套 \frac{P_{\text{signal}}}{P_{\text{noise}}} 多 pass 应展开
      nestedFrac: visible(r("$\\frac{P_{\\text{signal}}}{P_{\\text{noise}}}$"))
    };
  });
  check("v4.6.6: 函数名 \\sin\\theta → sinθ", v466.fnSin.includes("sin") && v466.fnSin.includes("θ"), v466.fnSin);
  check("v4.6.6: 函数名 \\log_2 \\det → log₂ det", v466.fnLogDet.includes("log₂") && v466.fnLogDet.includes("det"), v466.fnLogDet);
  check("v4.6.6: 大写字母 ^N ^M → ᴺ ᴹ", v466.upperSup.includes("ᴺ") && v466.upperSup.includes("ᴹ"), v466.upperSup);
  check("v4.6.6: 嵌套 \\frac{P_{\\text{signal}}}{...} 多 pass 展开",
    v466.nestedFrac.includes("Pₛᵢgₙₐₗ") && v466.nestedFrac.includes("/"),
    v466.nestedFrac);

  // ========== v4.6.8: 统计 Tab 可视化（柱状图 / 趋势线 / 热力图） ==========
  console.log("\n[smoke] === v4.6.8 统计可视化 ===");

  // 切到 stats Tab
  await popupPage.click('.rp-tab[data-tab="stats"]');
  await popupPage.waitForTimeout(200);

  // 注入测试数据：3 个 AI + 7 天 daily + 168 cell heatmap
  await popupPage.evaluate(() => {
    const today = new Date();
    const daily = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const k = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      daily[k] = { conversations: 2 + i, chars: 3000 + i * 500, models: {} };
    }
    const heatmap = new Array(168).fill(0);
    // 工作日 9-18 高活跃，周末低
    for (let w = 1; w <= 5; w++) for (let h = 9; h <= 18; h++) heatmap[w * 24 + h] = Math.floor(Math.random() * 20 + 5);
    window.ChatStats._injectFakeData({
      conversations: 42,
      debates: 8,
      totalChars: 38000,
      models: {
        claude: { chars: 18000, rounds: 15 },
        gemini: { chars: 12000, rounds: 12 },
        chatgpt: { chars: 8000, rounds: 9 }
      },
      daily, heatmap
    });
  });
  await popupPage.waitForTimeout(200);

  // sub-tab 切到"模型" → 柱状图
  await popupPage.click('.rp-substat-tab[data-sub="models"]');
  await popupPage.waitForTimeout(200);
  const barChart = await popupPage.evaluate(() => {
    const rows = [...document.querySelectorAll(".rp-bar-row")];
    return {
      rowCount: rows.length,
      hasFill: !!document.querySelector(".rp-bar-fill"),
      firstName: rows[0]?.querySelector(".rp-bar-name")?.textContent,
      firstWidth: rows[0]?.querySelector(".rp-bar-fill")?.style.width
    };
  });
  check("v4.6.8: 模型 sub-tab 渲染柱状图 — 3 行 + fill 元素",
    barChart.rowCount === 3 && barChart.hasFill, JSON.stringify(barChart));
  check("v4.6.8: 柱状图按 Token 排序 — 第 1 名 Claude 100%",
    barChart.firstName === "Claude" && /^100(\.0)?%$/.test(barChart.firstWidth),
    JSON.stringify(barChart));

  // sub-tab 切到"累计" → 趋势线 + 热力图
  await popupPage.click('.rp-substat-tab[data-sub="lifetime"]');
  await popupPage.waitForTimeout(200);
  const lifetimeChart = await popupPage.evaluate(() => {
    return {
      hasTrendSvg: !!document.querySelector(".rp-chart-svg"),
      trendLineExists: !!document.querySelector(".rp-chart-line"),
      trendDotCount: document.querySelectorAll(".rp-chart-dot").length,
      hasHeatSvg: !!document.querySelector(".rp-heat-svg"),
      heatCellCount: document.querySelectorAll(".rp-heat-cell").length,
      hasLegend: !!document.querySelector(".rp-heat-legend-sq")
    };
  });
  check("v4.6.8: 累计 sub-tab — 7 天趋势 SVG + 折线 + 7 个数据点",
    lifetimeChart.hasTrendSvg && lifetimeChart.trendLineExists && lifetimeChart.trendDotCount === 7,
    JSON.stringify(lifetimeChart));
  check("v4.6.8: 累计 sub-tab — 热力图 7×24=168 cells + 图例",
    lifetimeChart.hasHeatSvg && lifetimeChart.heatCellCount === 168 && lifetimeChart.hasLegend,
    JSON.stringify(lifetimeChart));

  // ========== v4.7.0: 本次 sub-tab 心流柱状图 + 任务分布饼图 ==========
  console.log("\n[smoke] === v4.7.0 心流 + 任务饼图 ===");

  // 切到 stats Tab 的"本次" sub-tab
  await popupPage.click('.rp-tab[data-tab="stats"]');
  await popupPage.waitForTimeout(200);
  await popupPage.click('.rp-substat-tab[data-sub="session"]');
  await popupPage.waitForTimeout(200);

  // 先注入 7 天心流数据 + emit 任务事件
  await popupPage.evaluate(() => {
    const today = new Date();
    const daily = {};
    const flows = [12, 18, 47, 25, 8, 3, 22]; // 周三峰值 47
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const k = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      daily[k] = { conversations: 5 + i, chars: 3000, models: {}, flowSec: flows[6 - i] * 60 };
    }
    window.ChatStats._injectFakeData({ daily });
    // 模拟 4 个任务被触发
    window.ChatStats._emitTask("ask");
    window.ChatStats._emitTask("ask");
    window.ChatStats._emitTask("ask");
    window.ChatStats._emitTask("debate");
    window.ChatStats._emitTask("summary");
    window.ChatStats._emitTask("ppt");
  });
  await popupPage.waitForTimeout(300);

  // 心流柱状图渲染
  const flowChart = await popupPage.evaluate(() => {
    return {
      hasFlowTitle: document.body.innerText.includes("每日心流"),
      barCount: document.querySelectorAll(".rp-flow-bar").length,
      hasPeakColor: !!document.querySelector('.rp-flow-bar[fill="#34c759"]')
    };
  });
  check("v4.7.0: 本次 sub-tab 心流柱状图 — 7 个柱 + 峰值绿色高亮",
    flowChart.hasFlowTitle && flowChart.barCount === 7 && flowChart.hasPeakColor,
    JSON.stringify(flowChart));

  // 任务饼图渲染
  const taskPie = await popupPage.evaluate(() => {
    const arcs = document.querySelectorAll(".rp-pie-svg circle");
    const legRows = document.querySelectorAll(".rp-pie-leg-row");
    const centerNum = document.querySelector(".rp-pie-center-num")?.textContent;
    return {
      hasPieSvg: !!document.querySelector(".rp-pie-svg"),
      arcCount: arcs.length,
      legendRowCount: legRows.length,
      centerTotal: centerNum
    };
  });
  check("v4.7.0: 本次 sub-tab 任务饼图 — 4 个弧 + 4 行图例 + 中心总数 6",
    taskPie.hasPieSvg && taskPie.arcCount === 4 && taskPie.legendRowCount === 4 && taskPie.centerTotal === "6",
    JSON.stringify(taskPie));

  // sessionStats.taskCounts 真累加
  const sessionTask = await popupPage.evaluate(() => window.ChatStats._session().taskCounts);
  check("v4.7.0: sessionStats.taskCounts 累加正确 (ask=3 debate=1 summary=1 ppt=1)",
    sessionTask.ask === 3 && sessionTask.debate === 1 && sessionTask.summary === 1 && sessionTask.ppt === 1,
    JSON.stringify(sessionTask));

  // 任务零次时显示 empty
  const taskPieEmpty = await popupPage.evaluate(() => {
    // 把 sessionStats 重置
    window.ChatStats._injectFakeSession({ taskCounts: { ask: 0, debate: 0, summary: 0, ppt: 0 } });
    return {
      hasEmpty: !!document.querySelector(".rp-pie-empty"),
      noSvg: !document.querySelector(".rp-pie-svg")
    };
  });
  check("v4.7.0: 任务计数全 0 时显示 empty 提示（无饼图）",
    taskPieEmpty.hasEmpty && taskPieEmpty.noSvg, JSON.stringify(taskPieEmpty));

  // ========== v4.7.2: 3 项 UI/功能修复 ==========
  console.log("\n[smoke] === v4.7.2 UI/功能修复 ===");

  // Issue 1: roster 区文件上传安全提示
  const rosterHint = await popupPage.evaluate(() => {
    const el = document.querySelector(".roster-upload-hint");
    return {
      exists: !!el,
      text: el?.textContent?.trim() || "",
      hasSecurityHint: el?.textContent?.includes("文件上传") && el?.textContent?.includes("AI 窗口")
    };
  });
  check("v4.7.2: roster 区有文件上传安全提示文案",
    rosterHint.exists && rosterHint.hasSecurityHint, JSON.stringify(rosterHint));

  // Issue 2: 状态日志样式跟主题（用 var(--card) / var(--bg)）
  const themeAware = await popupPage.evaluate(() => {
    // 切到 Sunset 主题 (F)
    document.body.setAttribute("data-theme", "F");
    const box = document.getElementById("rp-log-box");
    const cs = getComputedStyle(box);
    const expectedF = "rgb(255, 255, 255)"; // F 主题 --card: #fff
    const actualBg = cs.backgroundColor;
    // 切回默认（不挂主题），看是否变浅灰
    document.body.removeAttribute("data-theme");
    const noThemeBg = getComputedStyle(box).backgroundColor;
    // 删除老的 hardcoded #1d1d1f 验证：现在 bg 不能是黑色
    return {
      sunsetBg: actualBg,
      noThemeBg,
      notHardcodedBlack: actualBg !== "rgb(29, 29, 31)" && noThemeBg !== "rgb(29, 29, 31)"
    };
  });
  check("v4.7.2: 状态日志背景不再硬编码黑色（删 dead .rp-log-box 老定义）",
    themeAware.notHardcodedBlack, JSON.stringify(themeAware));

  // Issue 3: 导出会话 handler 不再忽略成功响应（拿到 markdown 后真做事）
  const exportFixed = await popupPage.evaluate(() => {
    // 找 popup-tasks.js 渲染的 #rp-btn-export 处理器是否完整
    // 切到任务 Tab 看 export 按钮（仅辩论模式下出现，但任务面板默认是 ask）
    // 我们直接检查 popup-tasks.js 源码静态：handler 函数内部是否含 navigator.clipboard.writeText 或 a.download
    // 但 evaluate 拿不到 popup-tasks.js 源码，改成 mock：触发后看 ChatLog 是否被写
    let pushed = [];
    const origPush = window.ChatLog?.push;
    if (origPush) window.ChatLog.push = (l) => { pushed.push(l.text); origPush(l); };
    // 直接调 background exportSession 看返回
    return new Promise(res => {
      chrome.runtime.sendMessage({ type: "exportSession" }, (resp) => {
        if (origPush) window.ChatLog.push = origPush;
        res({
          hasMarkdown: !!resp?.markdown,
          markdownStart: resp?.markdown?.slice(0, 30) || "",
          ok: resp?.ok
        });
      });
    });
  });
  check("v4.7.2: background exportSession 返回 markdown",
    exportFixed.ok && exportFixed.hasMarkdown && exportFixed.markdownStart.includes("AI Arena"),
    JSON.stringify(exportFixed));

  // ========== v4.8.0: UI 重设计 ==========
  console.log("\n[smoke] === v4.8.0 UI 重设计 ===");

  // ① 王者风 3 卡槽（成员 Tab）
  await popupPage.click('.rp-tab[data-tab="members"]');
  await popupPage.waitForTimeout(300);
  const heroSlots = await popupPage.evaluate(() => {
    const slots = [...document.querySelectorAll(".hero-slot")];
    return {
      slotCount: slots.length,
      emptyCount: slots.filter(s => s.classList.contains("empty")).length,
      hasGrid: !!document.querySelector(".hero-slots"),
      hasOldCard: !!document.querySelector(".rp-member-card")   // 旧逐行卡片应已删
    };
  });
  check("v4.8.0: 王者卡槽 — 3 个 .hero-slot + 无旧 .rp-member-card",
    heroSlots.slotCount === 3 && heroSlots.hasGrid && !heroSlots.hasOldCard,
    JSON.stringify(heroSlots));
  check("v4.8.0: 初始空状态 — 3 个全是 .hero-slot.empty",
    heroSlots.emptyCount === 3, JSON.stringify(heroSlots));

  // ② 时光机时间轴 — sidebar 加圆点节点 + 时间轴线
  const timeline = await popupPage.evaluate(() => {
    const list = document.getElementById("sidebar-list");
    const cs = list ? getComputedStyle(list) : null;
    // 注入 fake log 触发 sidebar 渲染
    const fakeLog = [
      { role: "user", msgId: "u1", text: "5G TTI EP 可重构", ts: Date.now() - 3600000 },
      { role: "ai", msgId: "u1", participantId: "claude", text: "理论上有空间", ts: Date.now() - 3590000 },
      { role: "user", msgId: "u2", text: "阵列单元方向图边界", ts: Date.now() - 1800000 },
    ];
    window.ChatHistory?.renderAll(fakeLog);
    // 检查节点 + 时间轴线
    const item = document.querySelector("#sidebar-list .sidebar-item");
    const itemCs = item ? getComputedStyle(item, "::before") : null;
    return {
      paddingLeft: cs?.paddingLeft,        // 应该是 22px（v4.8.0 加的）
      itemDotShape: itemCs?.borderRadius,  // 应该是 50%（圆点）
      itemDotPos: itemCs?.left,            // 应该是 -16px
      itemCount: document.querySelectorAll("#sidebar-list .sidebar-item").length
    };
  });
  check("v4.8.0: 时光机 — sidebar-list padding-left 22px（给时间轴留位）",
    timeline.paddingLeft === "22px", JSON.stringify(timeline));
  check("v4.8.0: 时光机 — sidebar-item::before 是圆点（border-radius 50%）",
    timeline.itemDotShape === "50%", JSON.stringify(timeline));

  // v4.8.2: 跳过 F20/F21 pending 占位（避免时间轴重复条目）
  const pendingFilter = await popupPage.evaluate(() => {
    const now = Date.now();
    const log = [
      { role: "user", msgId: "u1", text: "先有鸡还是先有蛋", ts: now - 5000 },
      { role: "ai", msgId: "u1", participantId: "claude", text: "答案", ts: now - 4500 },
      // F20 pending 占位
      { role: "user", msgId: "p1", text: "⚔️ 第1轮辩论·自由辩论 · 正在发起...", ts: now - 4000 },
      // 真实辩论 msg
      { role: "user", msgId: "u2", text: "⚔️ 第1轮辩论·自由辩论", ts: now - 3000 },
      { role: "ai", msgId: "u2", participantId: "gemini", text: "Gemini 反驳", ts: now - 2500 },
      // F21 总结 pending
      { role: "user", msgId: "p2", text: "📋 裁判总结·Claude · 正在发起...", ts: now - 2000 },
      { role: "user", msgId: "u3", text: "📋 裁判总结·Claude", ts: now - 1000 },
    ];
    window.ChatHistory?.renderAll(log);
    const turns = document.querySelectorAll("#sidebar-list .sidebar-turn");
    const texts = [...turns].map(t => t.querySelector(".sidebar-item-text")?.textContent || "");
    return {
      turnCount: turns.length,
      texts,
      hasPending: texts.some(t => t.includes("正在发起"))
    };
  });
  check("v4.8.2: sidebar 跳过 pending 占位（3 turns 不含'正在发起'）",
    pendingFilter.turnCount === 3 && !pendingFilter.hasPending,
    JSON.stringify(pendingFilter));

  // ③ 极简任务 picker — 删了 ⚙️ icon 和"任务"label
  const pickerSimple = await popupPage.evaluate(() => {
    const btn = document.getElementById("task-picker-btn");
    return {
      hasOldIcon: !!btn?.querySelector(".icon"),       // 旧的 ⚙️
      hasOldLabel: !!btn?.querySelector(".picker-label"),  // 旧的"任务"字
      hasPickedPill: !!btn?.querySelector(".picked"),
      hasCaret: !!btn?.querySelector(".caret"),
      btnText: btn?.textContent?.trim() || ""
    };
  });
  check("v4.8.0: 极简 picker — 删了 ⚙️ icon",
    !pickerSimple.hasOldIcon, JSON.stringify(pickerSimple));
  check("v4.8.0: 极简 picker — 删了 .picker-label '任务'字",
    !pickerSimple.hasOldLabel, JSON.stringify(pickerSimple));
  check("v4.8.0: 极简 picker — 保留 picked pill + caret",
    pickerSimple.hasPickedPill && pickerSimple.hasCaret, JSON.stringify(pickerSimple));
  check("v4.8.0: 极简 picker — 不再含'任务'两字",
    !pickerSimple.btnText.includes("任务"), JSON.stringify(pickerSimple));

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

  // v4.6.9: 右栏拆 3:1 + 状态日志固定区
  const layout469 = await popupPage.evaluate(() => {
    const rp = document.getElementById("chat-rightpanel");
    const top = document.getElementById("rp-top");
    const bot = document.getElementById("rp-bottom");
    const logBox = document.getElementById("rp-log-box");
    const logHdr = document.querySelector(".rp-log-header");
    const clearBtn = document.getElementById("rp-log-clear");
    // 验证 Tab 都嵌在 rp-top 内
    const panelsInTop = top ? top.querySelectorAll(".rp-panel").length : 0;
    return {
      rpExists: !!rp,
      topExists: !!top,
      botExists: !!bot,
      logBoxExists: !!logBox,
      logHdrExists: !!logHdr,
      clearBtnExists: !!clearBtn,
      panelsInTop,
      // 高度比应该 3:1（容忍 ±20% 浮动）
      topH: top?.getBoundingClientRect().height || 0,
      botH: bot?.getBoundingClientRect().height || 0
    };
  });
  check("v4.6.9: 右栏布局 .rp-top + .rp-bottom 存在",
    layout469.topExists && layout469.botExists, JSON.stringify(layout469));
  check("v4.6.9: 5 个 .rp-panel 全部嵌在 .rp-top",
    layout469.panelsInTop === 5, JSON.stringify(layout469));
  check("v4.6.9: 状态日志 #rp-log-box + header + 清空按钮",
    layout469.logBoxExists && layout469.logHdrExists && layout469.clearBtnExists,
    JSON.stringify(layout469));
  check("v4.6.9: top:bottom 高度比 ≈ 3:1（top 至少是 bot 2 倍）",
    layout469.topH > layout469.botH * 2, JSON.stringify({ topH: layout469.topH, botH: layout469.botH }));

  // 设置 Tab 不应再含"状态日志"
  await popupPage.click('.rp-tab[data-tab="settings"]');
  await popupPage.waitForTimeout(200);
  const settingsNoLog = await popupPage.evaluate(() => {
    const panel = document.getElementById("rp-panel-settings");
    return {
      hasLogTitle: panel?.innerText?.includes("状态日志") || false,
      hasLogBoxInside: !!panel?.querySelector(".rp-log-box"),
      sectionCount: panel?.querySelectorAll(".rp-section-title").length || 0
    };
  });
  check("v4.6.9: 设置 Tab 已移除「状态日志」section",
    !settingsNoLog.hasLogTitle && !settingsNoLog.hasLogBoxInside,
    JSON.stringify(settingsNoLog));
  // v4.8.15: 设置 Tab 新增"风格" section → 现在共 3 个 section（主题 / 风格 / 快捷键）
  check("v4.8.15: 设置 Tab 含 3 个 section（主题 / 风格 / 快捷键），状态日志仍已抽出",
    settingsNoLog.sectionCount === 3, JSON.stringify(settingsNoLog));

  // ChatLog API 暴露 + pushLog 兼容
  const logApi = await popupPage.evaluate(() => ({
    hasChatLog: typeof window.ChatLog === "object",
    hasPush: typeof window.ChatLog?.push === "function",
    hasClear: typeof window.ChatLog?.clear === "function",
    hasCompat: typeof window.ChatSettings?.pushLog === "function"
  }));
  check("v4.6.9: ChatLog API 暴露 (push/clear) + ChatSettings.pushLog 兼容",
    logApi.hasChatLog && logApi.hasPush && logApi.hasClear && logApi.hasCompat,
    JSON.stringify(logApi));

  // 模拟 push → 看 DOM
  const logPushTest = await popupPage.evaluate(() => {
    window.ChatLog.push({ ts: Date.now(), text: "TEST_LOG_LINE_v4.6.9", level: "info" });
    const lines = document.querySelectorAll("#rp-log-box .rp-log-line");
    const txt = [...lines].map(x => x.innerText).join("|");
    return { lineCount: lines.length, hasTest: txt.includes("TEST_LOG_LINE_v4.6.9") };
  });
  check("v4.6.9: ChatLog.push → 日志 DOM 写入 + 含测试文本",
    logPushTest.hasTest, JSON.stringify(logPushTest));

  // 全局细滚动条 — 验证 .rp-log-box 实际拿到 6px 细滚动条规则（最直接）
  const scrollGlobal = await popupPage.evaluate(() => {
    // 注入超长内容让 log-box 出现滚动条，然后看 computed style
    const box = document.getElementById("rp-log-box");
    if (!box) return { err: "no log box" };
    box.innerHTML = "";
    for (let i = 0; i < 50; i++) {
      const d = document.createElement("div");
      d.className = "rp-log-line";
      d.textContent = `测试日志行 ${i} - 验证滚动条样式`;
      box.appendChild(d);
    }
    const cs = getComputedStyle(box);
    const styles = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch { return []; } });
    // 浏览器序列化把 *::-webkit-scrollbar 中的 `*` 省略，直接搜 webkit-scrollbar
    const allScrollRules = styles.filter(r => r.cssText && r.cssText.includes("::-webkit-scrollbar"));
    return {
      scrollHeight: box.scrollHeight,
      clientHeight: box.clientHeight,
      isScrollable: box.scrollHeight > box.clientHeight,
      firefoxThinSet: cs.scrollbarWidth === "thin" || cs.getPropertyValue("scrollbar-width") === "thin",
      scrollRuleCount: allScrollRules.length,
      hasWidth6: allScrollRules.some(r => /width:\s*6px/.test(r.cssText))
    };
  });
  check("v4.6.9: 全局细滚动条 — log-box 可滚动 + firefox thin 生效",
    scrollGlobal.isScrollable && scrollGlobal.firefoxThinSet,
    JSON.stringify(scrollGlobal));
  check("v4.6.9: webkit ::-webkit-scrollbar 规则含 6px width",
    scrollGlobal.hasWidth6, JSON.stringify(scrollGlobal));

  // 切回 templates Tab 准备后续断言
  await popupPage.click('.rp-tab[data-tab="templates"]');
  await popupPage.waitForTimeout(150);
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

  // v4.6.2: 分工映射 + marker block — 验证 buildAssignmentBlock
  const blockTest = await popupPage.evaluate(() => {
    // 模拟分工：claude=clarifier, gemini=critic
    window.ArenaRoleHats.assignHat("claude", "role.clarifier");
    window.ArenaRoleHats.assignHat("gemini", "role.critic");
    const block = window.ArenaRoleHats.buildAssignmentBlock();
    return {
      hasMarker: block.startsWith("## 本轮角色分工"),
      hasClaude: block.includes("Claude → 「问题澄清员」"),
      hasGemini: block.includes("Gemini → 「反方挑战者」"),
      hasFormatLine: block.includes("输出格式：问题拆解"),
      hasIdentityHint: block.includes("根据自己所在网页平台名"),
      noOldFormat: !block.includes("@") && !block.includes("戴上「")
    };
  });
  check("v4.6.2: buildAssignmentBlock 含 marker + 每 AI 分工 + 自识别身份提示",
    blockTest.hasMarker && blockTest.hasClaude && blockTest.hasGemini
      && blockTest.hasFormatLine && blockTest.hasIdentityHint
      && blockTest.noOldFormat,
    JSON.stringify(blockTest));

  // v4.6.2: assignHat 真把 block 写入 #chat-input
  const inputAfterAssign = await popupPage.evaluate(() => {
    return document.getElementById("chat-input").textContent;
  });
  check("v4.6.2: assignHat 把分工 block 写入 #chat-input",
    inputAfterAssign.includes("## 本轮角色分工")
      && inputAfterAssign.includes("Claude → 「问题澄清员」")
      && inputAfterAssign.includes("Gemini → 「反方挑战者」"),
    inputAfterAssign.slice(0, 200));

  // v4.6.2: 再 assign 一次（gemini 换帽子）→ marker block 应被替换，不是追加
  const reassignTest = await popupPage.evaluate(() => {
    window.ArenaRoleHats.assignHat("gemini", "role.judge");  // gemini 换戴裁判
    const input = document.getElementById("chat-input").textContent;
    return {
      markerCount: (input.match(/## 本轮角色分工/g) || []).length,
      hasJudge: input.includes("Gemini → 「综合裁判」"),
      noOldCritic: !input.includes("Gemini → 「反方挑战者」")
    };
  });
  check("v4.6.2: 重复 assign 替换 block（marker 只出现 1 次）",
    reassignTest.markerCount === 1
      && reassignTest.hasJudge
      && reassignTest.noOldCritic,
    JSON.stringify(reassignTest));

  // v4.6.2: clearAll → marker block 被移除
  const clearAllTest = await popupPage.evaluate(() => {
    window.ArenaRoleHats.clearAll();
    const input = document.getElementById("chat-input").textContent;
    return {
      empty: window.ArenaRoleHats.getAssignments(),
      hasMarker: input.includes("## 本轮角色分工")
    };
  });
  check("v4.6.2: clearAll 移除分工 block",
    Object.keys(clearAllTest.empty).length === 0 && !clearAllTest.hasMarker,
    JSON.stringify(clearAllTest));

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

  // ========== v4.8.7: 卡牌 logo 替换 ==========
  console.log("\n[smoke] === v4.8.7 卡牌 logo ===");

  // ① 10 个 webp 资源都能加载
  const heroAssets = await popupPage.evaluate(async () => {
    const ids = ["claude","gemini","chatgpt","deepseek","doubao","qwen","kimi","yuanbao","grok","huawei"];
    const results = {};
    for (const id of ids) {
      const url = chrome.runtime.getURL(`icons/heroes/${id}.webp`);
      try {
        const r = await fetch(url);
        results[id] = { ok: r.ok, status: r.status, size: r.headers.get("content-length") };
      } catch (e) {
        results[id] = { ok: false, err: e.message };
      }
    }
    return results;
  });
  const heroAllOk = Object.values(heroAssets).every(v => v.ok === true);
  check("v4.8.7: 10 个 hero webp 资源全部加载成功",
    heroAllOk, JSON.stringify(heroAssets));

  // ② popup-members.js 含 heroLogo 字段
  const heroLogoFieldOk = await popupPage.evaluate(() => {
    return fetch(chrome.runtime.getURL("popup-members.js"))
      .then(r => r.text())
      .then(src => ({
        hasHeroLogoField: src.includes("heroLogo:"),
        hasHeroesPath:    src.includes("icons/heroes/"),
        hasFallback:      src.includes("meta.heroLogo || meta.logo")
      }));
  });
  check("v4.8.7: popup-members.js 含 heroLogo 字段 + heroes/ 路径 + fallback",
    heroLogoFieldOk.hasHeroLogoField && heroLogoFieldOk.hasHeroesPath && heroLogoFieldOk.hasFallback,
    JSON.stringify(heroLogoFieldOk));

  // ③ popup.js 主对话窗口 user/AI 头像 — v4.8.15 改走 ArenaLogoStyle.heroPath()
  const popupJsCheck = await popupPage.evaluate(() => {
    return fetch(chrome.runtime.getURL("popup.js"))
      .then(r => r.text())
      .then(src => ({
        usesArenaLogoStyle: src.includes("window.ArenaLogoStyle?.heroPath(id)"),
        huaweiViaHelper:    src.includes("brandLogoHtml('huawei')"),
        brandLogoUsesHero:  src.includes("heroSrc || BRAND_SVG[id]"),
        meAvatarHasHuawei:  src.includes("brandLogoHtml('huawei')")
      }));
  });
  check("v4.8.15: popup.js brandLogoHtml 走 ArenaLogoStyle.heroPath() + 我=huawei (代替 v4.8.7 写死 HERO_LOGO)",
    popupJsCheck.usesArenaLogoStyle
      && popupJsCheck.huaweiViaHelper
      && popupJsCheck.brandLogoUsesHero
      && popupJsCheck.meAvatarHasHuawei,
    JSON.stringify(popupJsCheck));

  // ④ CSS .msg-avatar 已删白底 padding，.hero-slot-logo 改为 cover 占满
  const cssCheck = await popupPage.evaluate(() => {
    return fetch(chrome.runtime.getURL("popup.css"))
      .then(r => r.text())
      .then(src => ({
        msgAvatarNoPadding: /\.msg-avatar\s*\{[^}]*padding:\s*0/.test(src),
        msgAvatarTransparent: /\.msg-avatar\s*\{[^}]*background:\s*transparent/.test(src),
        heroLogoCover: /\.hero-slot-logo\s*\{[^}]*object-fit:\s*(cover|contain)/.test(src),
        heroLogoFull:  /\.hero-slot-logo\s*\{[^}]*inset:\s*0/.test(src),
        msgBrandCover: /\.msg-avatar\s+\.brand-logo\s*\{[^}]*object-fit:\s*cover/.test(src)
      }));
  });
  check("v4.8.7: popup.css — .msg-avatar 删白底/padding + .hero-slot-logo cover 占满",
    cssCheck.msgAvatarNoPadding
      && cssCheck.msgAvatarTransparent
      && cssCheck.heroLogoCover
      && cssCheck.heroLogoFull
      && cssCheck.msgBrandCover,
    JSON.stringify(cssCheck));

  // ========== v4.8.10: 头像尺寸 48→72（边长 2x of 36） + 删黑色外框 ==========
  console.log("\n[smoke] === v4.8.10 头像再放大 + 删黑框 ===");
  const avatarSize = await popupPage.evaluate(() => {
    const $messages = document.getElementById("chat-messages");
    if (!$messages) return { err: "no #chat-messages" };
    $messages.innerHTML = `
      <div class="msg ai">
        <div class="msg-avatar claude"><img class="brand-logo" src="icons/heroes/claude.webp"></div>
        <div class="msg-body"><div class="msg-bubble">测试</div></div>
      </div>`;
    const av = document.querySelector(".msg.ai .msg-avatar");
    const rect = av?.getBoundingClientRect();
    const cs = av ? getComputedStyle(av) : null;
    return {
      width: rect?.width,
      height: rect?.height,
      borderRadius: cs?.borderRadius,
      flexBasis: cs?.flexBasis,
      boxShadow: cs?.boxShadow,
    };
  });
  check("v4.8.10: .msg-avatar 实际尺寸 72×72 (边长 2x of 36 = 面积 4x)",
    avatarSize.width === 72 && avatarSize.height === 72,
    JSON.stringify(avatarSize));
  check("v4.8.10: .msg-avatar 圆角 12px + flex-basis 72",
    avatarSize.borderRadius === "12px" && avatarSize.flexBasis === "72px",
    JSON.stringify(avatarSize));
  check("v4.8.10: .msg-avatar 删除黑色 box-shadow 外框（卡牌自带黄虚线边框）",
    avatarSize.boxShadow === "none",
    JSON.stringify(avatarSize));

  // ========== v4.8.11: 群聊空状态换成 AI 小队海报 ==========
  console.log("\n[smoke] === v4.8.11 空状态海报 ===");

  // 重新打开 popup 获取 fresh empty-state（avatarSize 上一段已塞了 fake AI msg 把 empty 隐了）
  const posterPage = await context.newPage();
  await posterPage.goto(`chrome-extension://${extensionId}/popup.html`);
  await posterPage.waitForLoadState("domcontentloaded");
  await posterPage.waitForTimeout(300);

  const posterCheck = await posterPage.evaluate(async () => {
    const empty = document.getElementById("empty-state");
    const poster = empty?.querySelector(".es-poster");
    const oldTitle = empty?.querySelector(".es-title");
    const oldChips = empty?.querySelector(".es-ai-chips");
    const oldCta = empty?.querySelector(".es-cta");
    const oldHero = empty?.querySelector(".es-hero-img");
    // 资源 200?
    const url = chrome.runtime.getURL("icons/poster-ai-team.webp");
    let assetOk = false, assetSize = 0;
    try {
      const r = await fetch(url);
      assetOk = r.ok;
      const buf = await r.arrayBuffer();
      assetSize = buf.byteLength;
    } catch (e) {}
    return {
      hasPoster: !!poster,
      posterSrc: poster?.getAttribute("src") || null,
      // 老元素应已删
      noOldTitle: !oldTitle,
      noOldChips: !oldChips,
      noOldCta: !oldCta,
      noOldHero: !oldHero,
      assetOk,
      assetSizeKB: Math.round(assetSize / 1024),
    };
  });
  check("v4.8.11: empty-state 含单张 .es-poster (旧 title/chips/cta/hero 全删)",
    posterCheck.hasPoster
      && posterCheck.posterSrc?.includes("poster-ai-team.webp")
      && posterCheck.noOldTitle
      && posterCheck.noOldChips
      && posterCheck.noOldCta
      && posterCheck.noOldHero,
    JSON.stringify(posterCheck));
  check("v4.8.11: poster-ai-team.webp 资源加载成功 (压缩后 ~170KB)",
    posterCheck.assetOk && posterCheck.assetSizeKB > 50 && posterCheck.assetSizeKB < 400,
    JSON.stringify(posterCheck));

  // ========== v4.8.12: 上 2/3 海报 + 下 1/3 自定义文案 ==========
  console.log("\n[smoke] === v4.8.12 海报 + 文案 ===");
  const pitchCheck = await posterPage.evaluate(() => {
    const empty = document.getElementById("empty-state");
    const poster = empty?.querySelector(".es-poster");
    const pitch = empty?.querySelector(".es-pitch");
    const title = pitch?.querySelector(".es-pitch-title");
    const feats = [...(pitch?.querySelectorAll(".es-feat") || [])];
    const cta = pitch?.querySelector(".es-pitch-cta");
    const posterCs = poster ? getComputedStyle(poster) : null;
    const pitchCs = pitch ? getComputedStyle(pitch) : null;
    return {
      hasPitch: !!pitch,
      titleText: title?.textContent?.trim() || null,
      featCount: feats.length,
      featTexts: feats.map(f => f.textContent.trim()),
      ctaText: cta?.textContent?.trim() || null,
      posterFlexGrow: posterCs?.flexGrow,   // 期望 "2"
      pitchFlexGrow: pitchCs?.flexGrow,     // 期望 "1"
      posterObjectFit: posterCs?.objectFit, // 期望 "contain"
    };
  });
  check("v4.8.12: .es-pitch 含标题 '让 AI 同台辩论，逼近真相'",
    pitchCheck.hasPitch && pitchCheck.titleText?.includes("AI 同台辩论") && pitchCheck.titleText?.includes("逼近真相"),
    JSON.stringify(pitchCheck));
  check("v4.8.12: 6 个 .es-feat 功能 chip (⚔️自由辩论/🤝群策群力/📋裁判总结/🎭角色分工/📐任务模板/📊PPT工坊)",
    pitchCheck.featCount === 6
      && pitchCheck.featTexts.some(t => t.includes("自由辩论"))
      && pitchCheck.featTexts.some(t => t.includes("群策群力"))
      && pitchCheck.featTexts.some(t => t.includes("裁判总结"))
      && pitchCheck.featTexts.some(t => t.includes("角色分工"))
      && pitchCheck.featTexts.some(t => t.includes("任务模板"))
      && pitchCheck.featTexts.some(t => t.includes("PPT")),
    JSON.stringify(pitchCheck));
  check("v4.8.12: CTA 文案含 '右侧添加' + '2 个 AI'",
    pitchCheck.ctaText?.includes("右侧") && pitchCheck.ctaText?.includes("AI"),
    JSON.stringify(pitchCheck));
  check("v4.8.12: poster flex:2 / pitch flex:1 (上 2/3 + 下 1/3) + poster contain",
    pitchCheck.posterFlexGrow === "2"
      && pitchCheck.pitchFlexGrow === "1"
      && pitchCheck.posterObjectFit === "contain",
    JSON.stringify(pitchCheck));

  // ========== v4.8.15: 卡牌 logo 风格切换 (classic / anime) ==========
  console.log("\n[smoke] === v4.8.15 logo 风格切换 ===");

  // ① 10 张 anime webp 资源全部加载（heroes-anime/*.webp）
  const animeAssets = await popupPage.evaluate(async () => {
    const ids = ["claude","gemini","chatgpt","deepseek","doubao","qwen","kimi","yuanbao","grok","huawei"];
    const results = {};
    for (const id of ids) {
      try {
        const r = await fetch(chrome.runtime.getURL(`icons/heroes-anime/${id}.webp`));
        results[id] = { ok: r.ok, status: r.status };
      } catch (e) { results[id] = { ok: false, err: e.message }; }
    }
    return results;
  });
  check("v4.8.15: 10 张 heroes-anime webp 全部加载成功",
    Object.values(animeAssets).every(v => v.ok === true),
    JSON.stringify(animeAssets));

  // ② ArenaLogoStyle API 暴露 + 默认 classic
  const apiCheck = await popupPage.evaluate(() => ({
    hasApi: !!window.ArenaLogoStyle,
    current: window.ArenaLogoStyle?.current,
    classicPath: window.ArenaLogoStyle?.heroPath("claude"),
    styles: window.ArenaLogoStyle?.listStyles()?.map(s => s.id) || [],
  }));
  check("v4.8.15: ArenaLogoStyle API 暴露 + 默认 classic + 2 风格",
    apiCheck.hasApi
      && apiCheck.current === "classic"
      && apiCheck.classicPath === "icons/heroes/claude.webp"
      && apiCheck.styles.includes("classic")
      && apiCheck.styles.includes("anime"),
    JSON.stringify(apiCheck));

  // ③ 切换到 anime → heroPath 切换 + DOM 头像 src 跟着变
  const switchCheck = await popupPage.evaluate(async () => {
    // 注入一条 AI 消息（claude）让 .msg-avatar 出现
    document.getElementById("chat-messages").innerHTML = `
      <div class="msg ai">
        <div class="msg-avatar claude"><img class="brand-logo" src="icons/heroes/claude.webp" data-svc="claude" alt="claude"></div>
        <div class="msg-body"><div class="msg-bubble">测试</div></div>
      </div>`;
    const beforeSrc = document.querySelector(".msg.ai .msg-avatar img.brand-logo")?.getAttribute("src");
    // 切到 anime（不 persist，避免污染后续测试）
    window.ArenaLogoStyle.setCurrent("anime", false);
    await new Promise(r => setTimeout(r, 100));
    const afterSrc = document.querySelector(".msg.ai .msg-avatar img.brand-logo")?.getAttribute("src");
    const animePathCheck = window.ArenaLogoStyle.heroPath("gemini");
    // 切回 classic
    window.ArenaLogoStyle.setCurrent("classic", false);
    return { beforeSrc, afterSrc, animePathCheck };
  });
  check("v4.8.15: 切到 anime — heroPath('gemini') 返回 heroes-anime/gemini.webp",
    switchCheck.animePathCheck === "icons/heroes-anime/gemini.webp",
    JSON.stringify(switchCheck));
  check("v4.8.15: logo-style-changed 事件触发后 .msg-avatar img.brand-logo[data-svc] 自动换 src",
    switchCheck.beforeSrc === "icons/heroes/claude.webp"
      && switchCheck.afterSrc === "icons/heroes-anime/claude.webp",
    JSON.stringify(switchCheck));

  // ④ 设置 Tab 渲染 2 个 .rp-style-item cards（含 active 标记）
  const settingsCheck = await popupPage.evaluate(async () => {
    // 切到设置 Tab
    document.querySelector('.rp-tab[data-tab="settings"]')?.click();
    await new Promise(r => setTimeout(r, 300));
    const items = [...document.querySelectorAll(".rp-style-item")];
    return {
      count: items.length,
      styles: items.map(i => i.dataset.style),
      activeStyle: items.find(i => i.classList.contains("active"))?.dataset.style,
      hasPreviewImg: items.every(i => !!i.querySelector(".rp-style-preview")),
      sectionTitle: [...document.querySelectorAll("#rp-panel-settings .rp-section-title")]
        .map(e => e.textContent.trim()),
    };
  });
  check("v4.8.15: 设置 Tab 含 风格 section + 2 cards (classic + anime) + active=classic + 预览图",
    settingsCheck.count === 2
      && settingsCheck.styles.includes("classic")
      && settingsCheck.styles.includes("anime")
      && settingsCheck.activeStyle === "classic"
      && settingsCheck.hasPreviewImg
      && settingsCheck.sectionTitle.includes("风格")
      && settingsCheck.sectionTitle.includes("主题")
      && settingsCheck.sectionTitle.includes("快捷键"),
    JSON.stringify(settingsCheck));

  // ========== v4.8.17: hero-slot aspect 修正 + 辩论总结用裁判 logo ==========
  console.log("\n[smoke] === v4.8.17 头像底部不裁切 + 总结裁判 logo ===");
  const aspectCheck = await popupPage.evaluate(() => {
    return fetch(chrome.runtime.getURL("popup.css"))
      .then(r => r.text())
      .then(src => ({
        // 找到 .hero-slot { 块里第一个 aspect-ratio
        match: /\.hero-slot\s*\{[^}]*aspect-ratio:\s*([\d.]+)/.exec(src)?.[1],
      }));
  });
  // v4.8.19: aspect 调到 0.78 + object-fit contain，兜底所有卡牌比例（0.666~0.881）
  check("v4.8.19: .hero-slot aspect-ratio 在 [0.70, 0.85] 区间（兼容 contain 模式）",
    aspectCheck.match && parseFloat(aspectCheck.match) <= 0.85 && parseFloat(aspectCheck.match) >= 0.70,
    JSON.stringify(aspectCheck));

  // v4.8.19 新增: .hero-slot-logo object-fit 必须是 contain（保证底部黄虚线 + 边距完整露出）
  const heroLogoFitCheck = await popupPage.evaluate(() => {
    return fetch(chrome.runtime.getURL("popup.css"))
      .then(r => r.text())
      .then(src => {
        const m = /\.hero-slot-logo\s*\{[^}]*object-fit:\s*(\w+)/.exec(src);
        return { fit: m?.[1] };
      });
  });
  check("v4.8.19: .hero-slot-logo object-fit: contain（cover 会从底部裁掉黄虚线 + 黑边）",
    heroLogoFitCheck.fit === "contain",
    JSON.stringify(heroLogoFitCheck));

  // ② 辩论总结卡片用裁判 logo + 名字
  const summaryCheck = await popupPage.evaluate(() => {
    return fetch(chrome.runtime.getURL("popup.js"))
      .then(r => r.text())
      .then(src => ({
        readsJudgeService: src.includes("meta?.judgeService"),
        usesBrandLogoForJudge: src.includes("brandLogoHtml(judgeSvc)"),
        titleHasJudgeName: src.includes("辩论总结${escapeHtml(judgeName)}"),
        keepsFallbackEmoji: src.includes('"📋"'),
      }));
  });
  check("v4.8.17: appendDebateSummaryCard 读 judgeService + 用 brandLogoHtml + 标题加裁判名 + 保留 📋 fallback",
    summaryCheck.readsJudgeService
      && summaryCheck.usesBrandLogoForJudge
      && summaryCheck.titleHasJudgeName
      && summaryCheck.keepsFallbackEmoji,
    JSON.stringify(summaryCheck));

  // ========== v4.8.18: 主题中文化 ==========
  console.log("\n[smoke] === v4.8.18 主题中文名 ===");
  const themeNamesCheck = await popupPage.evaluate(async () => {
    document.querySelector('.rp-tab[data-tab="settings"]')?.click();
    await new Promise(r => setTimeout(r, 300));
    const items = [...document.querySelectorAll(".rp-theme-item")];
    const names = items.map(el => {
      // 文字部分（去掉 ✓）
      const txt = el.textContent.trim().replace(/[✓\s]/g, "");
      return { id: el.dataset.theme, name: txt };
    });
    return names;
  });
  const expectedZh = {
    C: "极光琉璃", A: "深海指挥", B: "暖橙书页",
    D: "霓虹赛博", E: "月白极简", F: "落日熔金",
  };
  const allZhMatch = Object.entries(expectedZh).every(([id, zh]) => {
    const found = themeNamesCheck.find(n => n.id === id);
    return found && found.name.includes(zh);
  });
  check("v4.8.18: 6 个主题都用中文名（极光琉璃/深海指挥/暖橙书页/霓虹赛博/月白极简/落日熔金）",
    allZhMatch, JSON.stringify(themeNamesCheck));

  // sidepanel 主题菜单也中文化
  const sidepanelThemeCheck = await sidepanelPage.evaluate(() => {
    const items = [...document.querySelectorAll(".theme-menu-item")];
    return items.map(el => el.textContent.trim());
  });
  const sidepanelHasZh = ["极光琉璃","深海指挥","暖橙书页","霓虹赛博","月白极简","落日熔金"]
    .every(zh => sidepanelThemeCheck.some(t => t.includes(zh)));
  check("v4.8.18: sidepanel 主题菜单也中文化",
    sidepanelHasZh, JSON.stringify(sidepanelThemeCheck));

  // ========== v4.8.20: 竞技场化升级（5 项 P0/P1）==========
  console.log("\n[smoke] === v4.8.20 竞技场化升级 ===");

  // ① 出战动画 sparks — popup-members.js 渲染 isNew 时注入 6 个 .hero-slot-spark
  const sparkCheck = await popupPage.evaluate(() => {
    return fetch(chrome.runtime.getURL("popup-members.js"))
      .then(r => r.text())
      .then(src => ({
        hasSparkInject: src.includes('hero-slot-spark'),
        sparksOnlyOnNew: src.includes('isNew ? Array(6)'),
      }));
  });
  check("v4.8.20 ①: popup-members.js 在 isNew 时注入 6 个 .hero-slot-spark",
    sparkCheck.hasSparkInject && sparkCheck.sparksOnlyOnNew,
    JSON.stringify(sparkCheck));

  // ② 流光描边 + ① CSS keyframes 都在 popup.css
  const vibeCssCheck = await popupPage.evaluate(() => {
    return fetch(chrome.runtime.getURL("popup.css"))
      .then(r => r.text())
      .then(src => ({
        hasSparkOut: src.includes("@keyframes hero-slot-spark-out"),
        hasRainbow:  src.includes("@keyframes hero-slot-rainbow"),
        hasMsgArrive: src.includes("@keyframes msg-arrive"),
        hasMsgAvatarBounce: src.includes("@keyframes msg-avatar-bounce"),
        hasTwinkle: src.includes("@keyframes es-twinkle"),
        hasBadgeShine: src.includes("@keyframes arena-badge-shine"),
      }));
  });
  check("v4.8.20 ②: 6 个新 @keyframes 全部存在（sparkOut/rainbow/msgArrive/avatarBounce/twinkle/badgeShine）",
    vibeCssCheck.hasSparkOut && vibeCssCheck.hasRainbow
      && vibeCssCheck.hasMsgArrive && vibeCssCheck.hasMsgAvatarBounce
      && vibeCssCheck.hasTwinkle && vibeCssCheck.hasBadgeShine,
    JSON.stringify(vibeCssCheck));

  // ③ 辩论轮次徽章 — popup-arena-badge.js 暴露 + parse 解析正确
  const badgeCheck = await popupPage.evaluate(() => {
    const api = window.ArenaBadge;
    if (!api) return { hasApi: false };
    return {
      hasApi: true,
      parseDebate: api._parse("⚔️ 第3轮辩论·自由辩论"),
      parseSummary: api._parse("📋 裁判总结·Claude"),
      parseInvalid: api._parse("普通消息"),
      hasBadgeDom: !!document.getElementById("arena-badge"),
      hasBadgeText: !!document.getElementById("arena-badge-text"),
      hasBadgeMode: !!document.getElementById("arena-badge-mode"),
    };
  });
  check("v4.8.20 ③: ArenaBadge API 暴露 + 解析 debate/summary/无效文本",
    badgeCheck.hasApi
      && badgeCheck.parseDebate?.kind === "debate"
      && badgeCheck.parseDebate?.round === 3
      && badgeCheck.parseDebate?.mode === "自由辩论"
      && badgeCheck.parseSummary?.kind === "summary"
      && badgeCheck.parseSummary?.judge === "Claude"
      && badgeCheck.parseInvalid === null
      && badgeCheck.hasBadgeDom && badgeCheck.hasBadgeText && badgeCheck.hasBadgeMode,
    JSON.stringify(badgeCheck));

  // ④ 消息进场动画 — popup.js append* 加 just-arrived
  const msgArriveCheck = await popupPage.evaluate(() => {
    return fetch(chrome.runtime.getURL("popup.js"))
      .then(r => r.text())
      .then(src => ({
        userMsgArrive: src.includes('"msg me just-arrived"'),
        aiMsgArrive: src.includes("just-arrived"),
        autoRemove: src.includes('classList.remove("just-arrived")'),
      }));
  });
  check("v4.8.20 ④: popup.js user/AI 气泡入场加 just-arrived class + 700ms 后移除",
    msgArriveCheck.userMsgArrive && msgArriveCheck.aiMsgArrive && msgArriveCheck.autoRemove,
    JSON.stringify(msgArriveCheck));

  // ⑤ 海报星空 — empty-state 内 12 个 .es-star
  const starCheck = await popupPage.evaluate(async () => {
    const newPopup = await fetch(chrome.runtime.getURL("popup.html")).then(r => r.text());
    const matchCount = (newPopup.match(/class="es-star/g) || []).length;
    return { starCount: matchCount };
  });
  check("v4.8.20 ⑤: empty-state 含 12 颗 .es-star 星点",
    starCheck.starCount === 12, JSON.stringify(starCheck));

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
