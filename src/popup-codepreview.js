// AI Arena — 代码块"代码 / 预览"切换 + sandboxed iframe HTML/SVG 渲染
(function () {
  const $messages = document.getElementById("chat-messages");
  if (!$messages) return;

  function decodeB64Utf8(b64) {
    if (!b64) return "";
    try {
      return decodeURIComponent(escape(atob(b64)));
    } catch (e) {
      console.warn("[code-preview] decode failed:", e);
      return "";
    }
  }

  function ensureIframe(previewPane) {
    if (previewPane.querySelector("iframe")) return previewPane.querySelector("iframe");
    const b64 = previewPane.dataset.htmlB64 || "";
    const html = decodeB64Utf8(b64);
    const wrap = previewPane.closest(".code-block-wrap");
    const lang = (wrap?.dataset?.lang || "").toLowerCase();
    let srcdoc;
    if (lang === "svg") {
      // SVG 包成完整 HTML 文档
      srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>
        html,body{margin:0;padding:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff}
        svg{max-width:100%;max-height:100vh}
      </style></head><body>${html}</body></html>`;
    } else {
      // HTML 直接当完整文档（用户的代码若不含 <html> 浏览器也会自动包裹）
      srcdoc = html;
    }
    const iframe = document.createElement("iframe");
    iframe.className = "code-preview-frame";
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("loading", "lazy");
    iframe.setAttribute("title", `${lang || "html"} preview`);
    iframe.srcdoc = srcdoc;
    previewPane.appendChild(iframe);
    return iframe;
  }

  $messages.addEventListener("click", async (e) => {
    const tab = e.target.closest(".code-block-tab");
    if (!tab) return;
    const wrap = tab.closest(".code-block-wrap");
    if (!wrap) return;
    const tabType = tab.dataset.tab;
    e.stopPropagation();

    if (tabType === "copy") {
      const code = wrap.querySelector(".code-block-pane-code code")?.innerText || "";
      try {
        await navigator.clipboard.writeText(code);
        const orig = tab.textContent;
        tab.textContent = "✓";
        setTimeout(() => { tab.textContent = orig; }, 900);
      } catch (err) { console.warn("[code-preview] copy failed:", err); }
      return;
    }

    // 切换 tab 激活态
    wrap.querySelectorAll(".code-block-tab").forEach(t => {
      if (t.dataset.tab === "copy") return;
      t.classList.toggle("active", t === tab);
    });
    const codePane = wrap.querySelector(".code-block-pane-code");
    const previewPane = wrap.querySelector(".code-block-pane-preview");
    if (!codePane || !previewPane) return;

    if (tabType === "preview") {
      codePane.hidden = true;
      previewPane.hidden = false;
      ensureIframe(previewPane);
    } else {
      codePane.hidden = false;
      previewPane.hidden = true;
    }
  });
})();
