// _verify_insight_e2e.js — 端到端：用真实 PptFill.build 填充 3 个 insight 模板（mock 文字+mock 图），
//   验证①填充不报错 ②所有 [key] shape 命中 ③无英文占位/lorem 残留。产出 _insight_*.pptx 供 COM 渲染看视觉。
const fs = require("fs");
const SUPER = "C:/Users/lintian/AI_debate/ai-arena-extension/src/ppt-super";
global.JSZip = require(SUPER + "/jszip.min.js");
const PptFill = require(SUPER + "/ppt-fill.js");
const tpls = JSON.parse(fs.readFileSync(SUPER + "/templates.json", "utf8")).templates;
const MOCKIMG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const IDS = ["tpl-101-insight-lineage-map", "tpl-102-insight-evolution-path", "tpl-103-insight-taxonomy-decision"];

(async () => {
  for (const tid of IDS) {
    const tpl = tpls.find((t) => t.id === tid);
    const data = {}, images = {};
    tpl.slots.forEach((s) => {
      if (s.type === "image" || s.type === "icon") { images[s.key] = MOCKIMG; return; }
      const hi = (s.chars && s.chars[1]) || 10;
      const base = "测填" + s.key.replace(/_/g, "");        // 以"测填"开头，便于识别哪些是 mock、哪些是残留
      data[s.key] = base.slice(0, Math.max(2, Math.min(hi, base.length)));
    });
    const buf = fs.readFileSync(SUPER + "/assets/" + tid + "/template.pptx");
    const out = await PptFill.build(buf, tpl.slots, data, images, "nodebuffer");
    fs.writeFileSync(SUPER + "/tools/_insight_" + tid.split("-")[1] + ".pptx", out);
    // 残留检查：读回 slide 文字，非"测填"开头的就是模板固定/占位残留
    const xml = await (await JSZip.loadAsync(out)).file("ppt/slides/slide1.xml").async("string");
    const texts = (xml.match(/<a:t>([^<]*)<\/a:t>/g) || []).map((x) => x.replace(/<\/?a:t>/g, "")).filter((t) => t.trim());
    const residual = texts.filter((t) => t.indexOf("测填") !== 0);
    const textSlots = tpl.slots.filter((s) => s.type !== "image" && s.type !== "icon").length;
    console.log(tid + ":\n  " + out.length + "B · " + tpl.slots.length + "槽(" + textSlots + " text) · 填后非空文字段 " + texts.length +
      "\n  残留(非mock文字) " + residual.length + (residual.length ? " → [" + residual.slice(0, 12).join(" | ") + "]" : " ✓ 无残留"));
  }
})().catch((e) => { console.error("FAIL", e && e.stack || e); process.exit(1); });
