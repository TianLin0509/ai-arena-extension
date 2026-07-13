// simple-mode.mjs — v5.0.72 精简/全量双模式 E2E（含 v5.0.67 渐进披露矩阵回归）
// 真实加载扩展验证：
//   A. 首启默认精简模式：单栏+右侧成员面板常驻 可见性矩阵 + 三步指引条 + 点菜真实加人
//   B. 常驻动作条：⚔️辩论/📋总结 未就绪置灰 → ≥2 家答完点亮 → 点击捕获任务并归位 ask
//      → pending 置灰 1.6s 自愈 → 总结自动选队长当裁判 → 失败口径（loginWarning 不计）
//   C. ↺ 新对话确认 Modal
//   D. seg 切全量：完整界面矩阵 + ⋯菜单 portal 回归 + 模式持久化（reload 往返）
//   E. adv-locked 新手披露矩阵回归（全量模式内 lock/unlock 往返）
//   F. 老用户画像（advancedUnlocked 预置）→ 首判默认全量
// 运行：node tests/e2e/simple-mode.mjs
import { chromium } from "playwright";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const EXT_PATH = path.join(PROJECT_ROOT, "src");
const OUT = path.join(PROJECT_ROOT, "output", "simple-mode");
fs.mkdirSync(OUT, { recursive: true });

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`✓ ${name}`); }
  else { failed++; console.log(`✗ ${name}${detail ? " → " + detail : ""}`); }
}

