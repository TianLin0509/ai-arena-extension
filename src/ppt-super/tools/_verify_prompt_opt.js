// _verify_prompt_opt.js — 提取真实 buildPromptFor（含 ROLE_CONTRACT），喂中性 topic 生成完整文案 prompt，
//   做结构自检 + 落盘供真实 AI 调用。证明 prompt 升级为"PPT高手写稿法"结构正确、topic 完全来自输入。
// 用法: node _verify_prompt_opt.js ["测试topic"] [tplId]
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "ppt-super.js"), "utf8");

// 按花括号配平提取源码片段（不执行整个 IIFE，避免 window/chrome 依赖）
function sliceBalanced(startIdx) {
  let d = 0, j = src.indexOf("{", startIdx);
  for (let k = j; k < src.length; k++) {
    if (src[k] === "{") d++;
    else if (src[k] === "}") { d--; if (d === 0) return src.slice(startIdx, k + 1); }
  }
  throw new Error("unbalanced from " + startIdx);
}
function extractVar(name) { const i = src.indexOf("var " + name + " = {"); if (i < 0) throw new Error("no var " + name); return sliceBalanced(i) + ";"; }
function extractFn(name) { const i = src.indexOf("function " + name + "("); if (i < 0) throw new Error("no fn " + name); return sliceBalanced(i); }

const roleContractSrc = extractVar("ROLE_CONTRACT");
const refineRoleSrc = extractFn("refineSlotRole");
const buildPromptForSrc = extractFn("buildPromptFor");

const tpls = JSON.parse(fs.readFileSync(path.join(ROOT, "templates.json"), "utf8")).templates;
const TOPIC = process.argv[2] || "新一代向量数据库在大模型检索场景下的性能优化进展";
const TID = process.argv[3] || "tpl-99-analysis-solution-split";

// 同一作用域注入 ROLE_CONTRACT + buildPromptFor，S/tplById 作为参数（与扩展内闭包等价）
const factory = new Function("S", "tplById", roleContractSrc + "\n" + refineRoleSrc + "\n" + buildPromptForSrc + "\nreturn buildPromptFor;");
const S = { topic: TOPIC, extra: "" };
const tplById = (id) => tpls.find((t) => t.id === id);
const t = tplById(TID);
if (!t) throw new Error("模板不存在: " + TID);
const buildPromptFor = factory(S, tplById);

const prompt = buildPromptFor(TID, 0, 1);
fs.writeFileSync(path.join(__dirname, "_verify_prompt_out.txt"), prompt);

console.log("===== 生成的文案 prompt（topic=" + TOPIC + " · " + TID + " / " + t.name_cn + "）=====\n");
console.log(prompt);
console.log("\n===== 结构自检 =====");
const imgSlots = t.slots.filter((s) => s.type === "image" || s.type === "icon");
const checks = {
  "PPT高手写稿法 身份": /PPT高手写稿法/.test(prompt),
  "_plan 先构思整页段": /"_plan"/.test(prompt) && /先构思整页/.test(prompt),
  "story_spine 论证主线": /story_spine/.test(prompt),
  "topic_anchor_terms 术语贯穿": /topic_anchor_terms/.test(prompt),
  "slot_story_map 每槽负责哪一刀": /slot_story_map/.test(prompt),
  "角色契约(角色/写法/合格线)": /角色:/.test(prompt) && /写法:/.test(prompt) && /合格线:/.test(prompt),
  "三档容量[最低/目标/硬上限]": /最低 \d+ \/ 目标约 \d+ \/ 硬上限 \d+ 字/.test(prompt),
  ["图片与文案一体化契约" + (imgSlots.length ? "(本模板有" + imgSlots.length + "配图位)" : "")]:
    imgSlots.length ? (/图片与文案一体化契约/.test(prompt) && /_image_briefs/.test(prompt)) : true,
  "topic 完全来自输入(prompt 含且仅含该 topic)": prompt.includes(TOPIC),
  "无固定测试 topic 残留(昇腾/华为汇报/DeepSeek/某公司)": !/昇腾|华为汇报|DeepSeek|deepseek四/i.test(prompt),
  "无二次微调复杂交互文案": !/微调容量|二次 ?prompt|抓取并应用/i.test(prompt),
};
let pass = 0, total = 0;
Object.entries(checks).forEach(([k, v]) => { total++; if (v) pass++; console.log((v ? "  ✓ " : "  ✗ ") + k); });
console.log("\n结构自检: " + pass + "/" + total + (pass === total ? "  全部通过 ✓" : "  有失败 ✗"));
console.log("prompt 已落盘: " + path.join(__dirname, "_verify_prompt_out.txt") + "（供真实 AI 调用）");
console.log("文字槽 " + t.slots.filter((s) => s.type !== "image" && s.type !== "icon").length + " 个 · 配图槽 " + imgSlots.length + " 个");
