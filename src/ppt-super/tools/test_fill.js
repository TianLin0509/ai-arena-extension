// node 单测 ppt-fill：用 tpl-04 真实模板 + descriptor sample 数据生成 pptx
// 跑法：node test_fill.js  →  产出 _test_out.pptx，再用 verify_fill.py 读回校验
const fs = require("fs");
const SUPER = "C:/Users/lintian/AI_debate/ai-arena-extension/src/ppt-super";
global.JSZip = require(SUPER + "/jszip.min.js");
const PptFill = require(SUPER + "/ppt-fill.js");

(async () => {
  const tpls = JSON.parse(fs.readFileSync(SUPER + "/templates.json", "utf-8"));
  const tid = process.argv[2] || "tpl-04-asis-tobe";
  const tpl = tpls.templates.find(t => t.id === tid);
  if (!tpl) throw new Error("template not found: " + tid);
  const data = {};
  tpl.slots.forEach(s => { if (s.type !== "image") data[s.key] = s.sample; });
  const buf = fs.readFileSync(SUPER + "/assets/" + tid + "/template.pptx");
  const out = await PptFill.build(buf, tpl.slots, data, null, "nodebuffer");
  const outPath = SUPER + "/tools/_test_out.pptx";
  fs.writeFileSync(outPath, out);
  console.log("OK generated", out.length, "bytes ->", outPath);
})().catch(e => { console.error("FAIL", e && e.stack || e); process.exit(1); });
