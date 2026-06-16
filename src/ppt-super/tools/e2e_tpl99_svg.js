// E2E：真发 gemini 出 SVG 图标完整闭环（验证 generateIconSheet 真跑通 + 顺序天然对应）
// addParticipant gemini → 选 tpl-99 + mock 文案 → 点「AI 生成全部图标」→ gemini 出 SVG → canvas 渲染 → 下载
const { chromium } = require("playwright-core");
const fs = require("fs"), os = require("os"), path = require("path");
const EXT = "C:/Users/lintian/AI_debate/ai-arena-extension/src";
const EXE = "C:/Users/lintian/AppData/Local/ms-playwright/chromium-1226/chrome-win64/chrome.exe";
const EXTID = "ndiclbhabflkigblghlapmookalgglic";
const SUPER = EXT + "/ppt-super";
const TOOLS = path.dirname(__filename);
const TID = "tpl-99-analysis-solution-split";
const PROFILE = path.join(os.tmpdir(), "ppts-svg-" + Date.now());
const sendMsg = (page, m) => page.evaluate(mm => new Promise(r => chrome.runtime.sendMessage(mm, r)), m);

const tpls = JSON.parse(fs.readFileSync(SUPER + "/templates.json", "utf-8"));
const tpl = tpls.templates.find(t => t.id === TID);
const mock = {};
tpl.slots.forEach(s => { if (s.type !== "image" && s.type !== "icon") mock[s.key] = s.sample || s.zh || s.key; });
const PASTE = "```json\n" + JSON.stringify(mock) + "\n```";

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false, executablePath: EXE,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-first-run", "--no-default-browser-check"],
    viewport: { width: 1280, height: 900 }
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(`chrome-extension://${EXTID}/popup.html`);
  await page.waitForTimeout(1500);

  const add = await sendMsg(page, { type: "addParticipant", service: "gemini" });
  console.log("addParticipant:", JSON.stringify(add).slice(0, 110));
  await page.waitForTimeout(9000);
  const GPID = (add.participants && add.participants[0] || {}).id || "p1";
  console.log("GPID:", GPID);

  await page.evaluate(async ({ paste, tid }) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    document.getElementById("btn-ppt-super").click(); await sleep(1300);
    const tp = document.getElementById("ppts-topic"); tp.value = "上下行联合优化"; tp.dispatchEvent(new Event("input"));
    document.querySelector('.ppts-tpl[data-id="' + tid + '"]').click();
    document.getElementById("ppts-next1").click(); await sleep(500);
    const pa = document.getElementById("ppts-paste"); const det = pa.closest("details"); if (det) det.open = true;
    pa.value = paste; document.getElementById("ppts-parsepaste").click(); await sleep(900);
  }, { paste: PASTE, tid: TID });
  console.log("已进 Step3，点击「AI 生成全部图标」(真发 gemini 出 SVG)…");

  await page.evaluate(() => { const b = document.querySelector('.ppts-iconbatch [data-a="gen"]'); if (b) b.click(); });

  let done = false;
  for (let i = 0; i < 45; i++) {                    // 上限 90s
    await page.waitForTimeout(2000);
    const s = await page.evaluate(() => ({
      cnt: (document.querySelector(".ppts-iconbatch .ppts-cnt") || {}).textContent,
      chips: document.querySelectorAll(".ppts-iconchip img").length,
      status: (document.getElementById("ppts-status") || {}).textContent
    }));
    if (i % 3 === 0) console.log(`[${i * 2}s] icons=${s.cnt} chips=${s.chips} | ${s.status}`);
    if (s.chips >= 7) { done = true; console.log(">>> ✓ gemini 出 7 个 SVG 并渲染完成"); break; }
  }
  if (!done) console.log(">>> ⚠ 90s 未集齐 7 个图标（gemini 出 SVG 慢或抓取失败，可粘贴兜底）");
  await page.screenshot({ path: TOOLS + "/_e2e_svg_step3.png" });

  const dl = await Promise.all([
    page.waitForEvent("download").catch(() => null),
    page.evaluate(() => document.getElementById("ppts-dl").click())
  ]).then(a => a[0]);
  if (dl) { const o = TOOLS + "/_e2e_svg_out.pptx"; await dl.saveAs(o); console.log("✓ 下载:", fs.statSync(o).size, "bytes ->", o); }

  await ctx.close();
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  console.log("DONE done=" + done);
  process.exit(done ? 0 : 3);
})().catch(e => { console.error("FAIL", e && e.stack || e); process.exit(1); });
