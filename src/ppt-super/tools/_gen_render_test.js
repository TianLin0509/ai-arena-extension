// 生成 self-contained harness HTML：用改后 ppt-super.js 的真实 iconBatchRow + 依赖渲染，
// mock 掉 send/status/generateIconSheet/renderEditor/renderPreview，真实跑"粘贴→解析→填图"
const fs = require('fs'), path = require('path');
const base = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(base, 'ppt-super.js'), 'utf8');
const css = fs.readFileSync(path.join(base, 'ppt-super.css'), 'utf8');
function extractFn(name) {
  const start = src.indexOf('function ' + name);
  if (start < 0) throw new Error('NOT FOUND: ' + name);
  let depth = 0, j = src.indexOf('{', start);
  for (; j < src.length; j++) { const ch = src[j]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) { j++; break; } } }
  return src.slice(start, j);
}
const FNS = ['esc', 'el', 'q', 'iconSemantics', 'sanitizeSvg', 'svgToPng', 'parseSvgArray', 'applyIconSvgs', 'pickIconAi', 'buildIconSvgPrompt', 'iconBatchRow']
  .map(extractFn).join('\n\n');

const userJson = `[{"name":"上行吞吐","svg":"<svg width='24' height='24' viewBox='0 0 24 24'><circle cx='12' cy='12' r='10' fill='#1F4E79' opacity='0.12'/><path d='M12,20 L12,4 M8,8 L12,4 L16,8' stroke='#1F4E79' stroke-width='1.6' fill='none'/></svg>"},{"name":"时延抖动","svg":"<svg width='24' height='24' viewBox='0 0 24 24'><path d='M2,12 L4,6 L6,16 L8,8' stroke='#1F4E79' fill='none'/></svg>"},{"name":"计算资源","svg":"<svg width='24' height='24' viewBox='0 0 24 24'><rect x='4' y='4' width='16' height='16' stroke='#1F4E79' fill='none'/></svg>"},{"name":"网络资源","svg":"<svg width='24' height='24' viewBox='0 0 24 24'><path d='M6,6 L18,6 L12,18 Z' stroke='#1F4E79' fill='none'/></svg>"},{"name":"存储资源","svg":"<svg width='24' height='24' viewBox='0 0 24 24'><path d='M4,6 Q12,2 20,6 L20,18 Z' stroke='#1F4E79' fill='none'/></svg>"},{"name":"审计存证","svg":"<svg width='24' height='24' viewBox='0 0 24 24'><path d='M4,6 L12,2 L20,6 Z' stroke='#1F4E79' fill='none'/></svg>"},{"name":"调度核心","svg":"<svg width='24' height='24' viewBox='0 0 24 24'><path d='M12,8 L12,16' stroke='#1F4E79'/></svg>"},{"name":"资源画像","svg":"<svg width='24' height='24' viewBox='0 0 24 24'><circle cx='12' cy='12' r='5' stroke='#1F4E79' fill='none'/></svg>"},{"name":"恢复自愈","svg":"<svg width='24' height='24' viewBox='0 0 24 24'><path d='M6,12 A6,6 0 1,1 18,12' stroke='#1F4E79' fill='none'/></svg>"},{"name":"验收保障","svg":"<svg width='24' height='24' viewBox='0 0 24 24'><rect x='4' y='6' width='16' height='12' stroke='#1F4E79' fill='none'/></svg>"},{"name":"上行容量","svg":"<svg width='24' height='24' viewBox='0 0 24 24'><path d='M4,16 L7,16 L7,10 Z' stroke='#1F4E79' fill='none'/></svg>"},{"name":"恢复时长","svg":"<svg width='24' height='24' viewBox='0 0 24 24'><path d='M6,4 L18,4 L12,10 Z' stroke='#1F4E79' fill='none'/></svg>"},{"name":"算力空转","svg":"<svg width='24' height='24' viewBox='0 0 24 24'><path d='M12,4 L12,20' stroke='#1F4E79'/></svg>"},{"name":"审计覆盖","svg":"<svg width='24' height='24' viewBox='0 0 24 24'><path d='M12,12 L12,2 A10,10 0 0,1 22,12 Z' stroke='#1F4E79' fill='none'/></svg>"}]`;

