// 真实验证：从改后的 ppt-super.js 提取 parseSvgArray / pickIconAi 真实函数体执行
// 用用户那次真实的 14 图标 DeepSeek JSON（单引号 svg 属性）+ 多种形态测
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'ppt-super.js'), 'utf8');
function extractFn(name) {
  const start = src.indexOf('function ' + name);
  if (start < 0) throw new Error('NOT FOUND: ' + name);
  let depth = 0, j = src.indexOf('{', start);
  for (; j < src.length; j++) { const ch = src[j]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) { j++; break; } } }
  return src.slice(start, j);
}
eval(extractFn('parseSvgArray'));
eval(extractFn('pickIconAi'));

// ── 用户那次真实输出（14 个，svg 属性用单引号）──
const userJson = `[{"name":"上行吞吐","svg":"<svg width='24' height='24' viewBox='0 0 24 24'><circle cx='12' cy='12' r='10' fill='#1F4E79' opacity='0.12'/><path d='M12,20 L12,4 M8,8 L12,4 L16,8' stroke='#1F4E79' stroke-width='1.6' fill='none'/><circle cx='12' cy='4' r='1.5' fill='#C8102E'/></svg>"},{"name":"时延抖动","svg":"<svg width='24' height='24' viewBox='0 0 24 24'><path d='M2,12 L4,6 L6,16 L8,8 L10,14 L12,10' stroke='#1F4E79' stroke-width='1.6' fill='none'/><circle cx='20' cy='12' r='1.5' fill='#C8102E'/></svg>"},{"name":"计算资源","svg":"<svg width='24' height='24' viewBox='0 0 24 24'><rect x='4' y='4' width='16' height='16' stroke='#1F4E79' fill='none'/><circle cx='12' cy='12' r='1.5' fill='#C8102E'/></svg>"},{"name":"网络资源","svg":"<svg width='24' height='24' viewBox='0 0 24 24'><path d='M6,6 L18,6 L12,18 Z' stroke='#1F4E79' fill='none'/></svg>"},{"name":"存储资源","svg":"<svg width='24' height='24' viewBox='0 0 24 24'><path d='M4,6 Q12,2 20,6 L20,18 Q12,22 4,18 Z' stroke='#1F4E79' fill='none'/></svg>"},{"name":"审计存证","svg":"<svg width='24' height='24' viewBox='0 0 24 24'><path d='M4,6 L12,2 L20,6 L20,18 Q12,22 4,18 Z M8,12 L12,16 L18,8' stroke='#1F4E79' fill='none'/></svg>"},{"name":"调度核心","svg":"<svg width='24' height='24' viewBox='0 0 24 24'><path d='M12,8 L12,16 M8,12 L16,12' stroke='#1F4E79'/><circle cx='12' cy='12' r='1.5' fill='#C8102E'/></svg>"},{"name":"资源画像","svg":"<svg width='24' height='24' viewBox='0 0 24 24'><circle cx='12' cy='12' r='5' stroke='#1F4E79' fill='none'/><line x1='16' y1='16' x2='20' y2='20' stroke='#1F4E79'/></svg>"},{"name":"恢复自愈","svg":"<svg width='24' height='24' viewBox='0 0 24 24'><path d='M6,12 A6,6 0 1,1 18,12' stroke='#1F4E79' fill='none'/><circle cx='6' cy='12' r='1.5' fill='#C8102E'/></svg>"},{"name":"验收保障","svg":"<svg width='24' height='24' viewBox='0 0 24 24'><rect x='4' y='6' width='16' height='12' stroke='#1F4E79' fill='none'/><path d='M8,12 L12,16 L18,8' stroke='#1F4E79'/></svg>"},{"name":"上行容量","svg":"<svg width='24' height='24' viewBox='0 0 24 24'><path d='M4,16 L7,16 L7,10 L4,10 Z' stroke='#1F4E79' fill='none'/><circle cx='12' cy='6' r='1.5' fill='#C8102E'/></svg>"},{"name":"恢复时长","svg":"<svg width='24' height='24' viewBox='0 0 24 24'><path d='M6,4 L18,4 L12,10 Z' stroke='#1F4E79' fill='none'/></svg>"},{"name":"算力空转","svg":"<svg width='24' height='24' viewBox='0 0 24 24'><path d='M12,4 L12,20 M8,16 L12,20 L16,16' stroke='#1F4E79' fill='none'/></svg>"},{"name":"审计覆盖","svg":"<svg width='24' height='24' viewBox='0 0 24 24'><path d='M12,12 L12,2 A10,10 0 0,1 22,12 Z' stroke='#1F4E79' fill='none'/></svg>"}]`;

let pass = 0, fail = 0;
const chk = (name, cond, extra) => { if (cond) { pass++; console.log('  OK  ' + name + (extra ? ' [' + extra + ']' : '')); } else { fail++; console.log('  XX  FAIL ' + name + (extra ? ' [' + extra + ']' : '')); } };

console.log('=== parseSvgArray（真实用户 JSON 各形态）===');
const a1 = parseSvgArray(userJson);
chk('裸 JSON 数组提取 14 个', a1 && a1.length === 14, '得 ' + (a1 ? a1.length : null));
chk('每项含完整 <svg>...</svg>', a1 && a1.every(x => x.svg && /<svg[\s\S]*<\/svg>/.test(x.svg)));
const a2 = parseSvgArray('好的，这是 14 个图标：\n```json\n' + userJson + '\n```\n希望有帮助！');
chk('带 ```json 代码块 + 前后说明（用户那次形态）', a2 && a2.length === 14, '得 ' + (a2 ? a2.length : null));
const cut = userJson.slice(0, 900);
const a3 = parseSvgArray(cut + ' ...(网络截断未闭合)');
chk('残缺/未闭合 JSON 仍容错提出 >=2 个', a3 && a3.length >= 2, '得 ' + (a3 ? a3.length : null));
const ent = userJson.replace(/</g, '&lt;').replace(/>/g, '&gt;');
const a4 = parseSvgArray(ent);
chk('HTML 实体 &lt;svg&gt; 反转义后提取 14 个', a4 && a4.length === 14, '得 ' + (a4 ? a4.length : null));
chk('空串/垃圾返回 null（不误报）', parseSvgArray('随便聊聊天没有 svg') === null);

console.log('=== pickIconAi（gemini 殿后 + preferId + 兜底）===');
chk('gemini+deepseek → deepseek（不再优先 gemini）', pickIconAi([{service:'gemini',id:1},{service:'deepseek',id:2}]).service === 'deepseek');
chk('gemini+chatgpt+claude → claude（最优先）', pickIconAi([{service:'gemini',id:1},{service:'chatgpt',id:2},{service:'claude',id:3}]).service === 'claude');
chk('只有 gemini → 仍可用 gemini', pickIconAi([{service:'gemini',id:1}]).service === 'gemini');
chk('preferId 指定优先命中', pickIconAi([{service:'claude',id:1},{service:'deepseek',id:2}], 2).service === 'deepseek');
chk('空数组 → null', pickIconAi([]) === null);
chk('未知 service → parts[0] 兜底', pickIconAi([{service:'xyz',id:9}]).service === 'xyz');

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
