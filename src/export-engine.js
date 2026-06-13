// export-engine.js — v5.0.34 导出引擎（双模出口：浏览器 global / Node 测试 require）
// 把本轮各 AI 回答导出为 Markdown（分享/汇报）或自包含 HTML 卡（离线可开）。
// 纯读 state.participants.response，不改任何状态。
(function (global) {
  const NAME = {
    claude: "Claude", gemini: "Gemini", chatgpt: "ChatGPT", deepseek: "DeepSeek",
    doubao: "豆包", qwen: "千问", kimi: "Kimi", yuanbao: "元宝", grok: "Grok",
  };

  function nameOf(p) { return p.name || NAME[p.service] || p.service || "AI"; }
  function answeredParts(state) {
    return (state?.participants || []).filter(p => (p.response || p.responsePreview));
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  // Markdown：问题 + 各 AI 回答（最高频的分享/汇报格式）
  function buildMarkdown(state) {
    const q = state?.debateSession?.originalQuestion || "";
    const parts = answeredParts(state);
    let md = "# AI 圆桌对比\n\n";
    if (q) md += `**问题**：${q}\n\n`;
    for (const p of parts) {
      md += `## ${nameOf(p)}\n\n${(p.response || p.responsePreview || "").trim()}\n\n`;
    }
    md += `---\n_由 AI圆桌派生成 · ${parts.length} 家 AI 并排对比_\n`;
    return md;
  }

  // 自包含 HTML 分享卡（inline CSS，零网络请求，离线可开）
  function buildShareHtml(state) {
    const q = state?.debateSession?.originalQuestion || "";
    const parts = answeredParts(state);
    const cards = parts.map(p => `
      <div class="card">
        <div class="name">${escapeHtml(nameOf(p))}<span class="len">${(p.response || "").length} 字</span></div>
        <div class="body">${escapeHtml((p.response || p.responsePreview || "").trim()).replace(/\n/g, "<br>")}</div>
      </div>`).join("");
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI 圆桌对比${q ? " · " + escapeHtml(q.slice(0, 30)) : ""}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;background:#fafafa;color:#1d1d1f;padding:32px 20px;line-height:1.7}
.wrap{max-width:960px;margin:0 auto}
h1{font-size:24px;font-weight:700;margin-bottom:6px}
.q{color:#6e6e73;margin-bottom:24px;font-size:15px}
.cards{display:flex;flex-direction:column;gap:14px}
.card{background:#fff;border:1px solid #d2d2d7;border-radius:14px;padding:18px 22px}
.name{font-size:16px;font-weight:700;margin-bottom:10px;display:flex;align-items:center;gap:10px}
.len{font-size:12px;font-weight:400;color:#8e8e93}
.body{font-size:14px;color:#1d1d1f}
.foot{margin-top:24px;text-align:center;color:#8e8e93;font-size:12px}
@media(prefers-color-scheme:dark){body{background:#1d1d1f;color:#f5f5f7}.card{background:#2c2c2e;border-color:#38383a}.body{color:#f5f5f7}.q{color:#aeaeb2}}
</style></head><body><div class="wrap">
<h1>🎯 AI 圆桌对比</h1>
${q ? `<div class="q">问题：${escapeHtml(q)}</div>` : ""}
<div class="cards">${cards}</div>
<div class="foot">由 AI圆桌派生成 · ${parts.length} 家 AI 并排对比</div>
</div></body></html>`;
  }

  const api = { buildMarkdown, buildShareHtml, answeredParts };
  global.ArenaExport = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis));
