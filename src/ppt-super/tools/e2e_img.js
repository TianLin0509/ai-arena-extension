// 带图模板手动配图路径 E2E：选 tpl-22 → 粘文本 JSON → Step3 上传配图 → 活预览显示图 → 下载含图
const { chromium } = require("playwright-core");
const fs = require("fs"), os = require("os"), path = require("path");
const EXT = "C:/Users/lintian/AI_debate/ai-arena-extension/src";
const EXE = "C:/Users/lintian/AppData/Local/ms-playwright/chromium-1226/chrome-win64/chrome.exe";
const EXTID = "ndiclbhabflkigblghlapmookalgglic";
const TOOLS = path.dirname(__filename);
const PASTE = fs.readFileSync(TOOLS + "/_tpl22_paste.txt", "utf-8");
const PROFILE = path.join(os.tmpdir(), "ppts-img-" + Date.now());

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false, executablePath: EXE,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-first-run", "--no-default-browser-check"],
    viewport: { width: 1200, height: 850 }
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(`chrome-extension://${EXTID}/popup.html`);
  await page.waitForTimeout(1500);

  await page.evaluate(async (paste) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    document.getElementById("btn-ppt-super").click(); await sleep(1300);
    const tp = document.getElementById("ppts-topic"); tp.value = "智能光储微网标杆项目"; tp.dispatchEvent(new Event("input"));
    document.querySelector('.ppts-tpl[data-id="tpl-22-hero-split"]').click();
    document.getElementById("ppts-next1").click(); await sleep(500);
    const pa = document.getElementById("ppts-paste"); const det = pa.closest("details"); if (det) det.open = true;
    pa.value = paste; document.getElementById("ppts-parsepaste").click(); await sleep(800);
  }, PASTE);

  // Step3：上传配图到 image slot
  const fileInput = await page.$('.ppts-up input[type=file]');
  console.log("file input found:", !!fileInput);
  if (fileInput) { await fileInput.setInputFiles(TOOLS + "/_test_img.png"); await page.waitForTimeout(700); }

  const st = await page.evaluate(() => ({
    step: (document.querySelector(".ppts-step.on") || {}).textContent,
    ovimg: document.querySelectorAll(".ppts-ovimg").length,
    thumb: !!document.querySelector(".ppts-imgthumb img"),
    imgstate: (document.querySelector(".ppts-imgslot .ppts-cnt") || {}).textContent
  }));
  console.log("Step3:", JSON.stringify(st));
  await page.screenshot({ path: TOOLS + "/_e2e_img_step3.png" });

  const dl = await Promise.all([page.waitForEvent("download").catch(() => null), page.evaluate(() => document.getElementById("ppts-dl").click())]).then(a => a[0]);
  if (dl) { const o = TOOLS + "/_e2e_img_out.pptx"; await dl.saveAs(o); console.log("下载含图 pptx:", fs.statSync(o).size, "bytes"); }

  await ctx.close();
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  console.log("DONE");
})().catch(e => { console.error("FAIL", e && e.stack || e); process.exit(1); });
