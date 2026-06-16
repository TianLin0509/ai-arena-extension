// 测图片插入引擎：tpl-22 带图模板 + 文本 sample + 测试图 → pptx
const fs = require("fs");
const SUPER = "C:/Users/lintian/AI_debate/ai-arena-extension/src/ppt-super";
global.JSZip = require(SUPER + "/jszip.min.js");
const PptFill = require(SUPER + "/ppt-fill.js");
const LIB = "C:/Users/lintian/ppt-assistant/library/tpl-22-hero-split";

(async () => {
  const desc = JSON.parse(fs.readFileSync(LIB + "/descriptor.json", "utf-8"));
  const slots = desc.slots;
  const data = {}; slots.forEach(s => { if (s.type !== "image" && s.sample) data[s.key] = s.sample; });
  const imgUrl = fs.readFileSync(SUPER + "/tools/_test_img.txt", "utf-8").trim();
  const images = {}; slots.forEach(s => { if (s.type === "image") images[s.key] = imgUrl; });
  const buf = fs.readFileSync(LIB + "/template.pptx");
  const out = await PptFill.build(buf, slots, data, images, "nodebuffer");
  fs.writeFileSync(SUPER + "/tools/_test_img_out.pptx", out);
  console.log("OK", out.length, "bytes; image slots filled:", Object.keys(images));
})().catch(e => { console.error("FAIL", e && e.stack || e); process.exit(1); });
