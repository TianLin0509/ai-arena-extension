// popup-compare.js — v5.0.33 回答 Side-by-Side 对比视图（旗舰：多 AI 对比核心价值呈现）
// 顶栏「⊞ 对比」按钮 → 全屏 overlay 把本轮各 AI 回答并排成列，一眼看出差异。
// 只读 StateMachine.participants 的 response，不触碰提取链路/气泡渲染（零侵入）。
(function () {
  const NAME = {
    claude: "Claude", gemini: "Gemini", chatgpt: "ChatGPT", deepseek: "DeepSeek",
    doubao: "豆包", qwen: "千问", kimi: "Kimi", yuanbao: "元宝", grok: "Grok",
  };
  let overlay = null;
  let _state = null;   // v5.0.34: 缓存当前对比的 state 供导出用

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }
  function getState() {
    return new Promise(res => { try { chrome.runtime.sendMessage({ type: "getState" }, r => { void chrome.runtime.lastError; res(r || {}); }); } catch (_) { res({}); } });
  }
  function renderBody(text) {
    try { return window.renderMarkdown ? window.renderMarkdown(text || "") : escapeHtml(text || ""); }
    catch (_) { return escapeHtml(text || ""); }
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove("show");
    const node = overlay; overlay = null;
    document.removeEventListener("keydown", onEsc, true);
    setTimeout(() => { try { node.remove(); } catch (_) {} }, 180);
  }
  function onEsc(e) { if (e.key === "Escape") close(); }

  async function open() {
    const state = await getState();
    _state = state;
    const parts = (state.participants || []).filter(p => (p.response || p.responsePreview));
    const q = state.debateSession?.originalQuestion || "";

    close();
    overlay = document.createElement("div");
    overlay.className = "cmp-overlay";
    if (parts.length < 1) {
      overlay.innerHTML = `
        <div class="cmp-panel">
          <div class="cmp-head"><span class="cmp-title">⊞ 回答对比</span><button class="cmp-close" data-cmp="close" aria-label="关闭">✕</button></div>
          <div class="cmp-empty">还没有 AI 回答可对比。<br>先用「同时提问」或「辩论」让多个 AI 回答，再回来并排看差异 —— 这正是圆桌的核心价值 🎯</div>
        </div>`;
    } else {
      const maxLen = Math.max(...parts.map(p => (p.response || p.responsePreview || "").length), 1);
      const cols = parts.map(p => {
        const name = p.name || NAME[p.service] || p.service;
        const text = p.response || p.responsePreview || "";
        const len = text.length;
        const pct = Math.round(len / maxLen * 100);
        return `
          <div class="cmp-col" data-svc="${escapeHtml(p.service)}">
            <div class="cmp-col-head">
              <span class="cmp-col-name">${escapeHtml(name)}</span>
              <span class="cmp-col-len">${len} 字</span>
            </div>
            <div class="cmp-col-bar"><span style="width:${pct}%"></span></div>
            <div class="cmp-col-body">${renderBody(text)}</div>
          </div>`;
      }).join("");
      overlay.innerHTML = `
        <div class="cmp-panel">
          <div class="cmp-head">
            <span class="cmp-title">⊞ 回答对比 · ${parts.length} 家并排</span>
            ${q ? `<span class="cmp-q" title="${escapeHtml(q)}">📌 ${escapeHtml(q.length > 60 ? q.slice(0, 60) + "…" : q)}</span>` : ""}
            <button class="cmp-act" data-cmp="copy-md" title="复制为 Markdown（汇报/转发同事）">📋 复制</button>
            <button class="cmp-act" data-cmp="export-html" title="导出自包含 HTML 卡（离线可开/分享）">💾 HTML</button>
            <button class="cmp-close" data-cmp="close" aria-label="关闭">✕</button>
          </div>
          <div class="cmp-cols">${cols}</div>
        </div>`;
    }
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => {
      const act = e.target?.dataset?.cmp;
      if (act === "close" || e.target === overlay) { close(); return; }
      if (act === "copy-md") {
        try {
          const md = window.ArenaExport?.buildMarkdown?.(_state) || "";
          navigator.clipboard?.writeText(md).then(() => {
            e.target.textContent = "✓ 已复制";
            setTimeout(() => { e.target.textContent = "📋 复制"; }, 1200);
          }).catch(() => {});
        } catch (_) {}
        return;
      }
      if (act === "export-html") {
        try {
          const html = window.ArenaExport?.buildShareHtml?.(_state) || "";
          const blob = new Blob([html], { type: "text/html;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = `AI圆桌对比-${parts.length}家.html`;
          document.body.appendChild(a); a.click();
          setTimeout(() => { try { a.remove(); URL.revokeObjectURL(url); } catch (_) {} }, 1000);
          e.target.textContent = "✓ 已导出";
          setTimeout(() => { e.target.textContent = "💾 HTML"; }, 1200);
        } catch (_) {}
        return;
      }
    });
    document.addEventListener("keydown", onEsc, true);
    requestAnimationFrame(() => overlay.classList.add("show"));
  }

  function init() {
    document.getElementById("btn-compare")?.addEventListener("click", (e) => { e.stopPropagation(); open(); });
  }
  window.ChatCompare = { open, close };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
