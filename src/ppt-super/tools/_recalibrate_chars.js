// _recalibrate_chars.js — 按几何容量重标 templates.json 的 chars 上限（修复"字数承诺>真实容纳"bug）
// 安全铁律：绝不 JSON.parse→stringify 整文件（会污染 CRLF + 14.0→14）。只在原始字符串上 surgical 换 chars 的 min/max 数字。
// 用法: node _recalibrate_chars.js          (dry-run，仅报告)
//       node _recalibrate_chars.js --apply  (落盘 + 校验)
const fs = require("fs");
const path = require("path");
const FILE = path.join(__dirname, "..", "templates.json");
const APPLY = process.argv.includes("--apply");

const WIDTH_SAFETY = 0.97;   // 单行宽度留一点边
const LINEH = 1.1;           // 行高系数（尊重设计框高；A 引擎几何截断做硬兜底，B 可略宽松）
const PT = 2;                // bbox 是 1920 画布坐标；真实 slide 960pt = /2
// 数字/ASCII 半角字段：年份/编号/数值/KPI——按全角 CJK 模型会过度下调，跳过不动
const NUMERIC_KEY = /(^|_)(year|code|val|value|num|pct|percent|ratio|count|id)(_|$|\d)|metric\d*_?(val|num)/i;

const raw = fs.readFileSync(FILE, "utf8");
const data = JSON.parse(raw);   // 只读：用来算目标，绝不写回 data

// 几何容量：单行字数 × 可容行数（bullets 按单行算，每条 bullet 一行）
function geomCap(s) {
  if (!s.bbox || !s.font_pt) return null;
  const wpt = s.bbox[2] / PT, hpt = s.bbox[3] / PT;
  const lineCap = Math.floor((wpt / s.font_pt) * WIDTH_SAFETY);
  let maxLines = Math.round(hpt / (s.font_pt * LINEH));
  if (maxLines < 1) maxLines = 1;
  const mult = s.role === "bullets" ? 1 : maxLines;
  return { lineCap, maxLines, cap: Math.max(1, lineCap * mult) };
}

// 收集目标
const targets = [];   // {tplId, key, oldMin, oldMax, newMin, newMax, why}
const perTpl = {};
data.templates.forEach((t) => {
  (t.slots || []).forEach((s) => {
    if (s.type === "image" || s.type === "icon") return;
    if (!s.chars || s.chars.length < 2) return;
    if (NUMERIC_KEY.test(s.key) || s.role === "kpi" || s.role === "metric") return;   // 数字/ASCII/评分等半角或视觉字段跳过
    const g = geomCap(s);
    if (!g) return;
    const oldMin = s.chars[0], oldMax = s.chars[1];
    if (oldMax - g.cap < 2) return;           // 下调不足 2 字的微调忽略（不会溢出，避免噪音）
    const newMax = g.cap;
    const newMin = Math.min(oldMin, newMax);
    targets.push({ tplId: t.id, key: s.key, role: s.role, oldMin, oldMax, newMin, newMax,
      w: s.bbox[2], h: s.bbox[3], fpt: s.font_pt, lineCap: g.lineCap, maxLines: g.maxLines });
    perTpl[t.id] = (perTpl[t.id] || 0) + 1;
  });
});

console.log("=== 重标目标汇总 ===");
console.log("需下调 chars 上限的 slot 总数:", targets.length, "/ 文本 slot");
console.log("涉及模板:", Object.keys(perTpl).length);
Object.keys(perTpl).sort().forEach((k) => console.log("  " + k + ": " + perTpl[k] + " 个"));

console.log("\n=== tpl-101 逐项（你截图那张）===");
targets.filter((t) => t.tplId === "tpl-101-insight-lineage-map").forEach((t) =>
  console.log(`  ${t.key} (${t.role}) ${t.w}×${t.h}@${t.fpt}pt: chars ${t.oldMax} → ${t.newMax}  [单行${t.lineCap}×${t.maxLines}行]`));

