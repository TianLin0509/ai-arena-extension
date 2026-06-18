// _bug_report.js — chars 标定 bug 诊断 + B 重标 + A 几何截断 → 自包含 HTML（含 tpl-101 修复前后实拍）
// 用法: node _bug_report.js
const fs = require("fs");
const path = require("path");
const OUT = path.join(__dirname, "_e2e_out");
const ART = "C:/Users/lintian/Desktop/claude-artifacts";
if (!fs.existsSync(ART)) fs.mkdirSync(ART, { recursive: true });
const b64 = (f) => { const p = path.join(OUT, f); return fs.existsSync(p) ? "data:image/png;base64," + fs.readFileSync(p).toString("base64") : null; };
const before = b64("_verify_tpl101_p2.png");   // 全量=复现重叠
const after = b64("_verify_tpl101_p1.png");     // 几何截断=修好

// B 重标关键样例
const recal = [
  ["overview_title", "左卡标题", "250×28@15pt", "6", "14 → 8", "三年跃迁，架构创新破局 跨行压正文"],
  ["branch_title / boundary_title", "左卡标题", "250×28@15pt", "8", "14 → 8", "同样跨行"],
  ["left_panel_title", "栏目标题", "350×30@17pt", "9", "16 → 9", "略挤"],
  ["judgment_title", "右卡标题", "220×30@15pt", "7", "14 → 7", "跨行"],
  ["subtitle", "副标题", "1380×34@14pt", "47", "64 → 47", "可能折行"],
  ["branch_*_work", "分支节点", "110×30@9.5pt", "5", "14 → 5", "节点溢出"],
];

