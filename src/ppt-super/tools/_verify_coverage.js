// _verify_coverage.js — 验证抓取完成判定的「字段覆盖率 gate」：提取真实 extractBlocks，
//   模拟流式输出各阶段（半截 _plan / _plan 完整但无 slot / 半数 slot / 全 slot），
//   确认只有覆盖率 ≥80% 的完整 JSON 才被判为"完成"，半截不会让流程提前跳第三步（修 bug：字段全 0）。
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
// 抓取链 extractBlocks→parseOne→repair（从 ppt-super.js 原样复制；含正则花括号，无法用括号配平提取）
function repair(s) {
  return s.trim().replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/，(\s*[}\]])/g, "$1").replace(/,(\s*[}\]])/g, "$1");
}
function parseOne(raw) {
  var s = repair(raw);
  try { return JSON.parse(s); } catch (e) {}
  var a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) {
    var sub = s.slice(a, b + 1);
    try { return JSON.parse(sub); } catch (e) {}
    var op = (sub.match(/{/g) || []).length, cl = (sub.match(/}/g) || []).length;
    if (op > cl) { try { return JSON.parse(sub + "}".repeat(op - cl)); } catch (e) {} }
  }
  return null;
}
function extractBlocks(text) {
  var out = [], re = /```(?:json)?\s*([\s\S]*?)```/gi, m;
  while ((m = re.exec(text))) { var o = parseOne(m[1]); if (o) out.push(o); }
  if (!out.length) { var o = parseOne(text); if (o) out.push(o); }
  return out;
}

const TID = "tpl-11-four-cards";  // 截图里的"横向四卡片"
const tpl = JSON.parse(fs.readFileSync(path.join(ROOT, "templates.json"), "utf8")).templates.find((t) => t.id === TID);
const textKeys = tpl.slots.filter((s) => s.type !== "image" && s.type !== "icon" && !/箭头/.test((s.zh || "") + (s.hint || ""))).map((s) => s.key);
function coverage(b) {
  if (!b || typeof b !== "object" || !textKeys.length) return 0;
  const hit = textKeys.filter((k) => { const v = b[k]; return v != null && String(v).trim() !== ""; }).length;
  return hit / textKeys.length;
}
function evalText(text) {
  const blocks = extractBlocks(text);
  const cand = blocks.length ? blocks[blocks.length - 1] : null;
  const cov = cand ? coverage(cand) : 0;
  return { cov, done: !!(cand && cov >= 0.8) };
}

console.log("模板 " + TID + " · 文字槽 " + textKeys.length + " 个: " + textKeys.join(", ") + "\n");

// 用例：模拟流式各阶段读到的文本
const full = { _plan: { thesis: "四大能力就绪" } }; textKeys.forEach((k) => (full[k] = "围绕主题的内容" + k));
const half = { _plan: { thesis: "x" } }; textKeys.slice(0, Math.floor(textKeys.length / 2)).forEach((k) => (half[k] = "内容"));
const planOnly = { _plan: { thesis: "测试主题的核心判断", story_spine: "判断→证据→收束", topic_anchor_terms: ["术语A", "术语B"] } };

const cases = [
  ["① 刚开始(```json 未闭合, 只有 _plan 开头)", "好的，正在生成：\n\n```json\n{\n  \"_plan\": {\n    \"page_task\": \"介绍"],
  ["② _plan 写完但 slot 未开始(闭合块, 无 slot key)", "```json\n" + JSON.stringify(planOnly, null, 2) + "\n```"],
  ["③ 写了约半数 slot", "```json\n" + JSON.stringify(half, null, 2) + "\n```"],
  ["④ 全部 slot 写完(完整)", "```json\n" + JSON.stringify(full, null, 2) + "\n```"],
];
let pass = 0;
const expect = [false, false, false, true];  // 只有 ④ 该判为完成
cases.forEach(([label, text], idx) => {
  const r = evalText(text);
  const ok = r.done === expect[idx];
  if (ok) pass++;
  console.log((ok ? "✓" : "✗") + " " + label);
  console.log("    覆盖率 " + Math.round(r.cov * 100) + "% → 判定" + (r.done ? "【完成,可跳第三步】" : "【未完,继续等】") + "  (期望" + (expect[idx] ? "完成" : "继续等") + ")");
});
console.log("\n结果: " + pass + "/" + cases.length + (pass === cases.length ? "  gate 行为全部正确 ✓ —— 半截 JSON 被拦住、只有完整 JSON 放行" : "  ✗ 有偏差"));
