// popup-memos.js — v5.0.21 备忘录 Tab + 圆桌主界面划线收藏
// 数据在 background ArenaMemoStore（chrome.storage.local arenaMemos），本模块只做展示与交互：
// - 右栏「备忘录」Tab：列表（来源徽章/时间/正文）+ 复制 / 引用到输入框 / 删除 / 清空
// - 主界面消息区划线 → 浮出「📌 存入备忘录」按钮（与 AI 原网页 content-shared 同款交互）
(function () {
  const NAME = {
    claude: "Claude", gemini: "Gemini", chatgpt: "ChatGPT", deepseek: "DeepSeek",
    doubao: "豆包", qwen: "千问", kimi: "Kimi", yuanbao: "元宝", grok: "Grok",
  };
  let items = [];
  let dirty = true;
  let refreshTimer = null;
  let refreshInFlight = false;
  let refreshAgain = false;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function srcLabel(m) {
    const s = m.source || {};
    const who = NAME[s.service] || s.service || "";
    if (s.type === "popup") return who ? `圆桌·${who}` : "圆桌";
    return who ? `网页·${who}` : "网页";
  }

  function fmtTime(ts) {
    try {
      const d = new Date(ts);
      return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    } catch (_) { return ""; }
  }

  async function refresh() {
    if (refreshInFlight) {
      refreshAgain = true;
      return;
    }
    refreshInFlight = true;
    const r = await new Promise(res => {
      try { chrome.runtime.sendMessage({ type: "memoList" }, resp => res(resp || {})); }
      catch (_) { res({}); }
    });
    try {
      items = Array.isArray(r.items) ? r.items : [];
      dirty = false;
      render();
    } finally {
      refreshInFlight = false;
      if (refreshAgain) {
        refreshAgain = false;
        scheduleRefresh({ force: true, delay: 0 });
      }
    }
  }

  function isMemoTabActive() {
    return window.ChatRightPanel?.current === "memos";
  }

  function scheduleRefresh({ force = false, delay = 80 } = {}) {
    if (!force && !isMemoTabActive()) {
      dirty = true;
      return;
    }
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refresh();
    }, delay);
  }

  function render() {
    const root = document.getElementById("rp-panel-memos");
    if (!root) return;
    const listHtml = items.length
      ? [...items].reverse().map(m => `
        <div class="memo-item" data-id="${escapeHtml(m.id)}">
          <div class="memo-meta">
            <span class="memo-src">${escapeHtml(srcLabel(m))}</span>
            <span class="memo-time">${escapeHtml(fmtTime(m.ts))}</span>
            <span class="memo-acts">
              <button data-act="memo-quote" title="引用到输入框">↩</button>
              <button data-act="memo-copy" title="复制">📋</button>
              <button data-act="memo-del" title="删除">✕</button>
            </span>
          </div>
          <div class="memo-text">${escapeHtml(m.text)}</div>
        </div>`).join("")
      : `<div class="memo-empty">还没有收藏。<br>在 AI 回答（圆桌气泡或 AI 原网页）上<b>划选一段文字</b>，点浮出的「📌 存入圆桌备忘录」即可保留金句。</div>`;

    root.innerHTML = `
      <div class="rp-section-title memo-head">备忘录 <span class="rp-count">${items.length}</span>
        ${items.length ? `<span class="memo-header-acts"><button class="rp-app-btn" id="memo-copy-all" title="按时间顺序合并复制全部">复制全部</button><button class="rp-app-btn" id="memo-clear-all" title="清空备忘录">清空</button></span>` : ""}
      </div>
      <div class="memo-list">${listHtml}</div>`;

    root.querySelector("#memo-clear-all")?.addEventListener("click", () => {
      const _msg = `清空全部 ${items.length} 条备忘录？不可恢复`;
      if (window.ChatModal) {
        window.ChatModal.confirm({ tone: "warning", title: "清空备忘录", message: _msg, okLabel: "清空", tip: "此操作不可恢复" })
          .then(ok => { if (!ok) return; chrome.runtime.sendMessage({ type: "memoClear" }, () => refresh()); });
        return;
      }
      if (!confirm(_msg)) return;   // fallback
      chrome.runtime.sendMessage({ type: "memoClear" }, () => refresh());
    });
    root.querySelector("#memo-copy-all")?.addEventListener("click", () => {
      const all = items.map(m => `【${srcLabel(m)} · ${fmtTime(m.ts)}】\n${m.text}`).join("\n\n");
      navigator.clipboard?.writeText(all).then(() => {
        try { window.ChatLog?.push?.({ ts: Date.now(), text: `已复制 ${items.length} 条备忘录`, level: "ok" }); } catch (_) {}
      }).catch(() => {});
    });
    root.querySelectorAll(".memo-item").forEach(el => {
      const id = el.dataset.id;
      const memo = items.find(m => m.id === id);
      el.querySelector("[data-act='memo-del']")?.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "memoRemove", id }, () => refresh());
      });
      el.querySelector("[data-act='memo-copy']")?.addEventListener("click", () => {
        if (memo) navigator.clipboard?.writeText(memo.text).catch(() => {});
      });
      el.querySelector("[data-act='memo-quote']")?.addEventListener("click", () => {
        if (!memo) return;
        const input = document.getElementById("chat-input");
        if (!input) return;
        // v5.0.21 审查修复：追加文本节点而非 textContent 整体赋值 — 后者重建 contenteditable
        //   的全部子节点，会吞掉用户的 @mention 草稿；且不派发 input 事件，防引用文本里
        //   的 @ 字符误触发 mention 菜单
        const quote = `「${memo.text.length > 500 ? memo.text.slice(0, 500) + "…" : memo.text}」`;
        if (input.textContent && !/\s$/.test(input.textContent)) {
          input.appendChild(document.createTextNode("\n"));
        }
        input.appendChild(document.createTextNode(quote));
        try {
          // 光标移到末尾，方便继续输入
          const range = document.createRange();
          range.selectNodeContents(input);
          range.collapse(false);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        } catch (_) {}
        input.focus();
      });
    });
  }

  // background 增删后广播（含其他窗口/网页来源的新增）→ 实时刷新
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "memoUpdated") scheduleRefresh();
  });
  document.addEventListener("rp:activated", (e) => {
    if (e.detail?.tab === "memos" && dirty) scheduleRefresh({ force: true, delay: 0 });
  });

  // ── 主界面消息区划线收藏（与 content-shared 站点侧同款交互）──
  (function initPopupClip() {
    const $messages = document.getElementById("chat-messages");
    if (!$messages) return;
    let btn = null;
    function hideBtn() { if (btn) { try { btn.remove(); } catch (_) {} btn = null; } }
    function showBtn(x, y, text, service) {
      hideBtn();
      btn = document.createElement("div");
      btn.className = "memo-clip-btn";
      btn.textContent = "📌 存入备忘录";
      btn.style.left = `${Math.round(x)}px`;
      btn.style.top = `${Math.round(y)}px`;
      btn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
      btn.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        const el = btn;
        chrome.runtime.sendMessage({
          type: "memoAdd", text,
          source: { type: "popup", service: service || "" },
        }, (resp) => {
          if (el) el.textContent = (resp && resp.ok) ? "✓ 已存入" : "⚠ 失败";
          setTimeout(hideBtn, 800);
        });
      });
      document.body.appendChild(btn);
    }
    document.addEventListener("mouseup", (e) => {
      if (btn && (e.target === btn || btn.contains(e.target))) return;
      setTimeout(() => {
        try {
          const sel = window.getSelection();
          const text = (sel && !sel.isCollapsed ? String(sel) : "").trim();
          if (!text || text.length < 8) return hideBtn();
          // 只对消息区内的选区生效（输入框/右栏不打扰）
          const anchor = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
          if (!anchor || !$messages.contains(anchor)) return hideBtn();
          if (anchor.closest?.("#chat-input, textarea, input")) return hideBtn();
          const service = anchor.closest?.(".msg.ai")?.dataset?.participantId || "";
          const rect = sel.getRangeAt(0).getBoundingClientRect();
          if (!rect || (!rect.width && !rect.height)) return hideBtn();
          const x = Math.min(Math.max(rect.left + rect.width / 2 - 55, 8), Math.max(8, window.innerWidth - 130));
          const y = Math.min(rect.bottom + 6, Math.max(8, window.innerHeight - 40));
          showBtn(x, y, text, service);
        } catch (_) {}
      }, 10);
    }, true);
    document.addEventListener("mousedown", (e) => { if (btn && e.target !== btn && !btn.contains(e.target)) hideBtn(); }, true);
    $messages.addEventListener("scroll", hideBtn, true);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideBtn(); });
  })();

  window.ChatMemos = { refresh };
  // 初始不抢启动资源；打开备忘录 Tab 或收到可见状态更新时再拉取。
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      if (isMemoTabActive()) scheduleRefresh({ force: true, delay: 0 });
    });
  } else if (isMemoTabActive()) {
    scheduleRefresh({ force: true, delay: 0 });
  }
})();
