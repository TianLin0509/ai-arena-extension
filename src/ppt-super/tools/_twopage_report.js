// _twopage_report.js — 双页方案 before/after 渲染对比 → 自包含 HTML（供用户审视）
// 用法: node _twopage_report.js
const fs = require("fs");
const path = require("path");
const OUT = path.join(__dirname, "_e2e_out");
const ART = "C:/Users/lintian/Desktop/claude-artifacts";
if (!fs.existsSync(ART)) fs.mkdirSync(ART, { recursive: true });
const b64 = (f) => { const p = path.join(OUT, f); return fs.existsSync(p) ? "data:image/png;base64," + fs.readFileSync(p).toString("base64") : null; };

const pairs = [
  { name: "tpl-06 放射枢纽（24 超长字段）", p1: b64("_verify_twopage_tpl06_p1.png"), p2: b64("_verify_twopage_tpl06_p2.png"),
    note: "第2页中心引擎/右上代码助手/底部结论条文字明显更密、触发缩字号；第1页文字截到上限内、保持全字号，单元格更透气。" },
  { name: "tpl-22 主视觉分栏（超长+1配图位）", p1: b64("_verify_twopage_tpl22_p1.png"), p2: b64("_verify_twopage_tpl22_p2.png"),
    note: "左侧粉块=插图（验证用 1×1 红图拉伸填入配图位，证明图叠在页面）；两页都带同一张图，仅右侧文字第1页精简、第2页全量。" },
];

const card = (pr) => `<div class="pair">
  <h3>${pr.name}</h3>
  <div class="cmp">
    <figure><figcaption><span class="tag t1">第 1 页 · 视觉截断版（= 预览 / 群聊预估图）</span></figcaption>${pr.p1 ? `<img src="${pr.p1}">` : "<div class=miss>未渲染</div>"}</figure>
    <figure><figcaption><span class="tag t2">第 2 页 · 全量素材版（用户自用）</span></figcaption>${pr.p2 ? `<img src="${pr.p2}">` : "<div class=miss>未渲染</div>"}</figure>
  </div>
  <p class="pn">${pr.note}</p>
</div>`;

