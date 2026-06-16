// E2E-B：用真实网页 AI 出文案 + tpl-99 + icon 批量 + 下载，端到端（目标1）
// 跑法：node e2e_tpl99_gemini.js [service=gemini] [arena]
//   service 可换 doubao（游客免登录兜底）；第二参数 arena 用已保存登录态 profile
const { chromium } = require("playwright-core");
const fs = require("fs"), os = require("os"), path = require("path");
const EXT = "C:/Users/lintian/AI_debate/ai-arena-extension/src";
const EXE = "C:/Users/lintian/AppData/Local/ms-playwright/chromium-1226/chrome-win64/chrome.exe";
const EXTID = "ndiclbhabflkigblghlapmookalgglic";
const TOOLS = path.dirname(__filename);
const TID = "tpl-99-analysis-solution-split";
const SERVICE = process.argv[2] || "gemini";
const USE_ARENA = process.argv[3] === "arena";
const PROFILE = USE_ARENA ? "C:/Users/lintian/.claude/playwright-arena-profile"
  : path.join(os.tmpdir(), "ppts-" + SERVICE + "-" + Date.now());
const sendMsg = (page, m) => page.evaluate(mm => new Promise(r => chrome.runtime.sendMessage(mm, r)), m);

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false, executablePath: EXE,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-first-run", "--no-default-browser-check"],
    viewport: { width: 1280, height: 900 }
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(`chrome-extension://${EXTID}/popup.html`);
  await page.waitForTimeout(1500);

  const add = await sendMsg(page, { type: "addParticipant", service: SERVICE });
  console.log("addParticipant:", JSON.stringify(add).slice(0, 160));
  await page.waitForTimeout(9000);
  const stt = await sendMsg(page, { type: "getState" });
  const parts = ((stt && stt.participants) || []).map(p => ({ id: p.id, service: p.service, login: p.loginStatus }));
  console.log("participants:", JSON.stringify(parts));
  if (!parts.length) { console.log("✗ 没有 participant，无法抓文案"); await ctx.close(); process.exit(2); }

  await page.evaluate(async (tid) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    document.getElementById("btn-ppt-super").click(); await sleep(1300);
    const tp = document.getElementById("ppts-topic"); tp.value = "上下行联合优化提升上行容量"; tp.dispatchEvent(new Event("input"));
    document.querySelector('.ppts-tpl[data-id="' + tid + '"]').click();
    document.getElementById("ppts-next1").click(); await sleep(600);
    document.getElementById("ppts-refresh").click(); await sleep(1000);
    document.getElementById("ppts-grab").click();
  }, TID);

  let reachedStep3 = false;
  for (let i = 0; i < 75; i++) {                     // 上限 150s
    await page.waitForTimeout(2000);
    const s = await page.evaluate(() => ({
      step: (document.querySelector(".ppts-step.on") || {}).textContent,
      stage: (document.getElementById("ppts-prog-stage") || {}).textContent,
      meta: (document.getElementById("ppts-prog-meta") || {}).textContent
    }));
    if (i % 4 === 0) console.log(`[${i * 2}s] step=${s.step} | ${s.stage || "-"} ${s.meta || ""}`);
    if (s.step && s.step.indexOf("3") === 0) { reachedStep3 = true; console.log(">>> ✓ 收敛进 Step3（" + SERVICE + " 文案抓取成功）"); break; }
  }
  if (!reachedStep3) console.log(">>> ⚠ 150s 未收敛进 Step3（" + SERVICE + " 可能需登录或未出 JSON）");

  if (reachedStep3) {
    const iconInput = await page.$('.ppts-iconbatch .ppts-up input[type=file]');
    if (iconInput) { await iconInput.setInputFiles(TOOLS + "/_test_icons.png"); await page.waitForTimeout(1500); }
    const st = await page.evaluate(() => ({
      iconcnt: (document.querySelector(".ppts-iconbatch .ppts-cnt") || {}).textContent,
      fields: document.querySelectorAll(".ppts-ein").length,
      filledFields: Array.prototype.filter.call(document.querySelectorAll(".ppts-ein"), e => e.value && e.value.trim()).length
    }));
    console.log("Step3:", JSON.stringify(st));
    await page.screenshot({ path: TOOLS + "/_e2e_" + SERVICE + "_step3.png" });
    const dl = await Promise.all([
      page.waitForEvent("download").catch(() => null),
      page.evaluate(() => document.getElementById("ppts-dl").click())
    ]).then(a => a[0]);
    if (dl) { const o = TOOLS + "/_e2e_" + SERVICE + "_out.pptx"; await dl.saveAs(o); console.log("✓ 下载:", fs.statSync(o).size, "bytes ->", o); }
  }

  await ctx.close();
  if (!USE_ARENA) { try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {} }
  console.log("DONE reachedStep3=" + reachedStep3);
  process.exit(reachedStep3 ? 0 : 3);
})().catch(e => { console.error("FAIL", e && e.stack || e); process.exit(1); });
