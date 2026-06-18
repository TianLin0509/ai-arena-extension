// _verify_ab_research.js — 真实 A/B 对比驱动：旧流程(直接落字) vs 新流程(研究轮→注入素材池→落字)。
//   研究轮 prompt 交给带联网的 AI(Gemini)；落字 prompt 交给 AI(DeepSeek)；本脚本只负责"生成 prompt + 回填素材池 + 机器对比统计"。
// 用法:
//   node _verify_ab_research.js gen "<topic>" <tid>          → 落盘 _ab_research.txt(研究指令) + _ab_old.txt(旧·无料落字)
//   node _verify_ab_research.js inject "<topic>" <tid> <material.json> → 读素材池落盘 _ab_new.txt(新·有料落字)
//   node _verify_ab_research.js compare <old_json> <new_json>  → 机器统计两份落字 JSON 的数据密度/案例/术语
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "ppt-super.js"), "utf8");

function sliceBalanced(startIdx, open, close) {
  open = open || "{"; close = close || "}";
  let d = 0, j = src.indexOf(open, startIdx);
  for (let k = j; k < src.length; k++) {
    if (src[k] === open) d++;
    else if (src[k] === close) { d--; if (d === 0) return src.slice(startIdx, k + 1); }
  }
  throw new Error("unbalanced");
}
const eVar = (n) => { const i = src.indexOf("var " + n + " = {"); return sliceBalanced(i) + ";"; };
const eArr = (n) => { const i = src.indexOf("var " + n + " = ["); return sliceBalanced(i, "[", "]") + ";"; };
const eFn = (n) => { const i = src.indexOf("function " + n + "("); return sliceBalanced(i); };
const bundle = [eArr("ARCHETYPE_TABLE"), eFn("archetypeMeta"), eFn("archetypeOf"), eFn("refineSlotRole"), eFn("tplDigest"),
  eVar("ROLE_CONTRACT"), eFn("materialReady"), eFn("collectGaps"), eFn("materialBriefFor"), eFn("buildResearchPrompt"), eFn("buildPromptFor")].join("\n");

const tpls = JSON.parse(fs.readFileSync(path.join(ROOT, "templates.json"), "utf8")).templates;
const S = { topic: "", extra: "", material: null };
const tplById = (id) => tpls.find((t) => t.id === id);
const api = new Function("S", "tplById", bundle + "\nreturn {archetypeOf, buildResearchPrompt, buildPromptFor};")(S, tplById);

const mode = process.argv[2];
const OUT = (n, txt) => { const p = path.join(__dirname, n); fs.writeFileSync(p, txt); console.log("落盘: " + p + " (" + txt.length + " 字)"); };

if (mode === "gen") {
  S.topic = process.argv[3]; S.material = null;
  const tid = process.argv[4];
  console.log("topic = " + S.topic + "\n模板 = " + tid + " · 原型 = " + api.archetypeOf(tplById(tid)));
  OUT("_ab_research.txt", api.buildResearchPrompt([tid]));
  OUT("_ab_old.txt", api.buildPromptFor(tid, 0, 1));   // 旧流程：无素材池直接落字
} else if (mode === "inject") {
  S.topic = process.argv[3];
  const tid = process.argv[4];
  S.material = JSON.parse(fs.readFileSync(process.argv[5], "utf8"));
  console.log("注入素材池 → " + tid + " · 原型 = " + api.archetypeOf(tplById(tid)));
  OUT("_ab_new.txt", api.buildPromptFor(tid, 0, 1));   // 新流程：注入素材池落字
} else if (mode === "compare") {
  const load = (p) => { const raw = fs.readFileSync(p, "utf8"); const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/i); try { return JSON.parse(m ? m[1] : raw); } catch (e) { const a = raw.indexOf("{"), b = raw.lastIndexOf("}"); return JSON.parse(raw.slice(a, b + 1)); } };
  const stat = (obj) => {
    const vals = Object.entries(obj).filter(([k]) => k[0] !== "_").map(([, v]) => (typeof v === "string" ? v : "")).filter(Boolean);
    const all = vals.join(" ");
    const nums = (all.match(/\d+(?:\.\d+)?\s*(?:%|倍|万|亿|亿元|TB|GB|PB|核|卡|节点|个|条|天|秒|ms|分|月|年|代|x|X|倍速)?/g) || []).filter((s) => /\d/.test(s));
    const filled = vals.length;
    const chars = all.length;
    return { filled, chars, numCount: nums.length, numSample: nums.slice(0, 12) };
  };
  const o = load(process.argv[3]), n = load(process.argv[4]);
  const so = stat(o), sn = stat(n);
  console.log("\n===== A/B 机器统计（旧 vs 新）=====");
  console.log("字段填充数  : 旧 " + so.filled + "  →  新 " + sn.filled);
  console.log("正文总字数  : 旧 " + so.chars + "  →  新 " + sn.chars);
  console.log("量化数据点  : 旧 " + so.numCount + "  →  新 " + sn.numCount + "   (差 " + (sn.numCount - so.numCount > 0 ? "+" : "") + (sn.numCount - so.numCount) + ")");
  console.log("旧·数字样本 : " + so.numSample.join(" | "));
  console.log("新·数字样本 : " + sn.numSample.join(" | "));
  console.log("\n结论: 数据密度 " + (sn.numCount > so.numCount ? "新流程更高 ✓（按原型研究素材生效）" : sn.numCount === so.numCount ? "持平" : "旧流程更高（需检查素材池质量）"));
} else {
  console.log("用法见文件头注释");
}
