// 串行逐套抓取 + 预览精确样式 + 重置按钮 E2E：临时 profile + mock 后端（受控 readOneResponse）
// 验证：① 选 2 套→串行发 2 次→各抓 1 块→进 Step3（cand=2）② chip 红底白字居中/title 华为红左对齐
//       ③ ↺ 新建 清空回 Step1 ④ ✕ 逃生
const { chromium } = require("playwright-core");
const fs = require("fs"), os = require("os"), path = require("path");
const EXT = "C:/Users/lintian/AI_debate/ai-arena-extension/src";
const EXE = "C:/Users/lintian/AppData/Local/ms-playwright/chromium-1226/chrome-win64/chrome.exe";
const EXTID = "ndiclbhabflkigblghlapmookalgglic";
const TOOLS = path.dirname(__filename);
const PROFILE = path.join(os.tmpdir(), "ppts-mock-" + Date.now());

// 每套一个独立 json 块（内容不同，模拟串行不同回答）
const BLOCK_A = "```json\n" + JSON.stringify({ chip: "昇腾算力", title_main: "As-Is 到 To-Be：万卡训练效率系统性跃升三倍" }) + "\n```";
const BLOCK_B = "```json\n" + JSON.stringify({ chip: "效能看板", title_main: "昇腾超节点关键指标全面达标 MFU 升至 58%" }) + "\n```";

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false, executablePath: EXE,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-first-run", "--no-default-browser-check"],
    viewport: { width: 1200, height: 850 }
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(`chrome-extension://${EXTID}/popup.html`);
  await page.waitForTimeout(1500);

  // mock 后端：sendPromptToService 推进 round；readOneResponse 前 1 次"生成中"、之后返回该 round 的块
  await page.evaluate((blocks) => {
    window.confirm = () => true;                       // 让重置 confirm 自动通过
    window.__sendLog = [];
    let round = -1, poll = 0;
    chrome.runtime.sendMessage = (msg, cb) => {
      if (msg && msg.type === "getState") { cb({ participants: [{ id: "mock", service: "chatgpt", name: "Mock-GPT", response: null, loginStatus: "ok" }] }); return; }
      if (msg && msg.type === "sendPromptToService") { round++; poll = 0; window.__sendLog.push((msg.text || "").slice(0, 24)); setTimeout(() => cb({ ok: true, participantId: "mock" }), 120); return; }
      if (msg && msg.type === "readOneResponse") { poll++; const t = poll < 2 ? ("AI 正在生成……" + "片段".repeat(poll * 8)) : blocks[Math.min(round, blocks.length - 1)]; setTimeout(() => cb({ ok: true, text: t }), 50); return; }
      try { cb({}); } catch (e) {}
    };
  }, [BLOCK_A, BLOCK_B]);

  // Step1 → 选 2 套（tpl-01 确有 chip/title_main 供样式断言）→ Step2
  await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    document.getElementById("btn-ppt-super").click(); await sleep(1300);
    const tp = document.getElementById("ppts-topic"); tp.value = "昇腾超节点集群在大模型训练中的性能优化进展"; tp.dispatchEvent(new Event("input"));
    document.querySelector('.ppts-tpl[data-id="tpl-01-quad-grid"]').click();
    document.querySelector('.ppts-tpl[data-id="tpl-16-kpi-dashboard"]').click();
    document.getElementById("ppts-next1").click(); await sleep(500);
    document.getElementById("ppts-refresh").click(); await sleep(700);
  });

  // grab：监控串行进度
  await page.evaluate(() => document.getElementById("ppts-grab").click());
  let done = false, last = "";
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(1200);
    const s = await page.evaluate(() => ({
      step: (document.querySelector(".ppts-step.on") || {}).textContent,
      stage: (document.getElementById("ppts-prog-stage") || {}).textContent,
      time: (document.getElementById("ppts-prog-time") || {}).textContent,
      meta: (document.getElementById("ppts-prog-meta") || {}).textContent,
    }));
    const line = `[${(i * 1.2).toFixed(0)}s] step=${s.step} [${s.stage || "-"} ${s.time || ""}] ${s.meta || ""}`;
    if (line !== last) { console.log(line); last = line; }
    if (s.step && s.step.indexOf("3") === 0) { done = true; break; }
  }
  if (!done) { console.log(">>> ⚠ 未进 Step3"); await ctx.close(); process.exit(1); }

  const sendLog = await page.evaluate(() => window.__sendLog);
  const cand = await page.evaluate(() => document.querySelectorAll(".ppts-ctab").length);
  console.log(">>> 串行发送次数:", sendLog.length, "| 候选套数:", cand);

  // 预览精确样式断言
  const sty = await page.evaluate(() => {
    const pick = (k) => {
      const ov = document.querySelector('.ppts-ov[data-k="' + k + '"]');
      if (!ov) return null;
      const inner = ov.querySelector(".ppts-ovt");
      const cs = getComputedStyle(ov);
      return { color: cs.color, justify: cs.justifyContent, weight: cs.fontWeight, textAlign: inner ? getComputedStyle(inner).textAlign : "", text: inner ? inner.textContent.slice(0, 12) : "" };
    };
    return { chip: pick("chip"), title: pick("title_main") };
  });
  console.log(">>> chip 样式:", JSON.stringify(sty.chip));
  console.log(">>> title 样式:", JSON.stringify(sty.title));
  await page.screenshot({ path: TOOLS + "/_e2e_preview.png" });

  // 下载
  const dl = await Promise.all([page.waitForEvent("download").catch(() => null), page.evaluate(() => document.getElementById("ppts-dl").click())]).then(a => a[0]);
  if (dl) { const o = TOOLS + "/_e2e_mock_out.pptx"; await dl.saveAs(o); console.log(">>> 下载 pptx:", fs.statSync(o).size, "bytes"); }

  // 重置按钮：↺ 新建 → 回 Step1 清空
  await page.evaluate(() => { const r = document.querySelector(".ppts-reset"); if (r) r.click(); });
  await page.waitForTimeout(400);
  const ar = await page.evaluate(() => ({
    step: (document.querySelector(".ppts-step.on") || {}).textContent,
    topic: (document.getElementById("ppts-topic") || {}).value,
    sel: document.querySelectorAll(".ppts-tpl.sel").length
  }));
  console.log(">>> 重置后:", JSON.stringify(ar));

  // ✕ 逃生
  const closed = await page.evaluate(() => { const x = document.querySelector(".ppts-x"); if (x) x.click(); return new Promise(r => setTimeout(() => r(!document.getElementById("ppts-overlay")), 400)); });
  console.log(">>> ✕ 逃生:", closed ? "✓" : "✗");

  // 断言
  const okSerial = sendLog.length === 2 && cand === 2;
  const okStyle = sty.chip && sty.chip.color === "rgb(255, 255, 255)" && sty.chip.justify === "center" && sty.chip.textAlign === "center"
    && sty.title && sty.title.color === "rgb(185, 10, 10)" && sty.title.textAlign === "left";
  const okReset = ar.step && ar.step.indexOf("1") === 0 && !ar.topic && ar.sel === 0;
  console.log("==== 串行:", okSerial ? "✓" : "✗", "| 预览样式:", okStyle ? "✓" : "✗", "| 重置:", okReset ? "✓" : "✗", "====");

  await ctx.close();
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  console.log(okSerial && okStyle && okReset ? "ALL PASS" : "SOME FAIL");
})().catch(e => { console.error("FAIL", e && e.stack || e); process.exit(1); });
