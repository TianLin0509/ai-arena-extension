// 验证优化波逻辑：超长字段统计（红框/汇总用）+ computeLines（引擎用），真实数据真实执行
const fs = require("fs");
const S = "C:/Users/lintian/AI_debate/ai-arena-extension/src/ppt-super";
const PptFill = require(S + "/ppt-fill.js");
const tpls = JSON.parse(fs.readFileSync(S + "/templates.json", "utf-8"));
const t = tpls.templates.find(x => x.id === "tpl-04-asis-tobe");

// 第一波 gemini 真实文案的关键字段（含已知超长项）
const data = {
  chip: "性能优化",
  title_main: "昇腾超节点集群性能系统性优化，万亿模型有效训练时长提升至96%",
  asis_title: "现状：通用组网方案下集群有效算力释放不足",
  asis_bullets: "很短的一句"
};
const over = t.slots.filter(s => s.type !== "image" && s.chars && data[s.key] != null
  && String(data[s.key]).length > s.chars[1]);
console.log("=== 超长检测（红框/汇总逻辑）===");
over.forEach(s => console.log("  " + s.key + ": " + String(data[s.key]).length + " > 上限 " + s.chars[1] + " → 标红框"));
console.log("over count = " + over.length + "（预期 title_main + asis_title 超长，与第一波编辑区红字一致）");

console.log("\n=== computeLines（引擎分行）===");
console.log("para  '多  空格\\n换行' ->", JSON.stringify(PptFill.computeLines("para", "多  空格\n换行")));
console.log("bullets 'a\\nb'       ->", JSON.stringify(PptFill.computeLines("bullets", "a\nb")));
console.log("title  'x\\ny'        ->", JSON.stringify(PptFill.computeLines("title", "x\ny")));
