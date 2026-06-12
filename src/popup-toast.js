// popup-toast.js — v5.0.22 轻量 toast（底部居中浮出，自动消失）
// 用途：把"后台静默动作"翻译给用户看（如 添加成员后已在后台开了 AI 网页 / 登录就绪变绿）。
// notifyStatus 走右栏日志区，萌新看不到；toast 是面向萌新的高可见通道。
// API: window.ChatToast.show(text, { type: "info"|"ok"|"warn", duration })
(function () {
  const MAX_VISIBLE = 2;
  let wrap = null;

  function ensureWrap() {
    if (wrap && document.body.contains(wrap)) return wrap;
    wrap = document.createElement("div");
    wrap.id = "arena-toast-wrap";
    document.body.appendChild(wrap);
    return wrap;
  }

  function show(text, opts) {
    const { type = "info", duration = 4200 } = opts || {};
    if (!text) return;
    const w = ensureWrap();
    // 超出上限先移除最老的（避免连续添加成员时叠一摞）
    while (w.children.length >= MAX_VISIBLE) {
      try { w.firstChild.remove(); } catch (_) { break; }
    }
    const el = document.createElement("div");
    el.className = `arena-toast arena-toast-${type}`;
    el.textContent = text;
    w.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    const t = setTimeout(() => dismiss(el), duration);
    el.addEventListener("click", () => { clearTimeout(t); dismiss(el); });
  }

  function dismiss(el) {
    if (!el || !el.parentNode) return;
    el.classList.remove("show");
    setTimeout(() => { try { el.remove(); } catch (_) {} }, 250);
  }

  window.ChatToast = { show };
})();
