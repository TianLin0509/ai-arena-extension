// _verify_tpl101.js — 用用户截图里的真实长文本注入 tpl-101，建双页验证几何截断修复重叠
// 用法: node _verify_tpl101.js
const fs = require("fs");
const path = require("path");
const SUPER = path.join(__dirname, "..");
global.JSZip = require(SUPER + "/jszip.min.js");
const PptFill = require(SUPER + "/ppt-fill.js");
const OUT = path.join(__dirname, "_e2e_out");
const T = require(SUPER + "/templates.json").templates;
const tpl = T.find((t) => t.id === "tpl-101-insight-lineage-map");
const bytes = fs.readFileSync(path.join(SUPER, tpl.pptx.replace(/^ppt-super\//, "")));

// 基底用 E2E 数据填满 87 槽，再覆盖用户截图里那些"超长导致重叠"的槽
const data = JSON.parse(fs.readFileSync(path.join(OUT, "tpl-101-insight-lineage-map.data.json"), "utf8"));
const OV = {
  title_main: "中国AI大模型三年跃迁：从追赶到MoE引领，效率成为新分水岭",
  subtitle: "按2018-2026年时间线梳理技术追赶、规模扩张、架构创新三阶段，呈现密集模型与MoE稀疏模型的分岔格局",
  report_label: "中国AI大模型演进报告 | P.2",
  left_panel_title: "演进脉络与格局演变",
  overview_title: "三年跃迁，架构创新破局",
  overview_body: "中国AI大模型自2018年ERNIE 1.0起步，历经GPT-3启发的规模竞赛",
  branch_title: "架构分岔：密集规模vs稀疏效率",
  branch_body: "百度文心、腾讯混元等代表密集模型路线，追求参数规模极致；DeepSeek、MiniMax等则走MoE稀疏路线",
  boundary_title: "三重约束界定产业边界",
  boundary_body: "算力供给的自主可控、高质量中文语料获取、以及内容安全与合规要求，共同构成中国AI大模型发展的三项核心约束",
  timeline_title: "中国AI大模型时间线与企业谱系",
  judgment_panel_title: "本页产业判断",
  judgment_title: "MoE架构成国产模型差异化优势",
  opportunity_title: "机会窗口",
  metric_strip_title: "关键量化证据",
};
Object.assign(data, OV);

(async () => {
  const buf = await PptFill.build(bytes, tpl.slots, data, null, "nodebuffer");
  fs.writeFileSync(path.join(OUT, "_verify_tpl101.pptx"), buf);

  // 报告：被覆盖的超长槽，第1页截断后 vs 原文，及是否 ≤ 框容量
  const tr = PptFill.truncateData(tpl.slots, data);
  console.log("覆盖的超长槽 → 第1页硬截到模板上限 chars[1]（字数=模板，填满框）：");
  let bad = 0;
  Object.keys(OV).forEach((k) => {
    const s = tpl.slots.find((x) => x.key === k); if (!s) return;
    const hi = s.chars && s.chars[1]; if (!hi) return;
    const cut = String(tr[k]).replace(/\s+/g, " ");
    const fit = cut.length <= hi;
    if (!fit) bad++;
    console.log(`  ${k}: 「${data[k]}」(${String(data[k]).length}字) → 第1页「${cut}」(${cut.length}字) 上限${hi} ${fit ? "✓" : "✗超"}`);
  });
  console.log("\n第1页全部 ≤ 模板上限:", bad === 0 ? "✓ 是（字数=模板，填满框、不溢出）" : "✗ " + bad + " 处超");
  console.log("→ 存盘 _verify_tpl101.pptx（page1=截断 page2=全量，待渲染对比）");
})().catch((e) => { console.error("ERR", e.stack || e); process.exit(1); });