const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PPT-SUPER 双页方案 · v5.0.56</title>
<style>
:root{--bg:#fafafa;--card:#fff;--ink:#1d1d1f;--soft:#6e6e73;--border:#d2d2d7;--accent:#0071e3;--ok:#34c759;--warn:#ff9f0a;--code-bg:#1d1d1f;--code-ink:#f5f5f7}
@media(prefers-color-scheme:dark){:root{--bg:#1d1d1f;--card:#2c2c2e;--ink:#f5f5f7;--soft:#aeaeb2;--border:#38383a;--accent:#0a84ff}}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font-family:-apple-system,"PingFang SC",system-ui,sans-serif;line-height:1.6;padding:38px 18px;letter-spacing:-.01em}
.wrap{max-width:1060px;margin:0 auto}
h1{font-size:25px;font-weight:700;letter-spacing:-.02em}
.sub{color:var(--soft);font-size:13px;margin:5px 0 20px}
.banner{background:linear-gradient(135deg,rgba(0,113,227,.10),rgba(52,199,89,.07));border:1px solid var(--border);border-radius:14px;padding:18px 22px;margin-bottom:18px;font-size:14.5px}
.banner b{font-weight:700}
h2{font-size:18px;font-weight:700;margin:28px 0 12px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:8px}
@media(max-width:720px){.grid{grid-template-columns:1fr}}
.box{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:15px 17px}
.box h4{font-size:14px;font-weight:700;margin-bottom:6px}.box h4 span{color:var(--accent)}
.box p{font-size:13px;color:var(--soft)}
.pair{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px 18px;margin-bottom:14px}
.pair h3{font-size:15.5px;font-weight:700;margin-bottom:11px}
.cmp{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:720px){.cmp{grid-template-columns:1fr}}
figure{margin:0}figcaption{margin-bottom:6px}
.tag{font-size:11.5px;font-weight:700;padding:3px 9px;border-radius:6px}
.tag.t1{background:rgba(52,199,89,.15);color:#1e7a34}.tag.t2{background:rgba(255,159,10,.16);color:#8a5a00}
@media(prefers-color-scheme:dark){.tag.t1{color:#5fd97a}.tag.t2{color:#e0b366}}
.cmp img{width:100%;border:1px solid var(--border);border-radius:8px;display:block;margin-top:2px}
.miss{height:200px;display:flex;align-items:center;justify-content:center;color:var(--soft);border:1px dashed var(--border);border-radius:8px}
.pn{font-size:13px;color:var(--soft);margin-top:10px;padding:9px 12px;background:rgba(0,113,227,.05);border:1px solid var(--border);border-radius:8px}
.vlist{list-style:none;display:flex;flex-direction:column;gap:7px;margin-top:4px}
.vlist li{font-size:13.5px;padding-left:24px;position:relative}
.vlist li::before{content:"✓";position:absolute;left:0;top:0;color:var(--ok);font-weight:800}
.files{font-size:13px;color:var(--soft);line-height:1.9}
.files code{font-family:"SF Mono","Consolas",monospace;font-size:12px;background:var(--code-bg);color:var(--code-ink);padding:1px 6px;border-radius:5px}
.ask{background:rgba(255,159,10,.08);border:1px solid var(--warn);border-radius:12px;padding:14px 18px;margin-top:16px;font-size:13.5px;line-height:1.7}
.foot{color:var(--soft);font-size:12px;margin-top:26px;text-align:center}
</style></head><body><div class="wrap">
<h1>PPT-SUPER 双页方案</h1>
<div class="sub">v5.0.56 · 解决「文字超长视觉难看」· 第1页视觉截断 + 第2页全量素材 · 已真实验证</div>

<div class="banner">针对压测暴露的<b>持续超长</b>问题，落地双页方案：<b>第 1 页</b>把每个 slot 文字截到上限内（视觉优先、全字号、不溢出），用作预览/群聊预估图与正式展示；<b>第 2 页</b>保留全量素材供你自取。<b>仅当确有字段超长时才生成第 2 页</b>——不超长就单页，绝不产出两页全同的废页。</div>

<h2>核心设计（白话）</h2>
<div class="grid">
  <div class="box"><h4><span>① </span>为什么拆两页</h4><p>视觉干净与信息完整天然矛盾：一页塞满会缩字号、挤爆版式。拆成两页各司其职——一页给眼睛，一页给资料。</p></div>
  <div class="box"><h4><span>② </span>截断怎么截</h4><p>不是从中间硬切：优先切到上限内最近的句末标点（。！？；），其次逗号/顿号；切点太靠前（丢一半以上）才退回硬切。短字段（标题/KPI）本就不超限、原样不动。</p></div>
  <div class="box"><h4><span>③ </span>条件触发第 2 页</h4><p>构建时先算截断版，逐 slot 比对——有任一字段被截短才追加第 2 页全量版；全部没超限就保持单页。</p></div>
  <div class="box"><h4><span>④ </span>预览 = 第 1 页</h4><p>活预览浮层与下载第 1 页共用同一套截断逻辑，所见即第 1 页；被精简的字段标琥珀虚线 + 悬浮提示「完整文字见第 2 页」。左侧输入框仍是全量，编辑不受影响。</p></div>
</div>

<h2>渲染实拍对比（真实 PowerPoint 导出）</h2>
${pairs.map(card).join("\n")}

<h2>验证结果</h2>
<ul class="vlist">
  <li>结构断言 <b>18 / 18</b> 全过：slide2.xml / slide2.xml.rels / presentation 双 sldId / Content_Types override 齐全</li>
  <li>精确等价：构建的 slide1.xml <b>逐字节 ===</b> 截断版填充结果，slide2.xml <b>逐字节 ===</b> 全量版填充结果</li>
  <li>真实 PowerPoint COM 打开两个样张，均<b>解析出 2 页</b>并成功导出——OOXML 双页接线被 PowerPoint 接受</li>
  <li>无超长场景（全 1 字）→ <b>无 slide2.xml、仅 1 个 sldId</b>，单页不冗余</li>
  <li>含图模板（tpl-22）→ 双页 <b>都叠同一张图</b>，两页 rels 各自挂图片关系</li>
</ul>

<h2>改动与版本</h2>
<p class="files">
<code>ppt-fill.js</code> 新增 truncateData/truncateSlot/addPage2，insertImages 改多页，build 条件双页 ·
<code>ppt-super.js</code> renderPreview/updateOverlay 预览=第1页 + 文案 ·
<code>ppt-super.css</code> 新增 .ppts-ov-cut（琥珀虚线）·
版本 <code>5.0.55 → 5.0.56</code>（manifest×2 / package / popup / sidepanel×2）<br>
本地未 commit、未 push（等你确认）。
</p>

<div class="ask"><b>待你拍板 2 点：</b><br>
1. 现在是<b>「条件双页」</b>（不超长则单页）。若你想要<b>「永远两页」</b>（第 2 页固定作为你的工作副本，哪怕和第 1 页相同），告诉我改成无条件双页。<br>
2. 下载文件名是否要给两页加区分提示（如在状态栏注明「第 1 页视觉版 / 第 2 页全量版」）？目前只在预览说明条里写了。</div>

<div class="foot">PPT-SUPER 双页方案 · v5.0.56 · 真实 E2E 验证 · 本地未 push</div>
</div></body></html>`;

const out = path.join(ART, "ppt-super-twopage-v5056.html");
fs.writeFileSync(out, html);
console.log("报告已生成: " + out);
