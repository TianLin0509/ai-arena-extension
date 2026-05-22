// AI Arena — 轻量 markdown 渲染（XSS-safe 转义 + 白名单标签）
(function (global) {
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderMarkdown(src) {
    if (!src) return "";

    // 1) 提取代码块占位（防止内部 markdown 干扰）
    const codeBlocks = [];
    src = src.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (m, lang, code) => {
      const idx = codeBlocks.push({ lang, code }) - 1;
      return ` CODE${idx} `;
    });

    // 2) 行内 code
    src = src.replace(/`([^`\n]+)`/g, (m, c) => `INLINE${escapeHtml(c)}`);

    // 3) 转义剩余 HTML
    src = escapeHtml(src);

    // 4) 标题
    src = src.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    src = src.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    src = src.replace(/^# (.+)$/gm, "<h1>$1</h1>");

    // 5) 粗斜体
    src = src.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    src = src.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

    // 6) 链接 [text](url) — 只允许 http/https
    src = src.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, text, url) => {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    });

    // 7) 列表（粗暴：连续 - 或 * 行）
    src = src.replace(/(^|\n)((?:- .+(?:\n|$))+)/g, (m, lead, block) => {
      const items = block.trim().split(/\n/).map(line => `<li>${line.replace(/^- /, "")}</li>`).join("");
      return `${lead}<ul>${items}</ul>`;
    });

    // 8) 段落（双换行分段）
    src = src.split(/\n\n+/).map(p => {
      if (/^<(h[123]|ul|ol|pre)/.test(p.trim())) return p;
      return `<p>${p.replace(/\n/g, "<br>")}</p>`;
    }).join("");

    // 9) 回填行内 code
    src = src.replace(/INLINE([^]+)/g, (m, c) => `<code>${c}</code>`);

    // 10) 回填代码块
    src = src.replace(/ CODE(\d+) /g, (m, idx) => {
      const { lang, code } = codeBlocks[Number(idx)];
      const langClass = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      return `<pre><code${langClass}>${escapeHtml(code)}</code></pre>`;
    });

    return src;
  }

  global.renderMarkdown = renderMarkdown;
  if (typeof module !== "undefined") module.exports = { renderMarkdown, escapeHtml };
})(typeof window !== "undefined" ? window : globalThis);
