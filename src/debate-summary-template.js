// v4.4.0: 辩论总结 HTML 模板渲染（学术 arXiv 风格）
// 输入：AI 输出的 JSON（含 topic / core_conclusion / consensus / disagreements /
//      open_questions / key_arguments / highlights / next_steps / rounds）
// 输出：自包含 HTML 字符串（inline CSS / 零网络依赖 / 可保存可分享）

(function (global) {
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  // v4.5.4 F2: 拒绝 AI 把 prompt 内的 schema 占位符回显当真总结
  // 触发场景：AI 网页 DOM 经常把刚注入的 prompt 一起包进"AI 回答"区域，
  // 而我们的 prompt 含 schema 示例 JSON（"辩论的核心命题..."），切片解析后
  // 看起来是合法 JSON 但全是模板占位符 → 用户拿到全是 placeholder 的假报告
  const TEMPLATE_PLACEHOLDER_HINTS = [
    "核心命题（精炼",
    "整场辩论得出的一句话核心结论",
    "最值得带走",
    "整场最精彩的一句引用",
    "150 字以内",
    "30-80 字",
  ];

  function looksLikeTemplatePlaceholder(parsed) {
    if (!parsed || typeof parsed !== "object") return false;
    const blob = [
      parsed.topic,
      parsed.core_conclusion,
      Array.isArray(parsed.consensus) ? parsed.consensus.join("|") : parsed.consensus,
    ].filter(s => typeof s === "string").join("|");
    return TEMPLATE_PLACEHOLDER_HINTS.some(h => blob.includes(h));
  }

  // v4.8.13 F29: 自动补齐截断 JSON 的未闭合括号
  // 截图证据：AI 流式输出未完成时 readResponse 抓到 DOM，结尾 `}]` 但缺最外层 `]}`
  // 老逻辑只修尾随逗号 + 中文引号，截断 JSON 直接抛错 → 用户看到长串原文
  function tryRepairTruncatedJson(s) {
    const stack = [];
    let inString = false, escape = false;
    for (const c of s) {
      if (escape) { escape = false; continue; }
      if (c === "\\") { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === "{") stack.push("}");
      else if (c === "[") stack.push("]");
      else if (c === "}" || c === "]") {
        if (stack[stack.length - 1] === c) stack.pop();
      }
    }
    if (stack.length === 0) return s;
    // 若结尾正处于一个未闭合 string 值里（如 "text":"未完...），先补 " 闭合
    const needCloseString = inString ? '"' : "";
    // 若结尾有半截 key/value 后悬挂的逗号，先去掉
    let body = s.replace(/,\s*$/g, "");
    return body + needCloseString + stack.reverse().join("");
  }

  function parseDebateSummaryJson(text) {
    // 容错解析：AI 可能加 ```json 围栏 / 前后文字 / 不完整 JSON
    if (!text || typeof text !== "string") return null;
    let t = text.trim();
    // 去围栏
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    // 找第一个 { 到最后一个 } 之间的内容
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start < 0) return null;
    // v4.8.13 F29: 若没有任何 `}` 也可能是被截断到 string 中间 — 用全 tail
    const candidate = end > start ? t.slice(start, end + 1) : t.slice(start);
    let parsed = null;
    try {
      parsed = JSON.parse(candidate);
    } catch (e) {
      // 失败：尝试修复常见 JSON 错误（尾随逗号、单引号、中文引号）
      const basicFixed = candidate
        .replace(/,(\s*[}\]])/g, "$1")  // 尾随逗号
        .replace(/[‘’]/g, "'") // 中文单引号
        .replace(/[“”]/g, '"'); // 中文双引号
      try {
        parsed = JSON.parse(basicFixed);
      } catch {
        // F29: 再尝试自动补齐截断的括号
        try {
          parsed = JSON.parse(tryRepairTruncatedJson(basicFixed));
        } catch { return null; }
      }
    }
    if (looksLikeTemplatePlaceholder(parsed)) return null;
    return parsed;
  }

  function renderDebateSummaryHtml(data, meta) {
    if (!data) return null;
    const m = meta || {};
    const topic = escapeHtml(data.topic || m.topic || "未命名辩论");
    const date = escapeHtml(m.date || new Date().toISOString().slice(0, 10));
    const participants = Array.isArray(m.participants) ? m.participants.join(" · ") : (data.meta?.participants || []).join(" · ");
    const roundsCount = m.rounds || data.meta?.rounds || (Array.isArray(data.rounds) ? data.rounds.length : 0);
    const duration = m.duration_min || data.meta?.duration_min;

    const conclusion = escapeHtml(data.core_conclusion || "");
    const consensus = Array.isArray(data.consensus) ? data.consensus : [];
    const disagreements = Array.isArray(data.disagreements) ? data.disagreements : [];
    const openQs = Array.isArray(data.open_questions) ? data.open_questions : [];
    const args = Array.isArray(data.key_arguments) ? data.key_arguments : [];
    const highlights = Array.isArray(data.highlights) ? data.highlights : [];
    const nextSteps = Array.isArray(data.next_steps) ? data.next_steps : [];
    const rounds = Array.isArray(data.rounds) ? data.rounds : [];

    const sectionList = (items, cls) => items.length
      ? `<ol class="${cls}">${items.map(i => `<li>${escapeHtml(i)}</li>`).join("")}</ol>`
      : `<div class="empty-section">（无）</div>`;

    // v4.5.5 F7: AI 输出 supports/opposes/voices 时偶尔不按 schema 给数组而给对象，
    // .map 直接 throw 导致整个 HTML 渲染失败。统一用 arr() 把"形似单条"的输入转成数组
    const arr = v => Array.isArray(v) ? v : (v ? [v] : []);

    const argsHtml = args.map(a => {
      const sup = arr(a.supports).map(s =>
        `<div class="arg-side s"><em>${escapeHtml(s.ai)}（支持）：</em>${escapeHtml(s.text)}</div>`
      ).join("");
      const opp = arr(a.opposes).map(s =>
        `<div class="arg-side o"><em>${escapeHtml(s.ai)}（反对/不同视角）：</em>${escapeHtml(s.text)}</div>`
      ).join("");
      return `<div class="arg">
        <div class="arg-title">${escapeHtml(a.title)}</div>
        ${sup}${opp}
      </div>`;
    }).join("");

    const highlightsHtml = highlights.map(h =>
      `<blockquote>${escapeHtml(h.text)}<cite>— ${escapeHtml(h.ai)}${h.round ? `, Round ${escapeHtml(h.round)}` : ""}</cite></blockquote>`
    ).join("");

    const roundsHtml = rounds.map(r => {
      const voices = arr(r.voices).map(v =>
        `<div class="round-v"><em>${escapeHtml(v.ai)}</em>${escapeHtml(v.text)}</div>`
      ).join("");
      return `<div class="round">
        <span class="rh">Round ${escapeHtml(r.num)} · ${escapeHtml(r.title || "")}</span>
        ${voices}
      </div>`;
    }).join("");

    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${topic} · 辩论总结</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Georgia","Times New Roman","Songti SC",serif;background:#fdfdfb;color:#222;padding:48px 40px;font-size:14px;line-height:1.75;max-width:820px;margin:0 auto}
.head{text-align:center;border-bottom:2px solid #222;padding-bottom:16px;margin-bottom:24px}
.head .id{font-family:"Courier New",monospace;font-size:11px;color:#888;letter-spacing:0.1em}
h1{font-size:26px;font-weight:700;line-height:1.3;margin:8px 0;letter-spacing:-0.01em}
.head .meta{font-size:12px;color:#666;font-style:italic;margin-top:6px}
.abstract{margin-bottom:22px;padding:16px 20px;background:#f5f3ee;border-left:4px solid #222}
.abstract .label{font-size:11px;font-weight:700;letter-spacing:0.18em;color:#666;margin-bottom:6px;text-transform:uppercase;font-family:"Helvetica",sans-serif}
.abstract .text{font-size:14px;line-height:1.7;font-style:italic}
h2{font-family:"Helvetica",sans-serif;font-size:14px;font-weight:700;letter-spacing:0.02em;margin:24px 0 10px;color:#222;border-bottom:1px solid #ccc;padding-bottom:5px}
h2 .num{color:#888;margin-right:8px;font-weight:600}
ol{list-style:none;padding-left:0}
ol li{padding:5px 0 5px 28px;position:relative;font-size:13.5px;line-height:1.7;counter-increment:item}
ol.list-c{counter-reset:item}
ol.list-d{counter-reset:item}
ol.list-o{counter-reset:item}
ol.list-n{counter-reset:item}
ol li::before{content:counter(item);position:absolute;left:0;font-family:"Helvetica",sans-serif;font-size:11px;color:#888;font-weight:700;top:7px;width:20px;text-align:right;padding-right:6px;border-right:1px solid #ddd}
.empty-section{font-size:12px;color:#aaa;font-style:italic;padding:6px 0}
.arg{margin-bottom:16px}
.arg-title{font-size:14px;font-weight:700;font-style:italic;margin-bottom:8px;color:#222}
.arg-side{font-size:13px;line-height:1.65;padding:4px 0 4px 16px;border-left:2px solid;margin-bottom:4px}
.arg-side.s{border-color:#0a5e3a;color:#222}
.arg-side.o{border-color:#a06800;color:#222}
.arg-side em{font-weight:700;font-style:italic;color:#444}
blockquote{margin:10px 0;padding:10px 0 10px 22px;border-left:3px solid #222;font-style:italic;font-size:14px;line-height:1.6}
blockquote cite{display:block;font-style:normal;font-size:10.5px;color:#666;margin-top:5px;font-family:"Helvetica",sans-serif;letter-spacing:0.05em}
.round{margin-bottom:14px;font-size:13px;line-height:1.7;padding-bottom:10px;border-bottom:1px dashed #ddd}
.round:last-child{border-bottom:none}
.round .rh{display:block;font-weight:700;font-style:italic;color:#444;margin-bottom:4px;font-size:12.5px}
.round em{font-style:normal;font-weight:700;color:#222;margin-right:5px;font-family:"Helvetica",sans-serif;font-size:11px;letter-spacing:0.04em}
.foot{text-align:center;margin-top:32px;padding-top:14px;border-top:1px solid #ccc;font-size:10px;color:#aaa;letter-spacing:0.15em;font-family:"Helvetica",sans-serif}

@media (prefers-color-scheme: dark){
  body{background:#fdfdfb;color:#222}
  /* 辩论总结报告永远浅色，便于打印 / 分享 / 归档 */
}
@media print{
  body{padding:24px;font-size:12px}
  h2{break-after:avoid}
  .round, .arg, blockquote{break-inside:avoid}
}
</style>
</head>
<body>

<div class="head">
  <div class="id">debate-summary · ${date}</div>
  <h1>${topic}</h1>
  <div class="meta">${participants ? `${participants} · ` : ""}${roundsCount} rounds${duration ? ` · ${escapeHtml(duration)} min` : ""}</div>
</div>

<div class="abstract">
  <div class="label">Abstract · 核心结论</div>
  <div class="text">${conclusion || "（AI 未给出核心结论）"}</div>
</div>

<h2><span class="num">1.</span>共识 Consensus</h2>
${sectionList(consensus, "list-c")}

<h2><span class="num">2.</span>分歧 Disagreement</h2>
${sectionList(disagreements, "list-d")}

<h2><span class="num">3.</span>待证 Open Questions</h2>
${sectionList(openQs, "list-o")}

<h2><span class="num">4.</span>关键论点 Key Arguments</h2>
${argsHtml || `<div class="empty-section">（无论点）</div>`}

<h2><span class="num">5.</span>金句 Highlights</h2>
${highlightsHtml || `<div class="empty-section">（无金句）</div>`}

<h2><span class="num">6.</span>后续方向 Future Work</h2>
${sectionList(nextSteps, "list-n")}

<h2><span class="num">7.</span>整场回顾 Timeline</h2>
${roundsHtml || `<div class="empty-section">（无回顾数据）</div>`}

<div class="foot">AI ARENA · DEBATE SUMMARY · ${date}</div>

</body>
</html>`;
  }

  // 全局暴露 — background.js (SW) 和 popup.html 都能访问
  global.DebateSummaryTemplate = {
    parse: parseDebateSummaryJson,
    render: renderDebateSummaryHtml,
  };
})(typeof self !== "undefined" ? self : globalThis);