const iconList = JSON.parse(userJson).map((x, i) => ({ key: 'ic' + i, zh: x.name + '图标', hint: x.name }));

const harness = `
const _statusLog = [];
function status(msg, tone){ _statusLog.push({msg:msg,tone:tone}); var s=document.getElementById('status'); if(s){s.textContent=msg; s.className='ppts-status '+(tone||'');} }
function send(m){ if(m&&m.type==='getState') return Promise.resolve({participants:[{service:'deepseek',name:'DeepSeek',id:1},{service:'gemini',name:'Gemini',id:2}]}); return Promise.resolve({ok:true}); }
function renderEditor(){}
function renderPreview(){}
function generateIconSheet(iconList,c,prompt,onManual){ status('[mock] generateIconSheet 调用, prompt 长度='+(prompt||'').length,'ok'); window.__genArgs={promptLen:(prompt||'').length, hasOnManual: typeof onManual==='function'}; }

${FNS}

window.__USERJSON = ${JSON.stringify(userJson)};
var iconList = ${JSON.stringify(iconList)};
var c = { images:{} };
var box = document.getElementById('box');
try { iconBatchRow(iconList, c, box); } catch(e){ document.getElementById('done').textContent='RENDER_ERROR: '+e.message; throw e; }

setTimeout(function(){
  var r = {};
  r.manualExists = !!q('.ppts-iconmanual', box);
  r.pasteExists  = !!q('.ppts-iconpaste', box);
  r.cmdExists    = !!q('.ppts-iconcmd', box);
  r.cmdInDetails = !!q('details .ppts-iconcmd', box);
  r.genBtnText   = q('[data-a="gen"]', box) ? q('[data-a="gen"]', box).textContent : null;
  r.copyBtn      = !!q('[data-a="copy"]', box);
  r.parseBtnText = q('[data-a="parse"]', box) ? q('[data-a="parse"]', box).textContent : null;
  r.cmdPromptLen = q('.ppts-iconcmd', box) ? q('.ppts-iconcmd', box).value.length : 0;
  r.pastePlaceholderHasSvg = /svg/.test((q('.ppts-iconpaste', box)||{}).placeholder||'');
  r.parseFnDirect = (parseSvgArray(window.__USERJSON)||[]).length;
  // 端到端：粘贴真实 JSON → 点解析 → svgToPng 填 c.images
  q('.ppts-iconpaste', box).value = window.__USERJSON;
  q('[data-a="gen"]', box).click(); // 顺便测 gen 把 cmd 文本传给（mock）generateIconSheet
  q('.ppts-iconpaste', box).value = window.__USERJSON;
  q('[data-a="parse"]', box).click();
  setTimeout(function(){
    r.filledIcons = Object.keys(c.images).length;
    r.genArgs = window.__genArgs || null;
    r.statusAfterParse = (_statusLog[_statusLog.length-1]||{}).msg;
    // 空粘贴 → 应 flash + 提示
    q('.ppts-iconpaste', box).value = '';
    q('[data-a="parse"]', box).click();
    setTimeout(function(){
      r.flashOnEmpty = q('.ppts-iconmanual', box).classList.contains('flash');
      r.emptyStatus = (_statusLog[_statusLog.length-1]||{}).msg;
      window.__selfcheck = r;
      document.getElementById('done').textContent = 'DONE';
    }, 250);
  }, 1200);
}, 500);
`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}\nbody{margin:0;padding:18px;background:#ddd}#done{font:14px monospace;padding:8px;color:#333}</style></head>
<body><div class="ppts-modal" style="height:auto;max-height:none"><div class="ppts-body"><div class="ppts-editor" id="box"></div></div>
<div class="ppts-foot"><div class="ppts-status" id="status">（status）</div></div></div>
<div id="done">RUNNING…</div>
<script>${harness}</script></body></html>`;

const out = path.join(__dirname, '_render_test.html');
fs.writeFileSync(out, html, 'utf8');
console.log('written: ' + out);
console.log('extracted fns: esc el q iconSemantics sanitizeSvg svgToPng parseSvgArray applyIconSvgs pickIconAi buildIconSvgPrompt iconBatchRow');