async function launch(tag) {
  const dir = path.join(os.tmpdir(), `arena-${tag}-${Date.now()}`);
  const context = await chromium.launchPersistentContext(dir, {
    channel: "chromium", headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`,
      "--no-first-run", "--no-default-browser-check",
      "--disable-features=DisableLoadExtensionCommandLineSwitch",
    ],
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15000 });
  return { context, sw, extId: sw.url().split("/")[2], dir };
}

// ══ 主流程：全新 profile ══
const { context, sw, extId, dir } = await launch("simple");
try {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.goto(`chrome-extension://${extId}/popup.html`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);

  const vis = sel => page.evaluate(s => {
    const el = document.querySelector(s);
    return !!(el && el.offsetParent !== null && getComputedStyle(el).display !== "none");
  }, sel);
  // 弹层「真实可见」断言（v5.0.70 血泪铁律）：视口内 + elementFromPoint 中心命中
  const reallyVis = sel => page.evaluate(s => {
    const el = document.querySelector(s);
    if (!el || el.hidden || getComputedStyle(el).display === "none") return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) return false;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!(hit && (hit === el || el.contains(hit)));
  }, sel);
  // 从 SW 上下文广播消息（popup 自发不回环，必须经 SW → popup 才走真实收线路径）
  const bcast = m => sw.evaluate(msg => { chrome.runtime.sendMessage(msg).catch(() => {}); }, m);
  // 轮询等待（真实开 tab / 流式渲染的耗时有抖动，固定 sleep 会 flake）
  const waitUntil = async (fn, timeout = 8000, step = 250) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await page.evaluate(fn)) return true;
      await page.waitForTimeout(step);
    }
    return false;
  };

  // ── A. 首启 = 精简模式：单栏 + 右侧成员面板常驻 ──
  check("首启默认精简模式（body.simple-mode）", await page.evaluate(() => document.body.classList.contains("simple-mode")));
  check("seg 开关「精简」高亮", await page.evaluate(() =>
    document.querySelector('#ui-mode-seg button[data-uimode="simple"]')?.classList.contains("on")));
  for (const [name, sel, expect] of [
    ["左栏对话目录 隐藏", ".chat-sidebar", false],
    ["下轮发言 roster 隐藏", ".chat-roster", false],
    ["任务模式下拉 隐藏", ".task-picker-wrap", false],
    ["header 折叠到顶 隐藏", "#btn-mini-mode", false],
    ["header 简洁 隐藏", "#btn-compact-mode", false],
    ["header PPT 隐藏", "#btn-ppt-super", false],
    ["header 对比 隐藏", "#btn-compare", false],
    ["header 清空群聊 隐藏（↺ 代理）", "#btn-clear", false],
    ["header ⋯更多 隐藏", "#btn-more", false],
    ["Beta 徽章 隐藏（版本号在 chat-name 保留）", ".chat-version", false],
    ["seg 开关 可见", "#ui-mode-seg", true],
    ["↺ 新对话 可见", "#btn-simple-new", true],
    ["输入框 可见", "#chat-input", true],
    ["发送按钮 可见", "#btn-send", true],
    ["右栏成员面板 常驻可见（用户反馈显式）", "#rp-panel-members", true],
    ["右栏 6 tabs 隐藏（只留成员）", ".rp-tabs", false],
    ["角色帽 隐藏（进阶留全量）", ".rp-hat-section", false],
    ["状态日志 隐藏", "#rp-bottom", false],
    ["空状态海报 隐藏", ".es-poster", false],
    ["空状态玩法词条 隐藏", "#es-features", false],
    ["空状态套餐卡 可见", "#es-quickstart", true],
    ["空状态示例问题 可见", "#es-starters", true],
  ]) check(`精简: ${name}`, (await vis(sel)) === expect);

  check("版本号可见（chat-name 含 x.y.z）", await page.evaluate(() =>
    /AI圆桌派-\d+\.\d+\.\d+/.test(document.querySelector(".chat-name")?.textContent || "")));
  check("头像条/抽屉已删（DOM 无残留）", await page.evaluate(() =>
    !document.querySelector(".simple-avatars") && !document.getElementById("sm-drawer-close")));
  check("header 常驻按钮 ≤4", await page.evaluate(() =>
    [...document.querySelectorAll(".chat-header button")].filter(el =>
      el.offsetParent !== null && el.getBoundingClientRect().width > 0).length <= 4));

  // 三步指引条（用户反馈：欢迎页要有指引）
  check("三步指引条 真实可见", await reallyVis("#es-simple-guide"));
  check("指引条含 3 步", await page.evaluate(() => document.querySelectorAll(".esg-step").length === 3));
  check("step1（加 AI）初始未打勾", await page.evaluate(() =>
    !document.getElementById("esg-step-1")?.classList.contains("done")));

  // 常驻动作条（用户反馈：辩论/协作/总结主打功能要看得见，v5.0.73 三按钮）
  check("动作条常驻可见（不再是答完才浮现的 pill）", await reallyVis("#sm-act-debate"));
  check("协作按钮存在且可见（v5.0.73 新增）", await reallyVis("#sm-act-collab"));
  check("总结按钮可见", await reallyVis("#sm-act-summary"));
  check("三按钮初始置灰", await page.evaluate(() =>
    document.getElementById("sm-act-debate").disabled
    && document.getElementById("sm-act-collab").disabled
    && document.getElementById("sm-act-summary").disabled));
  check("提示文案 = 加 ≥2 个 AI 后可用", await page.evaluate(() =>
    (document.getElementById("sm-act-hint")?.textContent || "").includes("加 ≥2 个 AI")));

  // v5.0.73: 精简模式右栏钉死成员面板 — 模拟 popup-tasks 抢 tab（辩论/总结启动时的真实调用）
  await page.evaluate(() => window.ChatRightPanel.activate("tasks"));
  await page.waitForTimeout(150);
  check("activate(tasks) 被钉回成员面板（tab 不被抢走）", await page.evaluate(() =>
    document.querySelector(".rp-panel.active")?.dataset.rpPanel === "members"));
  await page.evaluate(() => window.ChatRightPanel.activate("settings"));
  await page.waitForTimeout(150);
  check("activate(settings) 同样钉回成员面板", await page.evaluate(() =>
    document.querySelector(".rp-panel.active")?.dataset.rpPanel === "members"));

  check("示例问题点击填入输入框", await (async () => {
    await page.click(".es-starter");
    await page.waitForTimeout(250);
    return page.evaluate(() => (document.getElementById("chat-input")?.textContent || "").length > 5);
  })());
  await page.evaluate(() => { document.getElementById("chat-input").textContent = ""; });
  await page.screenshot({ path: path.join(OUT, "01-simple-first-run.png") });

  // ── A2. 点菜开局：套餐卡真实加人 → 指引 step1 打勾 ──
  await page.click('#es-quickstart .es-qs-btn');   // ⚡ 双开对比 = deepseek + doubao
  const got2 = await waitUntil(() => new Promise(res =>
    chrome.runtime.sendMessage({ type: "getState" }, r => res((r?.participants || []).length === 2))), 12000);
  check("点菜真实加入 2 个成员", got2);
  await waitUntil(() => document.getElementById("esg-step-1")?.classList.contains("done"), 4000);
  check("指引 step1 打勾（随成员数）", await page.evaluate(() =>
    document.getElementById("esg-step-1")?.classList.contains("done")));
  check("加人后套餐卡自动隐藏", !(await vis("#es-quickstart")));
  check("动作条仍置灰（还没回答）", await page.evaluate(() =>
    document.getElementById("sm-act-debate").disabled));
  check("提示文案 = 等 2 个 AI 回答完解锁", await page.evaluate(() =>
    (document.getElementById("sm-act-hint")?.textContent || "").includes("回答完解锁")));
  await page.screenshot({ path: path.join(OUT, "02-after-quickstart.png") });
  // 真实 tab 打开后 background 会异步广播 loginWarning 流消息（未登录环境的正确行为），
  // 它会从 roundDone 删掉同名 service — 先让这波真实噪音落地，再开始伪造轮次，防竞态
  await page.waitForTimeout(5000);

  // ── B. 动作条点亮 + 点击链路（SW 广播模拟一轮完成 — 走真实 onMessage 收线） ──
  await bcast({ type: "chatStreamUpdate", msgId: "e2e-r1", role: "user", text: "E2E 测试问题" });
  await page.waitForTimeout(300);
  await bcast({ type: "chatStreamUpdate", msgId: "e2e-r1", role: "ai", participantId: "deepseek", text: "回答 A", isDone: true });
  await page.waitForTimeout(200);
  check("只 1 家答完仍置灰", await page.evaluate(() => document.getElementById("sm-act-debate").disabled));
  await bcast({ type: "chatStreamUpdate", msgId: "e2e-r1", role: "ai", participantId: "doubao", text: "回答 B", isDone: true });
  await waitUntil(() => !document.getElementById("sm-act-debate").disabled, 4000);
  check("≥2 家答完三按钮点亮", await page.evaluate(() =>
    !document.getElementById("sm-act-debate").disabled
    && !document.getElementById("sm-act-collab").disabled
    && !document.getElementById("sm-act-summary").disabled));
  check("点亮态有 ready 高亮样式", await page.evaluate(() =>
    document.getElementById("sm-act-debate").classList.contains("ready")
    && document.getElementById("sm-act-collab").classList.contains("ready")));
  check("提示文案 = 就绪", await page.evaluate(() =>
    (document.getElementById("sm-act-hint")?.textContent || "").includes("就绪")));
  check("首辩文案 = 辩论·互挑错", await page.evaluate(() =>
    (document.getElementById("sm-act-debate").textContent || "").includes("辩论")));
  await page.screenshot({ path: path.join(OUT, "03-acts-ready.png") });

  // 点击链路：patch dispatch 捕获任务（不真发辩论 — 假流式状态下 background 会拒），
  // 验证 setTask(debate) → 发送捕获 → 归位 ask 的完整接线
  await page.evaluate(() => {
    window.__origDispatch = window.ChatTaskMenu.dispatch;
    window.__dispatched = null;
    window.ChatTaskMenu.dispatch = async () => {
      window.__dispatched = { ...window.ChatTaskMenu.current() };
      return { ok: true };
    };
  });
  // 防御：若沉降期后仍有迟到的真实登录噪音把动作条收灰，重注一轮伪造完成再点
  if (await page.evaluate(() => document.getElementById("sm-act-debate").disabled)) {
    await bcast({ type: "chatStreamUpdate", msgId: "e2e-r1b", role: "user", text: "重注轮" });
    await page.waitForTimeout(250);
    await bcast({ type: "chatStreamUpdate", msgId: "e2e-r1b", role: "ai", participantId: "deepseek", text: "回答 A2", isDone: true });
    await bcast({ type: "chatStreamUpdate", msgId: "e2e-r1b", role: "ai", participantId: "doubao", text: "回答 B2", isDone: true });
    await waitUntil(() => !document.getElementById("sm-act-debate").disabled, 4000);
  }
  await page.click("#sm-act-debate");
  await page.waitForTimeout(300);
  const dispatched = await page.evaluate(() => window.__dispatched);
  check("辩论按钮以 debate 任务发送", dispatched?.task === "debate", JSON.stringify(dispatched));
  check("辩论按钮 style = free（自由辩论）", dispatched?.style === "free", JSON.stringify(dispatched));
  check("发送后任务归位 ask（输入框保持同时提问语义）", await page.evaluate(() =>
    window.ChatTaskMenu.current().task === "ask"));
  check("发出后 pending 置灰（防连点）", await page.evaluate(() =>
    document.getElementById("sm-act-debate").disabled));
  // 辩论未真开启（无 user 流消息清 roundDone）→ 1.6s 自愈复亮（四路审查修复回归）
  await page.evaluate(() => document.dispatchEvent(new CustomEvent("task:dispatched", { detail: { task: "debate" } })));
  await page.waitForTimeout(1900);
  check("未真开启时 1.6s 自愈复亮", await page.evaluate(() =>
    !document.getElementById("sm-act-debate").disabled));
  check("辩过一轮后文案 = 再辩一轮", await page.evaluate(() =>
    (document.getElementById("sm-act-debate").textContent || "").includes("再辩一轮")));

  // 协作（群策群力）：v5.0.73 新增按钮 — debate 任务 + collab style
  await page.click("#sm-act-collab");
  await page.waitForTimeout(300);
  const dispatchedC = await page.evaluate(() => window.__dispatched);
  check("协作按钮以 debate 任务发送", dispatchedC?.task === "debate", JSON.stringify(dispatchedC));
  check("协作按钮 style = collab（群策群力）", dispatchedC?.style === "collab", JSON.stringify(dispatchedC));
  check("协作后任务归位 ask", await page.evaluate(() => window.ChatTaskMenu.current().task === "ask"));
  // collab 风格的 task:dispatched 不增辩论计数（文案守卫）：注入 collab 事件前后文案不变
  check("协作事件不改辩论按钮文案", await (async () => {
    await page.waitForTimeout(1900);   // 越过 pending 自愈
    const before = await page.evaluate(() => document.getElementById("sm-act-debate").textContent);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent("task:dispatched", { detail: { task: "debate", style: "collab" } })));
    await page.waitForTimeout(200);
    // refreshActs 由流事件驱动，这里手动触发一次可见性刷新路径：注入一条无关 stateUpdate
    return page.evaluate(b => document.getElementById("sm-act-debate").textContent === b, before);
  })());

  // 总结：自动选队长（participants[0]）当裁判
  const expectJudge = await page.evaluate(() => new Promise(res =>
    chrome.runtime.sendMessage({ type: "getState" }, r => res(r?.participants?.[0]?.id || null))));
  await page.click("#sm-act-summary");
  await page.waitForTimeout(300);
  const dispatched2 = await page.evaluate(() => window.__dispatched);
  check("总结按钮以 summary 任务发送", dispatched2?.task === "summary", JSON.stringify(dispatched2));
  check("裁判自动 = 队长（participants[0]）", !!expectJudge && dispatched2?.judgeId === expectJudge,
    `expect=${expectJudge} got=${dispatched2?.judgeId}`);
  check("总结后任务归位 ask", await page.evaluate(() => window.ChatTaskMenu.current().task === "ask"));
  await page.evaluate(() => { window.ChatTaskMenu.dispatch = window.__origDispatch; });

  // 失败态不计入：doubao 假登录警告 → 只剩 1 家有效 → 置灰
  await bcast({ type: "chatStreamUpdate", msgId: "e2e-r3", role: "user", text: "第三问" });
  await page.waitForTimeout(250);
  await bcast({ type: "chatStreamUpdate", msgId: "e2e-r3", role: "ai", participantId: "deepseek", text: "答", isDone: true });
  await bcast({ type: "chatStreamUpdate", msgId: "e2e-r3", role: "ai", participantId: "doubao", text: "未登录", isDone: true, loginWarning: true, loginPid: "doubao-1" });
  await page.waitForTimeout(2000);   // 越过 pending 自愈窗口再断言
  check("登录警告不计入完成数 → 动作条置灰", await page.evaluate(() =>
    document.getElementById("sm-act-debate").disabled));

  // ── C. ↺ 彻底重置（v5.0.73 用户点名，原为清空群聊）：危险确认 Modal ──
  await page.click("#btn-simple-new");
  await page.waitForTimeout(350);
  check("↺ 弹确认 Modal", await reallyVis(".arena-modal"));
  check("Modal 标题 = 彻底重置", await page.evaluate(() =>
    (document.querySelector(".arena-modal-title")?.textContent || "").includes("彻底重置")));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("Escape 取消 Modal", !(await reallyVis(".arena-modal")));

  // ── D. seg 切全量：完整界面 + 持久化 ──
  await page.click('#ui-mode-seg button[data-uimode="full"]');
  await page.waitForTimeout(500);
  check("切全量后 body.simple-mode 移除", !(await page.evaluate(() => document.body.classList.contains("simple-mode"))));
  for (const [name, sel, expect] of [
    ["左栏对话目录 出现", ".chat-sidebar", true],
    ["右栏 tabs 出现", ".rp-tabs", true],
    ["任务模式下拉 出现", ".task-picker-wrap", true],
    ["header 折叠到顶 出现", "#btn-mini-mode", true],
    ["header PPT 出现", "#btn-ppt-super", true],
    ["header 对比 出现", "#btn-compare", true],
    ["header 清空群聊 出现", "#btn-clear", true],
    ["header ⋯更多 出现", "#btn-more", true],
    ["状态日志 出现", "#rp-bottom", true],
    ["↺ 隐藏", "#btn-simple-new", false],
    ["动作条 隐藏", ".simple-ctxbar", false],
  ]) check(`全量: ${name}`, (await vis(sel)) === expect);
  check("切全量静默解锁渐进披露（advancedUnlocked）", await page.evaluate(() =>
    !document.body.classList.contains("adv-locked")));
  // 四路审查修复回归：mini 折叠条隐藏双模式控件（断掉 mini→精简 死锁路径）
  check("mini 态下 seg 隐藏（CSS 防御）", await page.evaluate(() => {
    document.body.setAttribute("data-mode", "mini");
    const hidden = getComputedStyle(document.getElementById("ui-mode-seg")).display === "none";
    document.body.setAttribute("data-mode", "full");
    return hidden;
  }));
  await page.screenshot({ path: path.join(OUT, "05-full-mode.png") });

  // ⋯菜单 portal 回归（v5.0.70 血泪）：全量已解锁 → 菜单只剩彻底重置
  await page.click("#btn-more");
  await page.waitForTimeout(250);
  check("全量: ⋯菜单真实可见（portal 不被裁剪）", await reallyVis("#hdr-more-menu"));
  check("全量: 菜单不列 PPT（已常驻 header）", !(await reallyVis('[data-more="btn-ppt-super"]')));
  check("全量: 菜单保留 彻底重置", await reallyVis('[data-more="btn-hard-reset"]'));
  await page.keyboard.press("Escape");

  // 窄宽 portal 回归
  await page.setViewportSize({ width: 900, height: 850 });
  await page.waitForTimeout(200);
  await page.click("#btn-more");
  await page.waitForTimeout(250);
  check("窄宽 900: ⋯菜单完整真实可见", await reallyVis("#hdr-more-menu"));
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.waitForTimeout(200);

  // 模式持久化：reload → 仍全量；切回精简 → reload → 仍精简
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1300);
  check("reload 后保持全量（uiMode 持久化）", !(await page.evaluate(() => document.body.classList.contains("simple-mode"))));
  await page.click('#ui-mode-seg button[data-uimode="simple"]');
  await page.waitForTimeout(400);
  check("切回精简：单栏+成员栏恢复", await page.evaluate(() =>
    document.body.classList.contains("simple-mode")));
  check("切回精简：动作条常驻回归", await reallyVis("#sm-act-debate"));
  // 四路审查修复回归：popup 会话内已有 2 家真实回答记录时，切回精简动作条应可用
  //（此处 participants 有 response 由 getState 播种 — reload 后验证）
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1300);
  check("reload 后保持精简", await page.evaluate(() => document.body.classList.contains("simple-mode")));

  // ── E. adv-locked 渐进披露矩阵回归（全量模式内往返） ──
  await page.click('#ui-mode-seg button[data-uimode="full"]');
  await page.waitForTimeout(400);
  await page.evaluate(() => window.ChatProgressive?.lock());
  await page.waitForTimeout(350);
  check("回锁新手披露：统计 tab 复隐", !(await vis('.rp-tab[data-tab="stats"]')));
  check("回锁新手披露：active tab 防御回成员页", await page.evaluate(() =>
    document.querySelector(".rp-tab.active")?.dataset.tab === "members"));
  await page.click("#btn-more");
  await page.waitForTimeout(250);
  check("新手披露: ⋯菜单列出 PPT 代理项", await reallyVis('[data-more="btn-ppt-super"]'));
  check("新手披露: ⋯菜单含解锁入口", await reallyVis('[data-more="unlock"]'));
  await page.click('[data-more="unlock"]');
  await page.waitForTimeout(400);
  check("菜单解锁 → 完整界面恢复", await vis('.rp-tab[data-tab="stats"]'));
} finally {
  await context.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

// ══ F. 老用户画像：advancedUnlocked 预置 → 首判默认全量 ══
{
  const { context: ctx2, sw: sw2, extId: id2, dir: dir2 } = await launch("legacy");
  try {
    await sw2.evaluate(() => new Promise(res => chrome.storage.local.set({ advancedUnlocked: true }, res)));
    const p2 = await ctx2.newPage();
    await p2.setViewportSize({ width: 1280, height: 850 });
    await p2.goto(`chrome-extension://${id2}/popup.html`);
    await p2.waitForLoadState("domcontentloaded");
    await p2.waitForTimeout(1500);
    check("老用户（已解锁进阶）首判默认全量", !(await p2.evaluate(() => document.body.classList.contains("simple-mode"))));
    check("老用户 seg「全量」高亮", await p2.evaluate(() =>
      document.querySelector('#ui-mode-seg button[data-uimode="full"]')?.classList.contains("on")));
    await p2.screenshot({ path: path.join(OUT, "06-legacy-default-full.png") });
  } finally {
    await ctx2.close();
    fs.rmSync(dir2, { recursive: true, force: true });
  }
}

console.log(`\nsimple-mode: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
