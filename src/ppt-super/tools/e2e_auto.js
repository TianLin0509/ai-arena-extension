// 真实自动发送 E2E：addParticipant 开真实 AI 标签页 → PPT-SUPER grab 自动发送
// → 监控收敛（核心：不再卡死）→ 测 ✕ 逃生。豆包游客无需登录可答。
const { chromium } = require("playwright-core");
const fs = require("fs"), os = require("os"), path = require("path");

const EXT = "C:/Users/lintian/AI_debate/ai-arena-extension/src";
const EXE = "C:/Users/lintian/AppData/Local/ms-playwright/chromium-1226/chrome-win64/chrome.exe";
const EXTID = "ndiclbhabflkigblghlapmookalgglic";
const SERVICE = process.argv[2] || "doubao";
const USE_ARENA = process.argv[3] === "arena";
const PROFILE = USE_ARENA ? "C:/Users/lintian/.claude/playwright-arena-profile" : path.join(os.tmpdir(), "ppts-auto-" + Date.now());

const sendMsg = (page, m) => page.evaluate(mm => new Promise(r => chrome.runtime.sendMessage(mm, r)), m);

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false, executablePath: EXE,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-first-run", "--no-default-browser-check"],
    viewport: { width: 1200, height: 850 }
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(`chrome-extension://${EXTID}/popup.html`);
  await page.waitForTimeout(1500);

  // 1. 真实添加 AI participant（开 AI 标签页 + 注册）
  const add = await sendMsg(page, { type: "addParticipant", service: SERVICE });
  console.log("addParticipant:", JSON.stringify(add).slice(0, 200));
  await page.waitForTimeout(8000);

  const st = await sendMsg(page, { type: "getState" });
  const parts = ((st && st.participants) || []).map(p => ({ id: p.id, service: p.service, login: p.loginStatus }));
  console.log("participants:", JSON.stringify(parts));
  if (!parts.length) { console.log("✗ 没有 participant，自动链路无法测；但下面仍验证逃生"); }

  // 2. PPT-SUPER 到 Step2（选 1 套版式 → need=1，抓 1 块即完成）
  await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    document.getElementById("btn-ppt-super").click(); await sleep(1300);
    const tp = document.getElementById("ppts-topic");
    tp.value = "人工智能大模型发展趋势"; tp.dispatchEvent(new Event("input"));
    document.querySelector('.ppts-tpl[data-id="tpl-04-asis-tobe"]').click();
    document.getElementById("ppts-next1").click(); await sleep(600);
    document.getElementById("ppts-refresh").click(); await sleep(1000);
  });
  const svc = await page.evaluate(() => {
    const sel = document.getElementById("ppts-svc");
    return { opts: [...sel.options].map(o => o.textContent), val: sel.value };
  });
  console.log("发往下拉:", JSON.stringify(svc));

  // 3. grab 自动发送，监控收敛 + 进度面板
  await page.evaluate(() => document.getElementById("ppts-grab").click());
  let done = false, last = "", reachedStep3 = false, shot = false;
  for (let i = 0; i < 70; i++) {
    await page.waitForTimeout(2000);
    const s = await page.evaluate(() => {
      const f = document.getElementById("ppts-prog-fill");
      return {
        step: (document.querySelector(".ppts-step.on") || {}).textContent,
        status: (document.getElementById("ppts-status") || {}).textContent,
        stage: (document.getElementById("ppts-prog-stage") || {}).textContent,
        time: (document.getElementById("ppts-prog-time") || {}).textContent,
        meta: (document.getElementById("ppts-prog-meta") || {}).textContent,
        fill: f ? f.style.width : "",
        grab: (document.getElementById("ppts-grab") || {}).textContent
      };
    });
    const line = `[${i * 2}s] step=${s.step} | 进度:[${s.stage || "-"} ${s.time || ""} bar=${s.fill || ""}] ${s.meta || s.status}`;
    if (line !== last) { console.log(line); last = line; }
    if (!shot && s.stage) { await page.screenshot({ path: path.dirname(__filename) + "/_e2e_prog.png" }); shot = true; console.log("  (进度面板截图 _e2e_prog.png 已存)"); }
    if (s.step && s.step.indexOf("3") === 0) { reachedStep3 = true; done = true; console.log(">>> ✓ 收敛进 Step3（自动抓取成功，未卡死）"); break; }
    if (s.grab && s.grab.indexOf("发送") >= 0 && i > 2) { done = true; console.log(">>> grab 循环已结束（收敛）：" + s.status); break; }
  }
  if (!done) console.log(">>> ⚠ 140s 仍未收敛");

  // 4. 测 ✕ 逃生（无论上面结果，关闭必须随时可用）
  const beforeStep3 = reachedStep3;
  if (!beforeStep3) {
    const closed = await page.evaluate(() => {
      const x = document.querySelector(".ppts-x"); if (x) x.click();
      return new Promise(r => setTimeout(() => r(!document.getElementById("ppts-overlay")), 500));
    });
    console.log("✕ 关闭逃生:", closed ? "✓ modal 已关闭，回到主界面" : "✗ 仍卡住");
  } else {
    // 进了 Step3，则下载验证 + 再测关闭
    const dl = await Promise.all([
      page.waitForEvent("download").catch(() => null),
      page.evaluate(() => { const b = document.getElementById("ppts-dl"); if (b) b.click(); })
    ]).then(a => a[0]);
    if (dl) { const out = path.dirname(__filename) + "/_e2e_auto_out.pptx"; await dl.saveAs(out); console.log("下载:", out, fs.statSync(out).size, "bytes"); }
    const closed = await page.evaluate(() => { const x = document.querySelector(".ppts-x"); if (x) x.click(); return new Promise(r => setTimeout(() => r(!document.getElementById("ppts-overlay")), 500)); });
    console.log("✕ 关闭逃生:", closed ? "✓" : "✗");
  }

  await ctx.close();
  if (!USE_ARENA) { try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {} }
  console.log("DONE");
})().catch(e => { console.error("FAIL", e && e.stack || e); process.exit(1); });
