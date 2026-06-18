// _verify_research_opt.js — 提取真实 archetypeOf / buildResearchPrompt / materialBriefFor / materialReady / collectGaps /
//   buildPromptFor，做纯函数自检：①29 套模板原型映射 ②research prompt 结构 ③素材池注入落字 ④向后兼容 ⑤工具函数。
//   不执行 IIFE（按花括号/方括号配平抠源码，new Function 注入 S/tplById），证明素材池两阶段管线逻辑正确。
// 用法: node _verify_research_opt.js
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "ppt-super.js"), "utf8");

// 花括号配平抠 {…}（变量对象 / 函数体）
function sliceBalanced(startIdx, open, close) {
  open = open || "{"; close = close || "}";
  let d = 0, j = src.indexOf(open, startIdx);
  for (let k = j; k < src.length; k++) {
    if (src[k] === open) d++;
    else if (src[k] === close) { d--; if (d === 0) return src.slice(startIdx, k + 1); }
  }
  throw new Error("unbalanced from " + startIdx);
}
function extractVar(name) { const i = src.indexOf("var " + name + " = {"); if (i < 0) throw new Error("no var " + name); return sliceBalanced(i) + ";"; }
function extractArr(name) { const i = src.indexOf("var " + name + " = ["); if (i < 0) throw new Error("no arr " + name); return sliceBalanced(i, "[", "]") + ";"; }
function extractFn(name) { const i = src.indexOf("function " + name + "("); if (i < 0) throw new Error("no fn " + name); return sliceBalanced(i); }

const bundle = [
  extractArr("ARCHETYPE_TABLE"),
  extractFn("archetypeMeta"),
  extractFn("archetypeOf"),
  extractFn("refineSlotRole"),
  extractFn("tplDigest"),
  extractVar("ROLE_CONTRACT"),
  extractFn("materialReady"),
  extractFn("collectGaps"),
  extractFn("materialBriefFor"),
  extractFn("buildResearchPrompt"),
  extractFn("buildPromptFor"),
].join("\n");

const tpls = JSON.parse(fs.readFileSync(path.join(ROOT, "templates.json"), "utf8")).templates;
const S = { topic: "测试主题：某新技术在某场景的性能优化", extra: "" };
const tplById = (id) => tpls.find((t) => t.id === id);
const api = new Function("S", "tplById",
  bundle + "\nreturn {archetypeOf, archetypeMeta, tplDigest, buildResearchPrompt, materialReady, collectGaps, materialBriefFor, buildPromptFor};")(S, tplById);

let pass = 0, total = 0;
const chk = (name, cond) => { total++; if (cond) pass++; console.log((cond ? "  [PASS] " : "  [FAIL] ") + name); return cond; };

// ===== ① 29 套模板 → 原型映射 =====
console.log("\n===== (1) archetypeOf：29 套模板 → 5 大论证原型 =====");
const dist = {};
tpls.forEach((t) => { const a = api.archetypeOf(t); dist[a] = (dist[a] || 0) + 1; });
tpls.forEach((t) => { console.log("  " + (t.id + "                                  ").slice(0, 36) + " → " + api.archetypeOf(t)); });
console.log("  分布: " + JSON.stringify(dist));
chk("tpl-101 脉络分支图 → panorama_layer", api.archetypeOf(tplById("tpl-101-insight-lineage-map")) === "panorama_layer");
chk("tpl-102 演进路径图 → evolution_stage", api.archetypeOf(tplById("tpl-102-insight-evolution-path")) === "evolution_stage");
chk("tpl-103 选型矩阵 → compare_decide", api.archetypeOf(tplById("tpl-103-insight-taxonomy-decision")) === "compare_decide");
chk("tpl-01 2x2四模块网格 → multi_dimension", api.archetypeOf(tplById("tpl-01-quad-grid")) === "multi_dimension");
chk("general 占比 < 40%（大部分能归类）", (dist.general || 0) / tpls.length < 0.4);
chk("5 大原型至少命中 4 类（覆盖均衡）", Object.keys(dist).filter((k) => k !== "general").length >= 4);

