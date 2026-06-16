// 把 _icons_svg.json 的 SVG 渲染成一张网格预览图（playwright headless 截图），验证 SVG 路线效果
const { chromium } = require("playwright-core");
const fs = require("fs"), os = require("os"), path = require("path");
const TOOLS = path.dirname(__filename);
const EXE = "C:/Users/lintian/AppData/Local/ms-playwright/chromium-1226/chrome-win64/chrome.exe";

const data = JSON.parse(fs.readFileSync(TOOLS + "/_icons_svg.json", "utf-8"));
const icons = Array.isArray(data) ? data : (data.icons || []);
const cells = icons.map(ic =>
  `<div class="cell"><div class="ic">${ic.svg}</div><div class="nm">${ic.name || ""}</div></div>`).join("");
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#fff;font-family:"Microsoft YaHei",sans-serif}
.grid{display:grid;grid-template-columns:repeat(4,1fr)}
.cell{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 10px;border:1px solid #eef}
.ic svg{width:96px;height:96px}
.nm{margin-top:10px;font-size:13px;color:#555}
</style></head><body><div class="grid">${cells}</div></body></html>`;
fs.writeFileSync(TOOLS + "/_icons_svg_preview.html", html);

(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(os.tmpdir(), "svgrender-" + Date.now()),
    { headless: true, executablePath: EXE });
  const page = await ctx.newPage();
  const rows = Math.ceil(icons.length / 4);
  await page.setViewportSize({ width: 4 * 175, height: rows * 175 });
  await page.goto("file://" + (TOOLS + "/_icons_svg_preview.html").replace(/\\/g, "/"));
  await page.waitForTimeout(400);
  await page.screenshot({ path: TOOLS + "/_icons_svg_render.png" });
  await ctx.close();
  console.log("rendered " + icons.length + " SVG icons -> " + TOOLS + "/_icons_svg_render.png");
})().catch(e => { console.error("FAIL", e && e.stack || e); process.exit(1); });
