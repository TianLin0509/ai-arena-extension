// tests/e2e/real-debate.mjs
// 真实辩论 E2E：用系统 Chrome.exe + 隔离 profile（含登录态）+ 加载 AI Arena 扩展
// 测试场景：并列/Tab 模式 × 同时提问/自由辩论
//
// 跳过 Claude（防封号）
//
// 用法：
//   node tests/e2e/setup-real-profile.mjs           # 一次性：复制 profile 非锁文件
//   node tests/e2e/copy-cookies-on-close.mjs        # 一次性：关 Chrome 复制 cookies
//   node tests/e2e/real-debate.mjs login-check      # 验证登录态
//   node tests/e2e/real-debate.mjs scenario1        # 场景 1
//   ...

import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const EXT_PATH = path.join(PROJECT_ROOT, "src");
const USER_DATA_DIR = path.join(__dirname, ".userdata");
const ARTIFACTS = path.join(PROJECT_ROOT, ".arena", "artifacts", "real-debate");
const CHROME_EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

fs.mkdirSync(ARTIFACTS, { recursive: true });

const MODE = (process.argv[2] || "login-check").toLowerCase();

// v5.0.16: 允许 E2E_SERVICES=deepseek,kimi 覆盖场景默认参与者（按当晚登录态选可用站点）
const ENV_SERVICES = (process.env.E2E_SERVICES || "").split(",").map(s => s.trim()).filter(Boolean);

// 8 个 AI 站（跳过 Claude）+ 登录态探针 selector
const AI_PROBES = [
  { name: "gemini",   url: "https://gemini.google.com/app",        loggedInProbe: 'rich-textarea, [contenteditable="true"]', loginProbe: 'a[href*="accounts.google.com"]' },
  { name: "chatgpt",  url: "https://chatgpt.com/",                  loggedInProbe: '#prompt-textarea, textarea[name="prompt-textarea"]', loginProbe: 'button:has-text("Log in"), button:has-text("登录")' },
  { name: "deepseek", url: "https://chat.deepseek.com/",            loggedInProbe: '#chat-input, textarea', loginProbe: 'button:has-text("登录"), button:has-text("Log in")' },
  { name: "doubao",   url: "https://www.doubao.com/chat/",          loggedInProbe: 'textarea[data-testid="chat_input_input"], textarea', loginProbe: 'button:has-text("登录"), [class*="login"]' },
  { name: "qwen",     url: "https://www.qianwen.com/",              loggedInProbe: 'textarea, [contenteditable="true"]', loginProbe: 'button:has-text("登录")' },
  { name: "kimi",     url: "https://www.kimi.com/",                 loggedInProbe: 'textarea, [contenteditable="true"]', loginProbe: 'button:has-text("登录"), button:has-text("立即体验")' },
  { name: "yuanbao",  url: "https://yuanbao.tencent.com/",          loggedInProbe: 'textarea, [contenteditable="true"]', loginProbe: 'button:has-text("登录")' },
  { name: "grok",     url: "https://grok.com/",                     loggedInProbe: 'textarea, [contenteditable="true"]', loginProbe: 'button:has-text("Sign"), button:has-text("Log")' },
];

function nowTs() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