const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PPT 文字重叠根因与修复 · v5.0.58</title>
<style>
:root{--bg:#fafafa;--card:#fff;--ink:#1d1d1f;--soft:#6e6e73;--border:#d2d2d7;--accent:#0071e3;--ok:#34c759;--warn:#ff9f0a;--bad:#ff3b30;--code-bg:#1d1d1f;--code-ink:#f5f5f7}
@media(prefers-color-scheme:dark){:root{--bg:#1d1d1f;--card:#2c2c2e;--ink:#f5f5f7;--soft:#aeaeb2;--border:#38383a;--accent:#0a84ff}}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font-family:-apple-system,"PingFang SC",system-ui,sans-serif;line-height:1.6;padding:38px 18px;letter-spacing:-.01em}
.wrap{max-width:1080px;margin:0 auto}
h1{font-size:25px;font-weight:700;letter-spacing:-.02em}
.sub{color:var(--soft);font-size:13px;margin:5px 0 20px}
.banner{background:linear-gradient(135deg,rgba(255,59,48,.08),rgba(52,199,89,.07));border:1px solid var(--border);border-radius:14px;padding:18px 22px;margin-bottom:18px;font-size:14.5px}
.banner b{font-weight:700}
h2{font-size:18px;font-weight:700;margin:28px 0 12px}
.box{background:var(--card);border:1px solid var(--border);border-radius:13px;padding:16px 19px;margin-bottom:12px;font-size:13.8px}
.box b{font-weight:700}
.box .k{color:var(--accent);font-weight:700}
table{width:100%;border-collapse:collapse;font-size:12.8px;margin-top:6px}
th,td{text-align:left;padding:7px 9px;border-bottom:1px solid var(--border)}
th{color:var(--soft);font-weight:600}
td .old{color:var(--bad)}td .new{color:var(--ok);font-weight:700}
.cmp{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:6px}
@media(max-width:760px){.cmp{grid-template-columns:1fr}}
figure{margin:0}figcaption{margin-bottom:6px;font-size:12.5px;font-weight:700}
.tag{font-size:11.5px;font-weight:700;padding:3px 9px;border-radius:6px;margin-right:6px}
.tag.b{background:rgba(255,59,48,.13);color:#c0271e}.tag.a{background:rgba(52,199,89,.15);color:#1e7a34}
@media(prefers-color-scheme:dark){.tag.b{color:#ff6b60}.tag.a{color:#5fd97a}}
.cmp img{width:100%;border:1px solid var(--border);border-radius:8px;display:block}
.cap{font-size:12px;color:var(--soft);margin-top:6px;line-height:1.5}
.vlist{list-style:none;display:flex;flex-direction:column;gap:7px}
.vlist li{font-size:13.5px;padding-left:24px;position:relative}
.vlist li::before{content:"✓";position:absolute;left:0;color:var(--ok);font-weight:800}
.files{font-size:13px;color:var(--soft);line-height:1.9}
.files code{font-family:"SF Mono","Consolas",monospace;font-size:12px;background:var(--code-bg);color:var(--code-ink);padding:1px 6px;border-radius:5px}
.foot{color:var(--soft);font-size:12px;margin-top:26px;text-align:center}
</style></head><body><div class="wrap">
<h1>PPT 文字跨行重叠：根因与修复</h1>
<div class="sub">v5.0.58 · 你的判断正确——是模板 chars 字数上限标定 bug · B 重标 + A 几何截断双修 · tpl-101 实拍验证</div>

<div class="banner"><b>一句话：</b>模板把窄框小标题的 chars 上限标成了真实单行容量的 <b>1.5～2 倍</b>（如左卡标题框只容 8 字、却标 14）。AI 写到 11 字"没超上限"，但塞不进 8 字的框 → 跨行 → 压住下方正文。旧的双页截断<b>信了这个错误上限</b>，所以没拦住。现已 <b>B</b> 把 155 个槽的上限按几何容量重标、<b>A</b> 让第1页每个槽硬截到模板上限字数（字数=模板、填满框、不溢出）。</div>

<h2>① 为什么会重叠（根因）</h2>
<div class="box">
关键证据：<span class="k">overview_title</span> 框宽 250(画布)=125pt，字号 15pt → 单行只容 <b>125/15≈8 字</b>。
「三年跃迁，架构创新破局」共 11 字，渲染时第一行正好断在「三年跃迁，架构创」<b>=8 字</b>，第二行「新破局」溢出框、压住下方正文。
公式与真实渲染<b>一字不差</b>，确认 chars 上限（14）远大于框真实容量（8）。
</div>

<h2>② 为什么旧双页方案没拦住</h2>
<div class="box">
旧截断<b>严格按 chars[1] 上限</b>截：文字超过上限的槽（正文/bullets）被截短了——所以你看到"第一页很多地方字数更少"；
但出问题的<b>标题</b>文字 11 字 &lt; 上限 14，<b>判定没超、不截</b>，照样溢出。这就是你说的"<b>没少在正确的地方</b>"——截断信了模板的字数承诺，而承诺本身是错的。
</div>

<h2>③ 修复 B：按几何容量重标 chars 上限（155 槽 / 6 模板）</h2>
<div class="box">
单行容量 = (框宽/2)/字号；跳过数字/编号/KPI/评分等半角字段（年份"2018-2020"是半角、按全角算会错杀）；只下调、不上调。<b>AI 现在被告知正确的紧上限</b>（overview_title 从"≤12 字"变"≤6 字"），新生成直接写短。
<table><tr><th>槽</th><th>位置</th><th>框@字号</th><th>真实容量</th><th>chars 上限</th><th>原表现</th></tr>
${recal.map((r) => `<tr><td><code style="font-size:11px">${r[0]}</code></td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]} 字/行</td><td><span class="old">${r[4].split(" → ")[0]}</span> → <span class="new">${r[4].split(" → ")[1]}</span></td><td>${r[5]}</td></tr>`).join("")}
</table>
<div class="cap">surgical 字符串替换，零污染 CRLF / 350 个 14.0 浮点；diff 仅数字行变化。备份 templates.json.bak。</div>
</div>

<h2>④ 修复 A：第1页硬截到模板字数上限（你的方案）</h2>
<div class="box">
第1页只为视觉效果，<b>截在哪不关键、字数=模板上限才关键</b>。chars[1] 经 B 重标后已等于框真实容量，所以每个槽<b>硬切到 chars[1] 字</b>就是把框填满、不溢出——比绕语义边界更直接（切到逗号会丢半句、反而留白稀疏）。例：「三年跃迁，架构创新破局」(11)→「三年跃迁，架构创」<b>填满 8 字框</b>，而非「三年跃迁」留白。代码也大幅简化（去掉 em 字宽测量）。
</div>

<h2>⑤ tpl-101 修复前后实拍（真实 PowerPoint 导出）</h2>
<div class="cmp">
  <figure><figcaption><span class="tag b">修复前 · 第2页全量</span></figcaption>${before ? `<img src="${before}">` : "<div>未渲染</div>"}<div class="cap">左侧 3 张卡片标题「三年跃迁，架构创新破局」「架构分岔：密集规模vs稀疏效率」跨 2 行，压住下方正文——即你截图的问题。</div></figure>
  <figure><figcaption><span class="tag a">修复后 · 第1页几何截断</span></figcaption>${after ? `<img src="${after}">` : "<div>未渲染</div>"}<div class="cap">同样数据走新引擎：左卡标题<b>硬切到模板字数、填满框、单行不再压正文</b>，重叠消除。全量文字保留在第2页。</div></figure>
</div>

<h2>⑥ 验证</h2>
<ul class="vlist">
  <li>双页结构回归 <b>18/18</b>（tpl-06 / tpl-22 几何截断下仍全过）</li>
  <li>tpl-101 注入你截图的 15 个超长标题 → 第1页 <b>全部硬切到 chars[1]、字数=模板</b>（填满框、不溢出）</li>
  <li>真实 PowerPoint 打开 → 解析 <b>2 页</b>，第2页复现重叠、第1页消除（上方实拍）</li>
  <li>B 落盘校验：JSON 合法 / 350 浮点保持 / CRLF / BOM 全 ✓；155/155 应用、diff 仅数字</li>
  <li>B 自动流到 AI 提示词：overview_title 提示上限 12→6 字，新生成天然写短</li>
</ul>

<h2>改动与版本</h2>
<p class="files">
<code>templates.json</code> 155 槽 chars 上限重标（B）· <code>ppt-fill.js</code> 第1页截断改硬切到 chars[1]、大幅简化（A）· 版本 <code>5.0.56 → 5.0.58</code>（4 文件 6 行）<br>
本地未 commit、未 push、dist 未构建（仍停 5.0.54）——等你验收。<b>附带好处：</b>数字/年份字段（如"2018-2020"）字数本就 ≤ 上限、硬切不触发，整体保留不被切碎（半角更窄、不溢出）。
</p>

<div class="foot">PPT chars 标定修复 · B 重标 + A 几何截断 · v5.0.58 · 真实 E2E 验证 · 本地未 push</div>
</div></body></html>`;

const out = path.join(ART, "ppt-chars-bug-fix-v5058.html");
fs.writeFileSync(out, html);
console.log("报告已生成: " + out);
