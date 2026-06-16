// node 验证 ppt-fill 的 icon+image 贴图：tpl-99 的 7 image + 7 icon 都给测试图，确认贴进 pptx
// 跑法：node test_icon_fill.js  → 产出 _test_icon_out.pptx，再用 count_pics.py 数 <p:pic>
const fs = require("fs");
const SUPER = "C:/Users/lintian/AI_debate/ai-arena-extension/src/ppt-super";
global.JSZip = require(SUPER + "/jszip.min.js");
const PptFill = require(SUPER + "/ppt-fill.js");
// 最小合法 PNG（1x1 红点）当占位图，验证贴图链路（真图由切割/生成提供）
const PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

(async () => {
  const tpls = JSON.parse(fs.readFileSync(SUPER + "/templates.json", "utf-8"));
  const tid = process.argv[2] || "tpl-99-analysis-solution-split";
  const tpl = tpls.templates.find(t => t.id === tid);
  if (!tpl) throw new Error("template not found: " + tid);
  const data = {}, images = {};
  tpl.slots.forEach(s => {
    if (s.type === "image" || s.type === "icon") images[s.key] = PX;
    else data[s.key] = s.sample;
  });
  const buf = fs.readFileSync(SUPER + "/assets/" + tid + "/template.pptx");
  const out = await PptFill.build(buf, tpl.slots, data, images, "nodebuffer");
  const outPath = SUPER + "/tools/_test_icon_out.pptx";
  fs.writeFileSync(outPath, out);
  const nImg = tpl.slots.filter(s => s.type === "image").length;
  const nIcon = tpl.slots.filter(s => s.type === "icon").length;
  console.log("OK", out.length, "bytes | fed", nImg, "image +", nIcon, "icon =", nImg + nIcon, "pics ->", outPath);
})().catch(e => { console.error("FAIL", e && e.stack || e); process.exit(1); });