// ===== ② research prompt 结构 =====
console.log("\n===== (2) buildResearchPrompt 结构自检 =====");
const rp = api.buildResearchPrompt(["tpl-103-insight-taxonomy-decision", "tpl-01-quad-grid"]);
fs.writeFileSync(path.join(__dirname, "_verify_research_prompt_out.txt"), rp);
chk("含 common 通用料仓 schema", /"common"/.test(rp) && /anchor_terms/.test(rp) && /key_data/.test(rp) && /mechanisms/.test(rp));
chk("含 by_archetype 按原型分配", /"by_archetype"/.test(rp) && /material_map/.test(rp) && /required_evidence/.test(rp));
chk("含 gaps 缺口字段", /gaps/.test(rp));
chk("含 visual_evidence + image_type 分型", /visual_evidence/.test(rp) && /image_type/.test(rp));
chk("含 confidence 置信度标注", /confidence/.test(rp));
chk("要求联网检索", /联网检索/.test(rp));
chk("含论证原型对照表(5 类)", /compare_decide/.test(rp) && /evolution_stage/.test(rp) && /multi_dimension/.test(rp) && /causal_argument/.test(rp) && /panorama_layer/.test(rp));
chk("含选中模板摘要(tplDigest: id+原型)", /id=tpl-103/.test(rp) && /代码初判原型:/.test(rp));
chk("涉及原型去重列出", /本次实际涉及的原型（去重）/.test(rp));
chk("只输出一个 json 代码块", /只输出这一个/.test(rp) && /```json/.test(rp));
chk("topic 来自输入(含且仅含该 topic)", rp.includes(S.topic));
chk("无固定测试题材残留(昇腾/DeepSeek四阶段)", !/昇腾|deepseek四|DeepSeek 四/i.test(rp));
chk("正向措辞：无『不要写成 X』+反例诱导", !/不要写成|别写成/.test(rp));

// ===== ③ 工具函数：materialReady / collectGaps =====
console.log("\n===== (3) materialReady / collectGaps 单元 =====");
const MAT = {
  common: {
    topic_understanding: "测试主题内核与关键矛盾",
    anchor_terms: [{ term: "术语A", meaning: "含义A", why_matters: "贯穿原因A" }, { term: "术语B", meaning: "含义B", why_matters: "贯穿原因B" }],
    key_data: [{ fact: "核心指标提升42%", metric: "口径X", source_hint: "某白皮书", confidence: "high" }, { fact: "单位成本下降30%", metric: "口径Y", confidence: "low" }],
    mechanisms: [{ name: "机制M", how: "动作+对象+产出讲清原理链" }],
    cases: [{ case: "某公司真实落地案例", takeaway: "证明方案可行" }],
    tensions: [{ point: "边界风险R", implication: "意味着需谨慎" }],
    recent: [{ update: "近期重要进展U", date_hint: "2026Q1" }],
  },
  by_archetype: {
    multi_dimension: { template_intent: "四维并列呈现能力", matched_templates: ["tpl-01-quad-grid"], required_evidence: ["4 个正交维度+每维数据"], material_map: { "维度1": "引术语A" }, gaps: ["维度4 缺真实数据"] },
    compare_decide: { template_intent: "选型决断", matched_templates: ["tpl-103-insight-taxonomy-decision"], required_evidence: ["现状痛点量化+目标收益量化"], material_map: {}, gaps: ["缺竞品对比口径"] },
  },
  visual_evidence: [{ idea: "维度对比柱状图", image_type: "data", serves_archetype: "multi_dimension", why: "数字说话" }],
};
chk("materialReady 全齐 = 1.0", api.materialReady(MAT) === 1);
chk("materialReady 仅 anchor_terms = 0.25", api.materialReady({ common: { anchor_terms: [1] } }) === 0.25);
chk("materialReady 空 = 0", api.materialReady(null) === 0 && api.materialReady({}) === 0);
const gaps = api.collectGaps(MAT);
chk("collectGaps 收集 2 条缺口", gaps.length === 2);
chk("collectGaps 带 [原型] 前缀", gaps.some((g) => /^\[multi_dimension\]/.test(g)) && gaps.some((g) => /^\[compare_decide\]/.test(g)));

// ===== ④ materialBriefFor + buildPromptFor 注入（有素材池）=====
console.log("\n===== (4) 素材池注入落字（S.material 存在）=====");
S.material = MAT;
const brief = api.materialBriefFor(tplById("tpl-01-quad-grid"));   // tpl-01 → multi_dimension
fs.writeFileSync(path.join(__dirname, "_verify_material_brief_out.txt"), brief);
chk("brief 含【已核实素材池】标题", /【已核实素材池】/.test(brief));
chk("brief 含 key_data 真实数字", /核心指标提升42%/.test(brief) && /<high>/.test(brief));
chk("brief 含 mechanisms", /机制M/.test(brief));
chk("brief 含 cases", /某公司真实落地案例/.test(brief));
chk("brief 命中本模板原型(multi_dimension)弹药", /multi_dimension/.test(brief) && /4 个正交维度/.test(brief));
chk("brief 暴露本原型 gaps(保守表述)", /维度4 缺真实数据/.test(brief) && /保守表述/.test(brief));
const pWith = api.buildPromptFor("tpl-01-quad-grid", 0, 1);
fs.writeFileSync(path.join(__dirname, "_verify_prompt_with_material_out.txt"), pWith);
chk("buildPromptFor(有料) 注入素材池", /【已核实素材池】/.test(pWith));
chk("buildPromptFor(有料) 第5条改为『从素材池选取』", /只从上面【已核实素材池】选取/.test(pWith));
chk("buildPromptFor(有料) anchor_terms 改为『直接采用素材池』", /直接采用上面素材池/.test(pWith));
chk("buildPromptFor(有料) 仍保留 PPT高手写稿法/三档容量", /PPT高手写稿法/.test(pWith) && /最低 \d+ \/ 目标约 \d+ \/ 硬上限 \d+ 字/.test(pWith));
// image_type 分型只在有图位的模板出现（tpl-01 是纯文字四模块、无图位）→ 动态取一个含 image/icon 槽的模板验证
const tplWithImg = tpls.find((t) => t.slots.some((s) => s.type === "image" || s.type === "icon"));
const pImg = api.buildPromptFor(tplWithImg.id, 0, 1);
chk("buildPromptFor _image_briefs 含 image_type 分型 + serves_archetype(" + tplWithImg.id + ")", /image_type/.test(pImg) && /data=数据图表/.test(pImg) && /serves_archetype/.test(pImg));

// ===== ⑤ 向后兼容（无素材池退回原行为）=====
console.log("\n===== (5) 向后兼容（S.material = null）=====");
S.material = null;
const pNo = api.buildPromptFor("tpl-01-quad-grid", 0, 1);
chk("buildPromptFor(无料) 不含素材池段", !/【已核实素材池】/.test(pNo));
chk("buildPromptFor(无料) 第5条为原版(紧扣主题/绝不编造)", /绝不编造/.test(pNo) && !/只从上面【已核实素材池】选取/.test(pNo));
chk("buildPromptFor(无料) 仍是 PPT高手写稿法结构", /PPT高手写稿法/.test(pNo) && /story_spine/.test(pNo) && /最低 \d+ \/ 目标约 \d+ \/ 硬上限 \d+ 字/.test(pNo));

console.log("\n========================================");
console.log("纯函数自检: " + pass + "/" + total + (pass === total ? "  全部通过 [OK]" : "  有失败 [X]"));
console.log("落盘: _verify_research_prompt_out.txt / _verify_material_brief_out.txt / _verify_prompt_with_material_out.txt");
process.exit(pass === total ? 0 : 1);
