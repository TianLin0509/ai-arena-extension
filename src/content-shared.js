// AI Arena — Content Script Shared Helpers
// v5.2.6: 跨 9 平台提取共用工具
//
// 设计原则：
// - 必须在 inject-images.js 之前注入（manifest content_scripts 顺序）
// - 暴露到 globalThis.ArenaShared，避免污染 page world
// - IIFE + guard 防御 reload 扩展时重复声明
(function () {
  if (globalThis.ArenaShared && globalThis.ArenaShared._loaded) return;

  // 取数组里最后一个有 innerText 内容的元素
  // 解决：
  //   - 豆包 spacer 占位行（v_list_row 4 行里 2 行空）
  //   - streaming 起步窗口（容器建好但 SSE 还没填）
  //   - 思考链分容器（DeepSeek 思考 + 回复分两个 .ds-markdown，末位可能是空 thinking）
  //   - fallback selector 命中装饰元素（spinner / toolbar / 推荐问题）
  //
  // 行为：从末尾向前扫，第一个 innerText.trim().length > 0 的元素返回
  //       找不到返回 null —— 调用方应 fallback 到 responses[length-1] 保守兜底
  function getLastNonEmpty(elements) {
    if (!elements) return null;
    // v5.2.17: 防御非类数组单元素（多方审查 DeepSeek）— 单 DOM 元素 length 为 undefined
    //   且不可迭代，[...el] 会抛错。用 Array.isArray / length 数字判断更稳。
    let arr;
    if (Array.isArray(elements)) arr = elements;
    else if (typeof elements.length === "number") arr = elements;  // NodeList / HTMLCollection
    else arr = [elements];  // 单元素兜底
    for (let i = arr.length - 1; i >= 0; i--) {
      const el = arr[i];
      if (!el) continue;
      // v5.2.17: 分别 trim 再择优（多方审查 Codex 高置信）— 旧 `el.innerText || el.textContent`
      //   当 innerText 是纯空白 "   "（truthy）时不会回退 textContent，trim 后变空 → 误判该
      //   元素为空跳过，但 textContent 可能有内容（背景 tab innerText 常返回空白）。
      const it = (el.innerText || "").trim();
      const tc = (el.textContent || "").trim();
      if ((it || tc).length > 0) return el;
    }
    return null;
  }

  const RESPONSE_TAIL_LIMIT = 12;
  const RESPONSE_FALLBACK_LIMIT = 80;
  const _responseCursors = new Map();

  function _toArray(elements) {
    if (!elements) return [];
    if (Array.isArray(elements)) return elements;
    if (typeof elements.length === "number") return Array.from(elements);
    return [elements];
  }

  function rememberResponseCursor(site, elements) {
    if (!site) return;
    const arr = _toArray(elements);
    _responseCursors.set(site, {
      seen: true,
      lastEl: arr.length ? arr[arr.length - 1] : null,
      ts: Date.now(),
    });
  }

  function hasResponseCursor(site) {
    return !!(site && _responseCursors.get(site)?.seen);
  }

  // v5.0.16: 发送失败时调用 — 清掉锚点但保留 seen，让提取回退到尾部候选（slice(-n)），
  //   避免失败的 inject 留下错误基准把真实新回答过滤掉。
  function clearResponseCursorAnchor(site) {
    if (!site) return;
    _responseCursors.set(site, { seen: true, lastEl: null, ts: Date.now() });
  }

  function getResponseTailCandidates(elements, site, limit) {
    const arr = _toArray(elements);
    const n = Math.max(1, Number(limit) || RESPONSE_TAIL_LIMIT);
    if (!arr.length) return [];
    const cursor = site ? _responseCursors.get(site) : null;
    if (cursor?.seen) {
      if (!cursor.lastEl) return arr.slice(-n);
      const idx = arr.indexOf(cursor.lastEl);
      if (idx >= 0) return arr.slice(idx + 1).slice(-n);
      // v5.0.16: 锚点已被站点 SPA 重渲染摘除（detached）时，compareDocumentPosition 对文档内
      //   元素只会返回 DISCONNECTED（不含 FOLLOWING 位），按位置过滤会把真实新回答全部丢掉，
      //   提取永远为空 → 锚点失效一律回退尾部候选（残留误读由 background 的
      //   lastAcceptedByPid / prompt-echo sanity check 兜底，与 cursor 机制引入前行为一致）。
      if (!cursor.lastEl.isConnected) return arr.slice(-n);
      if (cursor.lastEl.compareDocumentPosition) {
        const following = (typeof Node !== "undefined" && Node.DOCUMENT_POSITION_FOLLOWING) || 4;
        const after = arr.filter(el => {
          try {
            return !!(cursor.lastEl.compareDocumentPosition(el) & following);
          } catch (_) {
            return false;
          }
        }).slice(-n);
        if (after.length) return after;
        // 锚点仍在文档中且其后确无新元素 → 本轮回答尚未出现，保持空等下一次 poll
        return [];
      }
      return arr.slice(-n);
    }
    return arr.slice(-n);
  }

  function getLatestResponseCandidate(elements, site, limit) {
    const tail = getResponseTailCandidates(elements, site, limit);
    return getLastNonEmpty(tail);
  }

  function findReadableBlock(elements, options) {
    const opts = options || {};
    const arr = _toArray(elements);
    const limit = Math.max(1, Number(opts.limit) || RESPONSE_FALLBACK_LIMIT);
    const minTextLength = Math.max(0, Number(opts.minTextLength) || 100);
    const minHeight = Math.max(0, Number(opts.minHeight) || 50);
    const reject = typeof opts.reject === "function" ? opts.reject : null;
    const tail = arr.slice(-limit);
    for (let i = tail.length - 1; i >= 0; i--) {
      const el = tail[i];
      if (!el) continue;
      if (reject && reject(el)) continue;
      const text = (el.innerText || el.textContent || "").trim();
      if (!text || text.length <= minTextLength) continue;
      const rect = el.getBoundingClientRect?.();
      if (rect && rect.height <= minHeight) continue;
      return el;
    }
    return null;
  }

  // v5.0.20: 快速文本哈希（djb2-xor，结果内嵌长度）— readResponse 同文本省略协议用。
  //   非加密用途，只判定"同一 tab 本轮文本是否变化"；哈希+长度双重比对，碰撞可忽略。
  function textHash(str) {
    const s = String(str == null ? "" : str);
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) + h) ^ s.charCodeAt(i);
    }
    return (h >>> 0).toString(36) + ":" + s.length;
  }

  // v5.2.17: 安全往 contenteditable 注入多行文本（替代 innerHTML 拼接用户 prompt）
  //   多方审查 Codex 高危发现：robustInject 兜底 `el.innerHTML = text.split("\n").map(
  //   l => `<p>${l}</p>`)` 把用户 prompt 直接拼进 innerHTML —— prompt 含 < > & 或
  //   "<img onerror=...>" 会被浏览器解析：轻则 prompt 内容被篡改/截断（如问"比较 <div>
  //   和 <span>"），重则在 AI 页面上下文执行脚本。改用 createElement + textContent 杜绝。
  function setEditableLines(el, text) {
    if (!el) return;
    el.innerHTML = "";
    const lines = String(text == null ? "" : text).split("\n");
    for (const line of lines) {
      const p = document.createElement("p");
      if (line) p.textContent = line;           // textContent 不解析 HTML，安全
      else p.appendChild(document.createElement("br"));
      el.appendChild(p);
    }
    try { el.dispatchEvent(new Event("input", { bubbles: true })); } catch (_) {}
  }

  // v5.2.20: 判定元素当前是否落在视口纵向可见区域（排除滚出视口的历史残留 + 隐藏元素）
  //   旧逻辑只看 getBoundingClientRect().width > 0 —— 滚出视口的残留 width 照样 > 0 → 误判。
  function _visibleInViewport(el, win) {
    const r = el.getBoundingClientRect?.();
    if (!r) return false;
    if (r.width <= 0 || r.height <= 0) return false;
    const vh = (win && win.innerHeight) || 0;
    return r.bottom > 0 && (vh ? r.top < vh : true);
  }

  // v5.2.20: streaming 信号判定 —— 治本替代各 content 脚本里
  //   `queryBySelectors("streaming")`（全文档 querySelector 取第一个）+ 裸 width>0 的旧逻辑。
  //   旧逻辑第二/三轮起会命中上方历史轮残留（千问未完成 qk-markdown / 残留 Stop 按钮 /
  //   宽通配 [class*="stop"]），isStreaming 卡 true → 完成判定永远差 !isStreaming →
  //   拖到 12s 兜底、甚至 5min 超时（截图实锤：千问"超时 5 分钟强制结束"）。
  //   新规则：streaming selector 命中的元素，只在以下任一成立时才算"正在生成"：
  //     ① 属于最新回答容器（容器自身或其子节点）—— 当前这条回答在流式
  //     ② 当前视口内可见 —— 覆盖全局 Stop 按钮 / 与回答同级的 loading 指示器，
  //        同时排除滚出视口上方的历史残留。
  function detectStreaming(streamingSelectors, latestEl, win, doc) {
    win = win || (typeof window !== "undefined" ? window : globalThis);
    doc = doc || (typeof document !== "undefined" ? document : null);
    if (!doc) return false;
    const sels = Array.isArray(streamingSelectors) ? streamingSelectors : [];
    for (const sel of sels) {
      let els;
      try { els = doc.querySelectorAll(sel); } catch (_) { continue; }
      for (const el of els) {
        if (!el) continue;
        if (latestEl && (el === latestEl || (latestEl.contains && latestEl.contains(el)))) return true;
        if (_visibleInViewport(el, win)) return true;
      }
    }
    return false;
  }

  // ── v5.0.21: 划线收藏 — AI 原网页选中文本旁浮出"存入圆桌备忘录"按钮 ──
  //   用户场景：迭代过程中看到金句手动保留。设置 memoClipEnabled 可关（默认开）。
  //   纯 inline style + fixed 定位 + 顶级 z-index，不注入 CSS、不碰站点 DOM 结构。
  (function initMemoClip() {
    try {
      if (typeof document === "undefined" || !globalThis.chrome?.runtime?.sendMessage) return;
      let enabled = true;
      try {
        chrome.storage?.local?.get?.(["memoClipEnabled"], (d) => { enabled = d?.memoClipEnabled !== false; });
        chrome.storage?.onChanged?.addListener?.((ch, area) => {
          if (area === "local" && ch.memoClipEnabled) enabled = ch.memoClipEnabled.newValue !== false;
        });
      } catch (_) {}

      let btn = null;
      function hideBtn() { if (btn) { try { btn.remove(); } catch (_) {} btn = null; } }
      function showBtn(x, y, text) {
        hideBtn();
        btn = document.createElement("div");
        btn.id = "arena-memo-clip-btn";
        btn.textContent = "📌 存入圆桌备忘录";
        btn.setAttribute("style", [
          "position:fixed", `left:${Math.round(x)}px`, `top:${Math.round(y)}px`,
          "z-index:2147483646", "background:#1d1d1f", "color:#f5f5f7",
          "font:600 12px/1 -apple-system,'PingFang SC',sans-serif",
          "padding:8px 13px", "border-radius:15px", "cursor:pointer",
          "box-shadow:0 4px 14px rgba(0,0,0,.35)", "user-select:none",
        ].join(";"));
        // mousedown 阻断防点击瞬间 selection 被清掉
        btn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
        btn.addEventListener("click", (e) => {
          e.preventDefault(); e.stopPropagation();
          const el = btn;
          // 实测：各 content-*.js 顶层 const SITE 跨脚本不可见 → 用 hostname 映射定 service
          const MEMO_SITE_MAP = {
            "claude.ai": "claude", "gemini.google.com": "gemini", "chatgpt.com": "chatgpt",
            "chat.deepseek.com": "deepseek", "www.doubao.com": "doubao",
            "tongyi.aliyun.com": "qwen", "www.qianwen.com": "qwen",
            "kimi.moonshot.cn": "kimi", "www.kimi.com": "kimi",
            "yuanbao.tencent.com": "yuanbao", "grok.com": "grok",
          };
          try {
            chrome.runtime.sendMessage({
              type: "memoAdd",
              text,
              source: {
                type: "site",
                service: MEMO_SITE_MAP[location.hostname] || location.hostname || "",
                url: location.href,
                title: document.title,
              },
            }, (resp) => {
              if (el) el.textContent = (resp && resp.ok) ? "✓ 已存入备忘录" : `⚠ ${resp?.error || "保存失败"}`;
              setTimeout(hideBtn, 900);
            });
          } catch (_) { hideBtn(); }
        });
        document.documentElement.appendChild(btn);
      }

      document.addEventListener("mouseup", (e) => {
        if (!enabled) return;
        if (btn && (e.target === btn || btn.contains(e.target))) return;
        setTimeout(() => {  // 等 selection 状态落定
          try {
            const sel = window.getSelection();
            const text = (sel && !sel.isCollapsed ? String(sel) : "").trim();
            if (!text || text.length < 8 || text.length > 10000) return hideBtn();
            // 选区在输入框/编辑器内（用户在编辑 prompt）不打扰
            const anchor = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
            if (anchor?.closest?.("textarea, input, [contenteditable='true'], [contenteditable=''], [role='textbox']")) return hideBtn();
            const rect = sel.getRangeAt(0).getBoundingClientRect();
            if (!rect || (!rect.width && !rect.height)) return hideBtn();
            const x = Math.min(Math.max(rect.left + rect.width / 2 - 70, 8), Math.max(8, window.innerWidth - 170));
            const y = Math.min(rect.bottom + 8, Math.max(8, window.innerHeight - 46));
            showBtn(x, y, text);
          } catch (_) {}
        }, 10);
      }, true);
      document.addEventListener("mousedown", (e) => { if (btn && e.target !== btn && !btn.contains(e.target)) hideBtn(); }, true);
      window.addEventListener("scroll", hideBtn, true);
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideBtn(); });
    } catch (_) {}
  })();

  globalThis.ArenaShared = {
    _loaded: true,
    getLastNonEmpty,
    rememberResponseCursor,
    hasResponseCursor,
    clearResponseCursorAnchor,
    getResponseTailCandidates,
    getLatestResponseCandidate,
    findReadableBlock,
    textHash,
    setEditableLines,
    detectStreaming,
  };
})();
