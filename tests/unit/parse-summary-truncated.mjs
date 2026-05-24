// 单元测试：v4.8.13 F29 截断 JSON 自动修复
// 验证用户截图里那段实际截断的 JSON 能被解析出来
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "..", "..", "src", "debate-summary-template.js");

// 跑 debate-summary-template.js 内的 IIFE，挂到 globalThis
const code = fs.readFileSync(SRC, "utf8");
const wrap = `
  globalThis.self = globalThis;
  ${code}
`;
// eslint-disable-next-line no-new-func
new Function(wrap)();

const { parse } = globalThis.DebateSummaryTemplate;

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`✅ ${name}`); }
  else { failed++; console.log(`❌ ${name}${detail ? "  → " + JSON.stringify(detail).slice(0, 200) : ""}`); }
}

// --- 用例 1: 用户实际截图里的截断 JSON ---
const truncated = `{"topic":"先有鸡还是先有蛋？","core_conclusion":"该问题无唯一标准答案，进化生物学层面先有蛋。","consensus":["A","B","C"],"disagreements":["X","Y"],"open_questions":["Q1"],"key_arguments":[{"title":"层面1","supports":[{"ai":"豆包","text":"理由1"}],"opposes":[]}],"highlights":[{"ai":"Kimi","text":"亮点1","round":2}],"next_steps":["Step1"],"rounds":[{"num":1,"title":"交锋","voices":[{"ai":"豆包","text":"声音1"},{"ai":"Kimi","text":"声音2"}]},{"num":2,"title":"深化","voices":[{"ai":"豆包","text":"声音3"},{"ai":"Kimi","text":"声音4"}]}`;

const r1 = parse(truncated);
check("用户截断 JSON 能被解析", r1 != null);
check("topic 正确", r1?.topic === "先有鸡还是先有蛋？");
check("rounds 是数组且包含 2 项", Array.isArray(r1?.rounds) && r1.rounds.length === 2);
check("rounds[1].voices 完整", r1?.rounds?.[1]?.voices?.length === 2);

// --- 用例 2: 完整有效 JSON 应正常 ---
const valid = `{"topic":"X","core_conclusion":"Y","consensus":["a"],"rounds":[]}`;
const r2 = parse(valid);
check("完整 JSON 正常 parse", r2?.topic === "X" && Array.isArray(r2?.rounds));

// --- 用例 3: 仅缺最外层 } ---
const missingClose = `{"topic":"T","core_conclusion":"C","rounds":[{"num":1,"voices":[]}]`;
const r3 = parse(missingClose);
check("缺最外层 } 能补齐", r3?.topic === "T" && r3?.rounds?.[0]?.num === 1);

// --- 用例 4: 截断在 string 中间（尚未闭合）---
const midString = `{"topic":"T","core_conclusion":"内容还没完成…`;
const r4 = parse(midString);
check("截断在 string 中间能补齐", r4?.topic === "T", r4);

// --- 用例 5: ```json 围栏 + 截断 ---
const fenced = "```json\n" + truncated + "\n```";
const r5 = parse(fenced);
check("围栏 + 截断双重容错", r5?.rounds?.length === 2);

// --- 用例 6: 完全空 / 非 JSON 仍返回 null ---
check("空字符串返回 null", parse("") === null);
check("纯文字返回 null", parse("这只是普通文字，没 JSON") === null);

console.log(`\n结果: ${passed} 通过 / ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