console.log("\n=== 全模板样例（前 20）===");
targets.slice(0, 20).forEach((t) => console.log(`  ${t.tplId} · ${t.key}: ${t.oldMax}→${t.newMax}`));

if (!APPLY) { console.log("\n[dry-run] 未落盘。确认无误后加 --apply 执行。"); process.exit(0); }

// ===== 落盘：原始字符串 surgical 替换，按模板 id 分段定位，offset 降序应用 =====
// 模板 id 在 raw 中的偏移（用于把 slotKey 搜索限定在本模板段内）
const idOff = {};
data.templates.forEach((t) => { idOff[t.id] = raw.indexOf('"id": "' + t.id + '"'); });
const idList = data.templates.map((t) => ({ id: t.id, off: idOff[t.id] })).sort((a, b) => a.off - b.off);
function tplEnd(tplId) {
  const me = idOff[tplId];
  let end = raw.length;
  idList.forEach((x) => { if (x.off > me && x.off < end) end = x.off; });
  return end;
}

const edits = [];   // {start, end, text}
const reChars = /("chars":\s*\[\s*)(\d+)(\s*,\s*)(\d+)(\s*\])/;
targets.forEach((t) => {
  const from = idOff[t.tplId], to = tplEnd(t.tplId);
  const keyPos = raw.indexOf('"key": "' + t.key + '"', from);
  if (keyPos < 0 || keyPos > to) { console.log("⚠ 未定位 key:", t.tplId, t.key); return; }
  const seg = raw.slice(keyPos, to);
  const m = reChars.exec(seg);
  if (!m) { console.log("⚠ 未匹配 chars:", t.tplId, t.key); return; }
  // 防御：捕获到的 min/max 必须等于读到的旧值，否则定位偏了，跳过
  if (parseInt(m[2], 10) !== t.oldMin || parseInt(m[4], 10) !== t.oldMax) {
    console.log("⚠ chars 值不匹配(定位偏)，跳过:", t.tplId, t.key, "得到", m[2], m[4], "期望", t.oldMin, t.oldMax);
    return;
  }
  const start = keyPos + m.index;
  const end = start + m[0].length;
  const text = m[1] + t.newMin + m[3] + t.newMax + m[5];
  edits.push({ start, end, text });
});

edits.sort((a, b) => b.start - a.start);   // 降序，避免偏移失效
let out = raw;
edits.forEach((e) => { out = out.slice(0, e.start) + e.text + out.slice(e.end); });

// ===== 落盘前校验 =====
const floatsBefore = (raw.match(/:\s*\d+\.0\b/g) || []).length;
const floatsAfter = (out.match(/:\s*\d+\.0\b/g) || []).length;
let parseOk = true, parseErr = "";
try { JSON.parse(out); } catch (e) { parseOk = false; parseErr = e.message; }
const crlfOk = out.includes("\r\n");
const bomOk = (raw.charCodeAt(0) === 0xFEFF) === (out.charCodeAt(0) === 0xFEFF);

console.log("\n=== 落盘校验 ===");
console.log("应用 edits:", edits.length, "/ 目标", targets.length);
console.log("JSON 仍合法:", parseOk, parseErr ? "(" + parseErr + ")" : "");
console.log("浮点 14.0 类保持:", floatsBefore, "→", floatsAfter, floatsBefore === floatsAfter ? "✓" : "✗ 污染!");
console.log("CRLF 保持:", crlfOk ? "✓" : "✗");
console.log("BOM 一致:", bomOk ? "✓" : "✗");

if (!parseOk || floatsBefore !== floatsAfter || !crlfOk || edits.length !== targets.length) {
  console.log("\n✗ 校验未全过，拒绝写入。"); process.exit(1);
}
fs.writeFileSync(FILE, out, "utf8");
console.log("\n✓ 已落盘:", FILE);
