// simple-mode.mjs — v5.0.71 精简/全量双模式 E2E（含 v5.0.67 渐进披露矩阵回归）
// 真实加载扩展验证：
//   A. 首启默认精简模式：单栏可见性矩阵 + 常驻按钮 ≤6 + 点菜开局真实加人 + 头像条
//   B. 上下文辩论 pill：≥2 家答完浮现 / 点击捕获 debate 任务并归位 ask / 再辩文案
//   C. 成员抽屉：elementFromPoint 真实命中（弹层铁律）+ 点外收起
//   D. ↺ 新对话：确认 Modal 弹出
//   E. seg 切全量：完整界面矩阵 + ⋯菜单 portal 回归 + 模式持久化（reload 往返）
//   F. adv-locked 新手披露矩阵回归（全量模式内 lock/unlock 往返）
//   G. 老用户画像（advancedUnlocked 预置）→ 首判默认全量
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

  // ── A. 首启 = 精简模式单栏 ──
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
    ["成员头像条 可见", ".simple-avatars", true],
    ["输入框 可见", "#chat-input", true],
    ["发送按钮 可见", "#btn-send", true],
    ["空状态海报 隐藏", ".es-poster", false],
    ["空状态玩法词条 隐藏", "#es-features", false],
    ["空状态套餐卡 可见", "#es-quickstart", true],
    ["空状态示例问题 可见", "#es-starters", true],
  ]) check(`精简: ${name}`, (await vis(sel)) === expect);

  check("版本号可见（chat-name 含 5.0.71）", await page.evaluate(() =>
    (document.querySelector(".chat-name")?.textContent || "").includes("5.0.71")));

  // 常驻决策点 ≤6：视口内可见按钮（排除空状态上下文区）应只剩 seg×2 + ↺ + 发送
  const standingButtons = await page.evaluate(() => {
    return [...document.querySelectorAll("button")].filter(el => {
      if (el.closest("#empty-state")) return false;
      if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") return false;
      if (getComputedStyle(el).display === "none") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.left >= -1 && r.top >= -1
        && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
    }).map(el => el.id || el.className);
  });
  check(`精简: 常驻可点按钮 ≤6（实测 ${standingButtons.length}）`, standingButtons.length <= 6,
    JSON.stringify(standingButtons));
  check("头像条 0 成员时只有 ＋", await page.evaluate(() =>
    document.querySelectorAll(".simple-avatars .sa-ava").length === 1
    && !!document.querySelector(".simple-avatars .sa-add")));
  check("示例问题点击填入输入框", await (async () => {
    await page.click(".es-starter");
    await page.waitForTimeout(250);
    return page.evaluate(() => (document.getElementById("chat-input")?.textContent || "").length > 5);
  })());
  await page.evaluate(() => { document.getElementById("chat-input").textContent = ""; });
  await page.screenshot({ path: path.join(OUT, "01-simple-first-run.png") });

  // ── A2. 点菜开局：套餐卡真实加人（applyRecommend 既有链路） ──
  await page.click('#es-quickstart .es-qs-btn');   // ⚡ 双开对比 = deepseek + doubao
  const got2 = await waitUntil(() =>
    document.querySelectorAll(".simple-avatars .sa-ava:not(.sa-add)").length === 2, 12000);
  check("点菜后头像条出现 2 个成员", got2);
  check("加人后套餐卡自动隐藏", !(await vis("#es-quickstart")));
  await page.screenshot({ path: path.join(OUT, "02-after-quickstart.png") });
  // 真实 tab 打开后 background 会异步广播 loginWarning 流消息（未登录环境的正确行为），
  // 它会从 roundDone 删掉同名 service — 先让这波真实噪音落地，再开始伪造轮次，防竞态
  await page.waitForTimeout(5000);

  // ── B. 上下文辩论 pill（SW 广播模拟一轮完成 — 走真实 onMessage 收线） ──
  check("辩论 pill 初始隐藏", !(await vis("#simple-ctxbar")));
  await bcast({ type: "chatStreamUpdate", msgId: "e2e-r1", role: "user", text: "E2E 测试问题" });
  await page.waitForTimeout(300);
  await bcast({ type: "chatStreamUpdate", msgId: "e2e-r1", role: "ai", participantId: "deepseek", text: "回答 A", isDone: true });
  await page.waitForTimeout(200);
  check("只 1 家答完 pill 不出现", !(await vis("#simple-ctxbar")));
  await bcast({ type: "chatStreamUpdate", msgId: "e2e-r1", role: "ai", participantId: "doubao", text: "回答 B", isDone: true });
  await waitUntil(() => !document.getElementById("simple-ctxbar").hidden, 4000);
  check("≥2 家答完 pill 浮现", await reallyVis("#simple-debate-pill"));
  check("首次文案 = 让他们互相挑错", await page.evaluate(() =>
    (document.getElementById("simple-debate-pill")?.textContent || "").includes("互相挑错")));
  await page.screenshot({ path: path.join(OUT, "03-debate-pill.png") });

  // pill 点击：patch dispatch 捕获任务（不真发辩论 — 假流式状态下 background 会拒），
  // 验证 setTask(debate) → 发送捕获 → 归位 ask 的完整接线
  await page.evaluate(() => {
    window.__origDispatch = window.ChatTaskMenu.dispatch;
    window.__dispatched = null;
    window.ChatTaskMenu.dispatch = async () => {
      window.__dispatched = { ...window.ChatTaskMenu.current() };
      return { ok: true };
    };
  });
  // 防御：若沉降期后仍有迟到的真实登录噪音把 pill 收走，重注一轮伪造完成再点
  if (!(await reallyVis("#simple-debate-pill"))) {
    await bcast({ type: "chatStreamUpdate", msgId: "e2e-r1b", role: "user", text: "重注轮" });
    await page.waitForTimeout(250);
    await bcast({ type: "chatStreamUpdate", msgId: "e2e-r1b", role: "ai", participantId: "deepseek", text: "回答 A2", isDone: true });
    await bcast({ type: "chatStreamUpdate", msgId: "e2e-r1b", role: "ai", participantId: "doubao", text: "回答 B2", isDone: true });
    await waitUntil(() => !document.getElementById("simple-ctxbar").hidden, 4000);
  }
  await page.click("#simple-debate-pill");
  await page.waitForTimeout(300);
  const dispatched = await page.evaluate(() => window.__dispatched);
  check("pill 点击以 debate 任务发送", dispatched?.task === "debate", JSON.stringify(dispatched));
  check("发送后任务归位 ask（输入框保持同时提问语义）", await page.evaluate(() =>
    window.ChatTaskMenu.current().task === "ask"));
  check("pill 点击后收起", !(await vis("#simple-ctxbar")));
  // 四路审查修复回归：辩论未真正开启（无 user 流消息清 roundDone）→ 1.6s 自愈复现
  await page.waitForTimeout(1900);
  check("辩论未真开启时 pill 自愈复现（取消/失败不丢入口）", await reallyVis("#simple-debate-pill"));
  await page.evaluate(() => { window.ChatTaskMenu.dispatch = window.__origDispatch; });

  // 再辩文案：真实 dispatch 会发 task:dispatched（patch 版没发），此处补事件后再走一轮
  await page.evaluate(() => document.dispatchEvent(new CustomEvent("task:dispatched", { detail: { task: "debate" } })));
  await bcast({ type: "chatStreamUpdate", msgId: "e2e-r2", role: "user", text: "第 1 轮辩论" });
  await page.waitForTimeout(250);
  check("新一轮开始 pill 复隐", !(await vis("#simple-ctxbar")));
  await bcast({ type: "chatStreamUpdate", msgId: "e2e-r2", role: "ai", participantId: "deepseek", text: "反驳 A", isDone: true });
  await bcast({ type: "chatStreamUpdate", msgId: "e2e-r2", role: "ai", participantId: "doubao", text: "反驳 B", isDone: true });
  await waitUntil(() => !document.getElementById("simple-ctxbar").hidden, 4000);
  check("辩过一轮后文案 = 再辩一轮", await page.evaluate(() =>
    (document.getElementById("simple-debate-pill")?.textContent || "").includes("再辩一轮")));

  // 失败态不计入：doubao 假登录警告 → 只剩 1 家有效 → pill 不出现
  await bcast({ type: "chatStreamUpdate", msgId: "e2e-r3", role: "user", text: "第三问" });
  await page.waitForTimeout(250);
  await bcast({ type: "chatStreamUpdate", msgId: "e2e-r3", role: "ai", participantId: "deepseek", text: "答", isDone: true });
  await bcast({ type: "chatStreamUpdate", msgId: "e2e-r3", role: "ai", participantId: "doubao", text: "未登录", isDone: true, loginWarning: true, loginPid: "doubao-1" });
  await page.waitForTimeout(400);
  check("登录警告不计入完成数 → pill 不出现", !(await vis("#simple-ctxbar")));

  // ── C. 成员抽屉（弹层铁律：elementFromPoint 真实命中） ──
  check("抽屉初始不可见（收在右侧屏外）", !(await reallyVis("#sm-drawer-close")));
  check("收起态抽屉 inert（Tab/读屏不可达）", await page.evaluate(() =>
    document.getElementById("chat-rightpanel").inert === true));
  await page.click(".simple-avatars");
  await page.waitForTimeout(450);
  check("打开态抽屉解除 inert", await page.evaluate(() =>
    document.getElementById("chat-rightpanel").inert === false));
  check("点头像条 → 抽屉打开（body.sm-drawer-open）", await page.evaluate(() =>
    document.body.classList.contains("sm-drawer-open")));
  check("抽屉收起按钮真实可见", await reallyVis("#sm-drawer-close"));
  check("抽屉成员面板真实可见", await reallyVis("#rp-panel-members"));
  check("抽屉内 6 个 tab 隐藏（只留成员）", !(await vis(".rp-tabs")));
  check("状态日志隐藏", !(await vis("#rp-bottom")));
  check("角色帽隐藏（进阶功能留给全量）", !(await vis(".rp-hat-section")));
  await page.screenshot({ path: path.join(OUT, "04-member-drawer.png") });
  await page.mouse.click(400, 420);   // 点抽屉外
  await page.waitForTimeout(400);
  check("点外部 → 抽屉收起", !(await page.evaluate(() => document.body.classList.contains("sm-drawer-open"))));

  // ── D. ↺ 新对话：确认 Modal ──
  await page.click("#btn-simple-new");
  await page.waitForTimeout(350);
  check("↺ 弹清空确认 Modal", await reallyVis(".arena-modal"));
  check("Modal 标题 = 清空群聊", await page.evaluate(() =>
    (document.querySelector(".arena-modal-title")?.textContent || "").includes("清空群聊")));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("Escape 取消 Modal", !(await reallyVis(".arena-modal")));

  // ── E. seg 切全量：完整界面 + 持久化 ──
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
    ["头像条 隐藏", ".simple-avatars", false],
    ["辩论 pill 条 隐藏", ".simple-ctxbar", false],
  ]) check(`全量: ${name}`, (await vis(sel)) === expect);
  check("切全量静默解锁渐进披露（advancedUnlocked）", await page.evaluate(() =>
    !document.body.classList.contains("adv-locked")));
  check("全量态右栏无 inert（常驻可交互）", await page.evaluate(() =>
    document.getElementById("chat-rightpanel").inert === false));
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
  check("切回精简：单栏恢复", await page.evaluate(() => document.body.classList.contains("simple-mode")));
  check("切回精简：成员头像条保留成员", await page.evaluate(() =>
    document.querySelectorAll(".simple-avatars .sa-ava:not(.sa-add)").length === 2));
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1300);
  check("reload 后保持精简", await page.evaluate(() => document.body.classList.contains("simple-mode")));

  // ── F. adv-locked 渐进披露矩阵回归（全量模式内往返） ──
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

// ══ G. 老用户画像：advancedUnlocked 预置 → 首判默认全量 ══
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
