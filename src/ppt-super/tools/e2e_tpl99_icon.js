// E2E-A：tpl-99 + icon 批量切割 + 填充 + 下载（mock 文案绕过 AI 不确定性，聚焦验证 icon 批量与交付）
// 真实 chromium 加载扩展 → 选 tpl-99 → paste 注入 mock 文案 → 上传图标集 sprite 切割 → 上传配图 → 下载 pptx
const { chromium } = require("playwright-core");
const fs = require("fs"), os = require("os"), path = require("path");
const EXT = "C:/Users/lintian/AI_debate/ai-arena-extension/src";
const EXE = "C:/Users/lintian/AppData/Local/ms-playwright/chromium-1226/chrome-win64/chrome.exe";
const EXTID = "ndiclbhabflkigblghlapmookalgglic";
const SUPER = EXT + "/ppt-super";
const TOOLS = path.dirname(__filename);
const TID = "tpl-99-analysis-solution-split";
const PROFILE = path.join(os.tmpdir(), "ppts-tpl99-" + Date.now());

const tpls = JSON.parse(fs.readFileSync(SUPER + "/templates.json", "utf-8"));
const tpl = tpls.templates.find(t => t.id === TID);
if (!tpl) { console.error("FAIL: templates.json 未含 " + TID); process.exit(1); }
const mock = {};
tpl.slots.forEach(s => { if (s.type !== "image" && s.type !== "icon") mock[s.key] = s.sample || s.zh || s.key; });
const PASTE = "```json\n" + JSON.stringify(mock, null, 2) + "\n```";

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false, executablePath: EXE,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-first-run", "--no-default-browser-check"],
    viewport: { width: 1280, height: 900 }
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(`chrome-extension://${EXTID}/popup.html`);
  await page.waitForTimeout(1500);

  const r1 = await page.evaluate(async ({ paste, tid }) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    document.getElementById("btn-ppt-super").click(); await sleep(1300);
    const tp = document.getElementById("ppts-topic"); tp.value = "上下行联合优化方案"; tp.dispatchEvent(new Event("input"));
    const card = document.querySelector('.ppts-tpl[data-id="' + tid + '"]');
    if (!card) return { err: "模板卡片未找到（templates.json 未含 tpl-99 或未生效）" };
    card.click();
    document.getElementById("ppts-next1").click(); await sleep(500);
    const pa = document.getElementById("ppts-paste"); const det = pa.closest("details"); if (det) det.open = true;
    pa.value = paste; document.getElementById("ppts-parsepaste").click(); await sleep(900);
    return { step: (document.querySelector(".ppts-step.on") || {}).textContent };
  }, { paste: PASTE, tid: TID });
  console.log("选模板+注入文案:", JSON.stringify(r1));
  if (r1.err) { console.log("✗ FAIL:", r1.err); await ctx.close(); process.exit(1); }

  // 粘贴 gemini 出的 SVG JSON → canvas 渲染为 7 个矢量图标（验证 SVG 路径，绕开网页 AI 抓取不确定性）
  const svgJson = fs.readFileSync(TOOLS + "/_icons_svg.json", "utf-8");
  const pasted = await page.evaluate(async (json) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const det = document.querySelector(".ppts-iconbatch details"); if (det) det.open = true;
    const ta = document.querySelector(".ppts-iconprompt"); if (!ta) return { err: "no iconprompt textarea" };
    ta.value = json;
    const btn = document.querySelector('.ppts-iconbatch [data-a="parse"]'); if (!btn) return { err: "no parse btn" };
    btn.click(); await sleep(2000);
    return { ok: true };
  }, svgJson);
  console.log("粘贴 SVG JSON 渲染:", JSON.stringify(pasted));

  // 注：不给大配图位传图——大配图由用户配真实场景图，测试保持空占位，避免图标集串到配图位造成误导

  const st = await page.evaluate(() => ({
    step: (document.querySelector(".ppts-step.on") || {}).textContent,
    iconchips: document.querySelectorAll(".ppts-iconchip img").length,
    iconcnt: (document.querySelector(".ppts-iconbatch .ppts-cnt") || {}).textContent,
    ovimg: document.querySelectorAll(".ppts-ovimg").length
  }));
  console.log("Step3 状态:", JSON.stringify(st));
  await page.screenshot({ path: TOOLS + "/_e2e_tpl99_step3.png" });

  const dl = await Promise.all([
    page.waitForEvent("download").catch(() => null),
    page.evaluate(() => document.getElementById("ppts-dl").click())
  ]).then(a => a[0]);
  if (dl) { const o = TOOLS + "/_e2e_tpl99_out.pptx"; await dl.saveAs(o); console.log("✓ 下载 pptx:", fs.statSync(o).size, "bytes ->", o); }
  else console.log("⚠ 未触发下载");

  await ctx.close();
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  console.log("DONE");
})().catch(e => { console.error("FAIL", e && e.stack || e); process.exit(1); });