async function launchCtx() {
  const args = [
    `--disable-extensions-except=${EXT_PATH}`,
    `--load-extension=${EXT_PATH}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
    "--start-maximized",
  ];
  console.log(`[real-debate] 用 Chrome.exe: ${CHROME_EXE}`);
  console.log(`[real-debate] profile: ${USER_DATA_DIR}`);
  console.log(`[real-debate] 扩展: ${EXT_PATH}`);

  if (!fs.existsSync(CHROME_EXE)) {
    throw new Error(`Chrome.exe 不存在：${CHROME_EXE}`);
  }
  if (!fs.existsSync(path.join(USER_DATA_DIR, "Local State"))) {
    throw new Error(`profile 未准备好，先跑 setup-real-profile.mjs`);
  }

  // Chrome 138+ 禁止命令行加载 unpacked extension（Secure Preferences 重置 developer_mode）
  // 故用 Playwright 自带 chromium。代价：App-Bound encryption 的 cookies 可能解不开
  // 但 session cookies / 旧版加密 cookies 仍可用
  const useChrome = process.env.USE_CHROME === "1";
  if (useChrome) {
    return chromium.launchPersistentContext(USER_DATA_DIR, {
      executablePath: CHROME_EXE,
      headless: false,
      args,
      viewport: null,
      ignoreDefaultArgs: ["--enable-automation"],
    });
  }
  return chromium.launchPersistentContext(USER_DATA_DIR, {
    channel: "chromium",
    headless: false,
    args,
    viewport: null,
    ignoreDefaultArgs: ["--enable-automation"],
  });
}

async function getExtensionId(context) {
  let [sw] = context.serviceWorkers();
  if (!sw) {
    console.log("[real-debate] 等待 service worker (60s)...");
    try {
      sw = await context.waitForEvent("serviceworker", { timeout: 60000 });
    } catch (e) {
      // 诊断：打开 chrome://extensions 看扩展状态
      console.log("[real-debate] SW 未起，诊断 chrome://extensions");
      const p = await context.newPage();
      try {
        await p.goto("chrome://extensions/", { timeout: 10000 });
        await p.waitForTimeout(2000);
        const ssPath = path.join(ARTIFACTS, `extensions-page-${nowTs()}.png`);
        await p.screenshot({ path: ssPath, fullPage: true });
        console.log("[real-debate] 截图: " + ssPath);
        const html = await p.content();
        console.log("[real-debate] chrome://extensions HTML 长度: " + html.length);
        const arenaIdx = html.indexOf("AI Arena");
        console.log("[real-debate] 'AI Arena' 出现位置: " + arenaIdx);
      } catch (err) {
        console.log("[real-debate] 诊断失败: " + err.message);
      }
      throw e;
    }
  }
  return sw.url().split("/")[2];
}

// 检测一个 AI 站是否已登录
async function checkOneLogin(context, probe) {
  const page = await context.newPage();
  const result = { name: probe.name, url: probe.url, status: "unknown", err: null, screenshotPath: null };
  try {
    await page.goto(probe.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(4000);  // 让 SPA 自动重定向

    const finalUrl = page.url();
    const hasLoggedInProbe = await page.locator(probe.loggedInProbe).first().isVisible({ timeout: 2000 }).catch(() => false);
    const hasLoginProbe = await page.locator(probe.loginProbe).first().isVisible({ timeout: 2000 }).catch(() => false);
    const urlHasLogin = /login|signin|sign-in|accounts\.google/i.test(finalUrl);

    const ssPath = path.join(ARTIFACTS, `login-${probe.name}-${nowTs()}.png`);
    await page.screenshot({ path: ssPath, fullPage: false });
    result.screenshotPath = ssPath;

    if (urlHasLogin) result.status = "redirected-to-login";
    else if (hasLoggedInProbe && !hasLoginProbe) result.status = "logged-in";
    else if (hasLoggedInProbe && hasLoginProbe) result.status = "ambiguous";
    else if (hasLoginProbe) result.status = "needs-login";
    else result.status = "selector-miss";

    result.finalUrl = finalUrl;
  } catch (e) {
    result.err = e.message;
    result.status = "error";
  } finally {
    await page.close().catch(() => {});
  }
  return result;
}

async function loginCheck() {
  const context = await launchCtx();
  const extId = await getExtensionId(context);
  console.log(`[real-debate] extension ID: ${extId}`);

  const results = [];
  for (const probe of AI_PROBES) {
    process.stdout.write(`[real-debate] 检查 ${probe.name}... `);
    const r = await checkOneLogin(context, probe);
    results.push(r);
    const icon = r.status === "logged-in" ? "✓"
               : r.status === "needs-login" || r.status === "redirected-to-login" ? "✗"
               : "?";
    console.log(`${icon} ${r.status} → ${r.finalUrl || r.err}`);
  }

  // 报告
  const report = {
    timestamp: nowTs(),
    extId,
    results,
  };
  const reportPath = path.join(ARTIFACTS, `login-report-${nowTs()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n[real-debate] 报告: ${reportPath}`);

  const loggedInCount = results.filter(r => r.status === "logged-in").length;
  console.log(`[real-debate] 登录态摘要: ${loggedInCount}/${AI_PROBES.length} 已登录`);
  console.log(`[real-debate] 详情:`);
  for (const r of results) {
    console.log(`  - ${r.name.padEnd(10)} ${r.status.padEnd(22)} ${r.finalUrl || r.err || ""}`);
  }

  await context.close();
  process.exit(loggedInCount > 0 ? 0 : 1);
}

// ============ 通用：从 sidepanel page 调 background handler ============
async function callBG(sidepanelPage, type, payload = {}) {
  return await sidepanelPage.evaluate(({ type, payload }) =>
    new Promise(resolve => chrome.runtime.sendMessage({ type, ...payload }, resolve)),
    { type, payload }
  );
}

// 打开扩展 sidepanel 作为控制面板（chrome-extension://<id>/sidepanel.html）
async function openSidepanel(context, extId) {
  const p = await context.newPage();
  await p.goto(`chrome-extension://${extId}/sidepanel.html`);
  await p.waitForLoadState("domcontentloaded");
  return p;
}

// 收集 background SW console log
function attachSwLogger(context, label = "sw") {
  const logs = [];
  for (const sw of context.serviceWorkers()) {
    sw.on("console", msg => logs.push(`[${label}/${msg.type()}] ${msg.text()}`));
  }
  context.on("serviceworker", sw => {
    sw.on("console", msg => logs.push(`[${label}/${msg.type()}] ${msg.text()}`));
  });
  return logs;
}

// 等 participants 数组里所有 p.responsePreview 都非空
// 注意：getFullState 只返回 responsePreview（前 100 字），不返回完整 response
async function waitForAllResponses(sidepanelPage, expectedCount, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await callBG(sidepanelPage, "getState");
    const ps = state?.participants || [];
    const have = ps.filter(p => p.responsePreview && p.responsePreview.trim()).length;
    if (have >= expectedCount) return { ok: true, ps, elapsed: Date.now() - start };
    await sidepanelPage.waitForTimeout(2000);
  }
  const state = await callBG(sidepanelPage, "getState");
  return { ok: false, ps: state?.participants || [], elapsed: Date.now() - start };
}

// ============ 场景 1：并列 + 同时提问 ============
async function scenario1() {
  const context = await launchCtx();
  const extId = await getExtensionId(context);
  const swLogs = attachSwLogger(context, "sw");
  console.log(`[scenario1] ext=${extId}`);
  const panel = await openSidepanel(context, extId);

  // 收集 sidepanel console
  panel.on("console", msg => swLogs.push(`[panel/${msg.type()}] ${msg.text()}`));
  panel.on("pageerror", e => swLogs.push(`[panel/pageerror] ${e.message}`));

  // 1) hardReset + 切并列
  await callBG(panel, "hardReset");
  await panel.waitForTimeout(2000);
  await callBG(panel, "setWindowMode", { mode: "tiled" });
  console.log(`[scenario1] hardReset + mode=tiled OK`);

  // 2) 加参与 AI（默认 gemini+deepseek，可用 E2E_SERVICES 覆盖）
  const services = ENV_SERVICES.length ? ENV_SERVICES : ["gemini", "deepseek"];
  const addedIds = [];
  for (const s of services) {
    const r = await callBG(panel, "addParticipant", { service: s });
    const ps = r?.participants || [];
    const newOne = ps.find(p => p.service === s && !addedIds.includes(p.id));
    if (newOne) addedIds.push(newOne.id);
    console.log(`[scenario1] addParticipant ${s} → ok=${r?.ok} pid=${newOne?.id}`);
    await panel.waitForTimeout(1500);  // 给窗口创建时间
  }

  // 等 AI 窗口启动 + 登录态加载
  console.log(`[scenario1] 等 8 秒让 AI 页加载...`);
  await panel.waitForTimeout(8000);

  // 3) 发问
  const question = "用一句话解释什么是张量（tensor）？回答控制在 50 字以内。";
  console.log(`[scenario1] broadcast: ${question}`);
  const br = await callBG(panel, "chatBroadcast", { text: question, targets: services, images: [] });
  console.log(`[scenario1] broadcast result: ${JSON.stringify(br).slice(0, 200)}`);

  // 4) 等所有回答
  console.log(`[scenario1] 等回答（90s）...`);
  const wr = await waitForAllResponses(panel, services.length, 90000);
  console.log(`[scenario1] elapsed=${wr.elapsed}ms ok=${wr.ok}`);
  for (const p of wr.ps) {
    const len = p.responsePreview?.length || 0;
    console.log(`  ${p.service.padEnd(10)} len=${String(len).padStart(4)} ${len > 0 ? "✓" : "✗"}`);
  }

  // 5) 截图 + log dump
  const ssDir = path.join(ARTIFACTS, `scenario1-${nowTs()}`);
  fs.mkdirSync(ssDir, { recursive: true });
  await panel.screenshot({ path: path.join(ssDir, "sidepanel.png"), fullPage: true });
  // 给所有 AI tab 截图
  for (const p of context.pages()) {
    if (p === panel) continue;
    const url = p.url();
    const host = url.replace(/^https?:\/\//, "").split("/")[0].replace(/[^a-z0-9]/gi, "_");
    try { await p.screenshot({ path: path.join(ssDir, `tab-${host}.png`), fullPage: false }); } catch {}
  }
  fs.writeFileSync(path.join(ssDir, "sw-logs.txt"), swLogs.join("\n"));
  fs.writeFileSync(path.join(ssDir, "result.json"), JSON.stringify({ ok: wr.ok, elapsed: wr.elapsed, participants: wr.ps }, null, 2));

  // 收集错误
  const errors = swLogs.filter(l => /error|fail|warn/i.test(l));
  console.log(`\n[scenario1] sw 日志错误数: ${errors.length}`);
  errors.slice(0, 20).forEach(e => console.log("  " + e));

  console.log(`\n[scenario1] 工件目录: ${ssDir}`);
  await context.close();
  return wr.ok ? 0 : 1;
}

// ============ 场景 2：并列 + 自由辩论 ============
// 完整辩论流程：初始回答 → 2 轮辩论 → 裁判总结
// 验证 F31/F35/F36/F39 修复，覆盖辩论轮统计、第二次发问、mini bar
async function scenario2(opts = {}) {
  const services = opts.services || (ENV_SERVICES.length ? ENV_SERVICES : ["gemini", "deepseek"]);
  const debateRounds = opts.rounds || 2;
  const judgeService = opts.judgeId || services[0];

  const context = await launchCtx();
  const extId = await getExtensionId(context);
  const swLogs = attachSwLogger(context, "sw");
  console.log(`[scenario2] ext=${extId} services=${services.join("+")} rounds=${debateRounds}`);
  const panel = await openSidepanel(context, extId);
  panel.on("console", msg => swLogs.push(`[panel/${msg.type()}] ${msg.text()}`));
  panel.on("pageerror", e => swLogs.push(`[panel/pageerror] ${e.message}`));

  await callBG(panel, "hardReset");
  await panel.waitForTimeout(2000);
  await callBG(panel, "setWindowMode", { mode: "tiled" });

  const addedIds = [];
  for (const s of services) {
    const r = await callBG(panel, "addParticipant", { service: s });
    const ps = r?.participants || [];
    const newOne = ps.find(p => p.service === s && !addedIds.includes(p.id));
    if (newOne) addedIds.push(newOne.id);
    console.log(`[scenario2] add ${s} → ok=${r?.ok} id=${newOne?.id}`);
    await panel.waitForTimeout(1500);
  }
  await panel.waitForTimeout(8000);

  // 初始问题
  const q0 = "下面有 3 个选项：A) 优先扩张市场份额，B) 优先保证产品质量，C) 优先盈利。一个 5 人初创公司应该选哪个？请简短论证（200 字以内）。";
  console.log(`[scenario2] 初始问题: ${q0.slice(0, 50)}...`);
  await callBG(panel, "chatBroadcast", { text: q0, targets: services, images: [] });
  let wr = await waitForAllResponses(panel, services.length, 90000);
  console.log(`[scenario2] init responses ok=${wr.ok} elapsed=${wr.elapsed}ms`);

  // 辩论轮
  for (let i = 0; i < debateRounds; i++) {
    console.log(`[scenario2] === 辩论第 ${i + 1} 轮 ===`);
    const dr = await callBG(panel, "debateRound", { style: "free", guidance: "", concise: false });
    console.log(`[scenario2] debateRound ${i + 1} dispatch → ${JSON.stringify(dr).slice(0, 100)}`);
    wr = await waitForAllResponses(panel, services.length, 120000);
    console.log(`[scenario2] round ${i + 1} ok=${wr.ok} elapsed=${wr.elapsed}ms`);
  }

  // 裁判总结：addedIds 是 "p1", "p2" 之类，要用 service 反查
  console.log(`[scenario2] === 裁判总结 ===`);
  const stForJudge = await callBG(panel, "getState");
  const judgeP = (stForJudge?.participants || []).find(p => p.service === judgeService);
  const judgeId = judgeP?.id || addedIds[0];
  const sumR = await callBG(panel, "summary", { judgeId, customInstruction: "", format: "" });
  console.log(`[scenario2] summary dispatch → ${JSON.stringify(sumR).slice(0, 100)}`);
  // summary 完成检测：等 judge participant 的 responsePreview 非空
  // 注：getFullState 只返回 responsePreview (≤100 字)，所以阈值改为 >5
  let sumOk = false;
  for (let i = 0; i < 60; i++) {
    const st = await callBG(panel, "getState");
    const judge = (st?.participants || []).find(p => p.id === judgeId);
    if (judge?.responsePreview && judge.responsePreview.length > 5) { sumOk = true; break; }
    await panel.waitForTimeout(2000);
  }
  console.log(`[scenario2] summary ok=${sumOk}`);

  // 截图 + dump
  const ssDir = path.join(ARTIFACTS, `scenario2-${nowTs()}`);
  fs.mkdirSync(ssDir, { recursive: true });
  await panel.screenshot({ path: path.join(ssDir, "sidepanel.png"), fullPage: true });
  for (const p of context.pages()) {
    if (p === panel) continue;
    const host = p.url().replace(/^https?:\/\//, "").split("/")[0].replace(/[^a-z0-9]/gi, "_");
    try { await p.screenshot({ path: path.join(ssDir, `tab-${host}.png`), fullPage: false }); } catch {}
  }
  const final = await callBG(panel, "getState");
  fs.writeFileSync(path.join(ssDir, "final-state.json"), JSON.stringify(final, null, 2));
  fs.writeFileSync(path.join(ssDir, "sw-logs.txt"), swLogs.join("\n"));

  // 关键诊断
  const errors = swLogs.filter(l => /error|fail/i.test(l) && !/lastError consumed/.test(l));
  console.log(`\n[scenario2] sw 错误数: ${errors.length}`);
  errors.slice(0, 30).forEach(e => console.log("  " + e));

  console.log(`\n[scenario2] 工件: ${ssDir}`);
  await context.close();
  return sumOk ? 0 : 1;
}

// ============ 场景 3：Tab 模式 + 后台辩论（F37/F38 重点）============
// qwen 在 Tab 模式后台时会被反爬强制登录拦截，不带 qwen
async function scenario3() {
  const services = ["gemini", "deepseek"];
  const context = await launchCtx();
  const extId = await getExtensionId(context);
  const swLogs = attachSwLogger(context, "sw");
  console.log(`[scenario3] ext=${extId} Tab 模式后台辩论`);
  const panel = await openSidepanel(context, extId);
  panel.on("console", msg => swLogs.push(`[panel/${msg.type()}] ${msg.text()}`));
  panel.on("pageerror", e => swLogs.push(`[panel/pageerror] ${e.message}`));

  // hardReset + 切到 tab 模式（CDP attach 路径）
  await callBG(panel, "hardReset");
  await panel.waitForTimeout(2000);
  await callBG(panel, "setWindowMode", { mode: "tab" });
  console.log(`[scenario3] hardReset + mode=tab OK`);

  for (const s of services) {
    const r = await callBG(panel, "addParticipant", { service: s });
    console.log(`[scenario3] add ${s} → ${JSON.stringify(r).slice(0, 100)}`);
    await panel.waitForTimeout(1500);
  }
  await panel.waitForTimeout(10000);

  // 把 panel 自己置顶（让 AI tab 都在后台）
  await panel.bringToFront();
  console.log(`[scenario3] panel 置顶 -> AI tabs 进后台`);

  const q0 = "什么是 React fiber？请用 100 字以内说明核心思想。";
  await callBG(panel, "chatBroadcast", { text: q0, targets: services, images: [] });
  console.log(`[scenario3] 后台广播 ${q0.slice(0, 30)}...`);

  // 重要：不能切回去 - 验证 CDP 后台也能提取
  const wr = await waitForAllResponses(panel, services.length, 120000);
  console.log(`[scenario3] ok=${wr.ok} elapsed=${wr.elapsed}ms`);
  for (const p of wr.ps) {
    console.log(`  ${p.service.padEnd(10)} len=${p.responsePreview?.length || 0}`);
  }

  const ssDir = path.join(ARTIFACTS, `scenario3-${nowTs()}`);
  fs.mkdirSync(ssDir, { recursive: true });
  await panel.screenshot({ path: path.join(ssDir, "sidepanel.png"), fullPage: true });
  for (const p of context.pages()) {
    if (p === panel) continue;
    const host = p.url().replace(/^https?:\/\//, "").split("/")[0].replace(/[^a-z0-9]/gi, "_");
    try { await p.screenshot({ path: path.join(ssDir, `tab-${host}.png`), fullPage: false }); } catch {}
  }
  fs.writeFileSync(path.join(ssDir, "result.json"), JSON.stringify(wr, null, 2));
  fs.writeFileSync(path.join(ssDir, "sw-logs.txt"), swLogs.join("\n"));

  // 看是否有 attach/detach 异常
  const cdpLogs = swLogs.filter(l => /CDP|debugger|attach|detach/i.test(l));
  console.log(`\n[scenario3] CDP 相关日志数: ${cdpLogs.length}`);
  cdpLogs.slice(0, 30).forEach(l => console.log("  " + l));

  console.log(`\n[scenario3] 工件: ${ssDir}`);
  await context.close();
  return wr.ok ? 0 : 1;
}

// ============ 场景 4：简洁/群策群力 ============
async function scenario4() {
  const services = ["gemini", "deepseek"];
  const context = await launchCtx();
  const extId = await getExtensionId(context);
  const swLogs = attachSwLogger(context, "sw");
  console.log(`[scenario4] ext=${extId}`);
  const panel = await openSidepanel(context, extId);
  panel.on("console", msg => swLogs.push(`[panel/${msg.type()}] ${msg.text()}`));
  panel.on("pageerror", e => swLogs.push(`[panel/pageerror] ${e.message}`));

  // 清场
  await callBG(panel, "hardReset");
  await panel.waitForTimeout(2000);
  await callBG(panel, "setWindowMode", { mode: "tiled" });

  for (const s of services) {
    await callBG(panel, "addParticipant", { service: s });
    await panel.waitForTimeout(1500);
  }
  await panel.waitForTimeout(8000);

  // 1) 简洁模式自由辩论
  const q0 = "AGI 实现路径：扩大模型规模 vs 算法范式革新，哪个更关键？";
  await callBG(panel, "chatBroadcast", { text: q0, targets: services, images: [] });
  let wr = await waitForAllResponses(panel, services.length, 90000);
  console.log(`[scenario4] init ok=${wr.ok}`);

  // 简洁辩论一轮
  console.log(`[scenario4] === 简洁模式辩论 ===`);
  await callBG(panel, "debateRound", { style: "free", guidance: "", concise: true });
  wr = await waitForAllResponses(panel, services.length, 120000);
  console.log(`[scenario4] concise round ok=${wr.ok}`);
  // 验证简洁约束：每个回答都该 < 1500 字
  let allConcise = true;
  for (const p of wr.ps) {
    const len = p.responsePreview?.length || 0;
    if (len > 1500) {
      console.log(`[scenario4] ⚠ ${p.service} 超 1500 字 (${len})`);
      allConcise = false;
    }
  }

  // 2) 群策群力模式（collab）
  console.log(`[scenario4] === 群策群力辩论 ===`);
  await callBG(panel, "debateRound", { style: "collab", guidance: "", concise: false });
  wr = await waitForAllResponses(panel, services.length, 120000);
  console.log(`[scenario4] collab round ok=${wr.ok}`);

  // 3) PPT 工坊：试 pptBuildPrompt
  console.log(`[scenario4] === PPT 工坊 prompt 生成 ===`);
  const pptCopy = await callBG(panel, "pptBuildPrompt", { kind: "copy" });
  const pptImage = await callBG(panel, "pptBuildPrompt", { kind: "image", template: "intro" });
  const pptPptx = await callBG(panel, "pptBuildPrompt", { kind: "pptx" });
  console.log(`[scenario4] ppt copy len=${pptCopy?.prompt?.length || 0} ok=${!!pptCopy?.ok}`);
  console.log(`[scenario4] ppt image len=${pptImage?.prompt?.length || 0} ok=${!!pptImage?.ok}`);
  console.log(`[scenario4] ppt pptx len=${pptPptx?.prompt?.length || 0} ok=${!!pptPptx?.ok}`);

  // 截图 + dump
  const ssDir = path.join(ARTIFACTS, `scenario4-${nowTs()}`);
  fs.mkdirSync(ssDir, { recursive: true });
  await panel.screenshot({ path: path.join(ssDir, "sidepanel.png"), fullPage: true });
  for (const p of context.pages()) {
    if (p === panel) continue;
    const host = p.url().replace(/^https?:\/\//, "").split("/")[0].replace(/[^a-z0-9]/gi, "_");
    try { await p.screenshot({ path: path.join(ssDir, `tab-${host}.png`), fullPage: false }); } catch {}
  }
  fs.writeFileSync(path.join(ssDir, "sw-logs.txt"), swLogs.join("\n"));
  const result = {
    concise: { ok: wr.ok, allConcise },
    ppt: {
      copyLen: pptCopy?.prompt?.length || 0,
      imageLen: pptImage?.prompt?.length || 0,
      pptxLen: pptPptx?.prompt?.length || 0,
    },
  };
  fs.writeFileSync(path.join(ssDir, "result.json"), JSON.stringify(result, null, 2));

  console.log(`\n[scenario4] 工件: ${ssDir}`);
  await context.close();
  return allConcise && pptCopy?.ok ? 0 : 1;
}

// ============ 主入口 ============
(async () => {
  console.log(`[real-debate] 模式: ${MODE}`);
  if (MODE === "login-check") {
    await loginCheck();
  } else if (MODE === "scenario1") {
    const code = await scenario1();
    process.exit(code);
  } else if (MODE === "scenario2") {
    const code = await scenario2();
    process.exit(code);
  } else if (MODE === "scenario3") {
    const code = await scenario3();
    process.exit(code);
  } else if (MODE === "scenario4") {
    const code = await scenario4();
    process.exit(code);
  } else {
    console.error(`未知模式: ${MODE}`);
    console.error(`可用：login-check | scenario1 | scenario2 | scenario3 | scenario4`);
    process.exit(2);
  }
})().catch(e => {
  console.error("[real-debate] FATAL:", e);
  process.exit(99);
});
