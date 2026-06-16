// 独立 Playwright E2E（绕过死锁的 MCP）：用 chromium-1226 + 一次性临时 profile 加载扩展，
// 跑 PPT-SUPER 全流程，验证优化波（活预览红框 + 超长汇总）+ 真实下载 pptx。
const { chromium } = require("playwright-core");
const fs = require("fs");
const os = require("os");
const path = require("path");

const EXT = "C:/Users/lintian/AI_debate/ai-arena-extension/src";
const EXE = "C:/Users/lintian/AppData/Local/ms-playwright/chromium-1226/chrome-win64/chrome.exe";
const EXTID = "ndiclbhabflkigblghlapmookalgglic";
const TOOLS = "C:/Users/lintian/AI_debate/ai-arena-extension/src/ppt-super/tools";
const PROFILE = path.join(os.tmpdir(), "ppts-e2e-profile-" + Date.now());
const gjson = fs.readFileSync(TOOLS + "/gemini_test.txt", "utf-8");

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    executablePath: EXE,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
           "--no-first-run", "--no-default-browser-check"],
    viewport: { width: 1120, height: 820 }
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(`chrome-extension://${EXTID}/popup.html`);
  await page.waitForTimeout(1500);

  const ver = await page.evaluate(() => ({
    v: chrome.runtime.getManifest().version,
    btn: !!document.getElementById("btn-ppt-super"),
    PptFill: typeof window.PptFill, JSZip: typeof window.JSZip
  }));
  console.log("LOADED:", JSON.stringify(ver));

  const r = await page.evaluate(async (g) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    document.getElementById("btn-ppt-super").click();
    await sleep(1300);
    const tp = document.getElementById("ppts-topic");
    tp.value = "昇腾超节点集群在大模型训练中的性能优化进展"; tp.dispatchEvent(new Event("input"));
    document.querySelector('.ppts-tpl[data-id="tpl-04-asis-tobe"]').click();
    document.querySelector('.ppts-tpl[data-id="tpl-16-kpi-dashboard"]').click();
    document.getElementById("ppts-next1").click();
    await sleep(500);
    const pa = document.getElementById("ppts-paste");
    const det = pa.closest("details"); if (det) det.open = true;
    pa.value = g;
    document.getElementById("ppts-parsepaste").click();
    await sleep(900);
    return {
      step: (document.querySelector(".ppts-step.on") || {}).textContent,
      cands: document.querySelectorAll(".ppts-ctab").length,
      editorRows: document.querySelectorAll(".ppts-er").length,
      ovCount: document.querySelectorAll(".ppts-ov").length,
      overBoxes: document.querySelectorAll(".ppts-ov-over").length,
      status: (document.getElementById("ppts-status") || {}).textContent
    };
  }, gjson);
  console.log("STEP3:", JSON.stringify(r, null, 2));

  await page.screenshot({ path: TOOLS + "/_e2e_optim_step3.png" });

  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#ppts-dl")
  ]);
  const out = TOOLS + "/_e2e_optim_out.pptx";
  await dl.saveAs(out);
  console.log("DOWNLOADED:", out, fs.statSync(out).size, "bytes");

  await ctx.close();
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  console.log("DONE");
})().catch(e => { console.error("FAIL", e && e.stack || e); process.exit(1); });
