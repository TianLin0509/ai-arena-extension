// popup-modal.js — v4.8.65
// 通用 action dialog（苹果极简白，比 alert/confirm 美观），目前给"辩论回答不足"用
// API: window.ChatModal.show({ tone, icon, title, message, tip, primary, secondary, cancel })
//   - primary / secondary 是 { label, onClick }，cancel 是 { label } 仅关 modal
//   - tone: "warning" | "info"（控制图标圈和标题色）
(function () {
  let activeOverlay = null;

  function close() {
    if (!activeOverlay) return;
    activeOverlay.classList.remove("show");
    const node = activeOverlay;
    activeOverlay = null;
    setTimeout(() => { try { node.remove(); } catch (_) {} }, 180);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function show(opts) {
    close();
    const { tone = "info", icon = "ⓘ", title = "", message = "", tip = "",
            primary, secondary, cancel } = opts || {};

    const overlay = document.createElement("div");
    overlay.className = `arena-modal-overlay tone-${tone}`;
    overlay.innerHTML = `
      <div class="arena-modal" role="dialog" aria-modal="true" aria-labelledby="arena-modal-title">
        <div class="arena-modal-icon">${escapeHtml(icon)}</div>
        <div class="arena-modal-title" id="arena-modal-title">${escapeHtml(title)}</div>
        <div class="arena-modal-message">${escapeHtml(message)}</div>
        ${tip ? `<div class="arena-modal-tip">${escapeHtml(tip)}</div>` : ""}
        <div class="arena-modal-actions">
          ${secondary ? `<button type="button" class="arena-modal-btn secondary" data-role="secondary">${escapeHtml(secondary.label)}</button>` : ""}
          ${primary ? `<button type="button" class="arena-modal-btn primary" data-role="primary">${escapeHtml(primary.label)}</button>` : ""}
        </div>
        ${cancel ? `<button type="button" class="arena-modal-close" data-role="cancel" aria-label="${escapeHtml(cancel.label || "关闭")}">✕</button>` : ""}
      </div>`;
    document.body.appendChild(overlay);
    activeOverlay = overlay;

    overlay.addEventListener("click", (e) => {
      const role = e.target?.dataset?.role;
      if (role === "primary") { close(); try { primary?.onClick?.(); } catch (err) { console.warn(err); } }
      else if (role === "secondary") { close(); try { secondary?.onClick?.(); } catch (err) { console.warn(err); } }
      else if (role === "cancel") close();
      else if (e.target === overlay) close();   // 点遮罩关闭
    });

    document.addEventListener("keydown", function escListener(ev) {
      if (ev.key === "Escape") {
        document.removeEventListener("keydown", escListener);
        close();
      } else if (ev.key === "Enter" && primary) {
        document.removeEventListener("keydown", escListener);
        close();
        try { primary.onClick?.(); } catch (err) { console.warn(err); }
      }
    });

    requestAnimationFrame(() => overlay.classList.add("show"));
  }

  // ── 辩论回答不足专用快捷封装 ──
  //   ctx: { haveCount, totalCount, missing: [{id, name, service}, ...] }
  //   handlers: { onReextract(missing), onSwitchAsk() }
  function showInsufficientResponses(ctx, handlers) {
    const { haveCount = 0, totalCount = 0, missing = [] } = ctx || {};
    const missingNames = missing.map(m => m.name || m.service).filter(Boolean);
    const missingDisplay = missingNames.length
      ? `还没收到回答的 AI：${missingNames.join(" · ")}`
      : "尚有 AI 未给出回答";
    const message = `辩论需要至少 2 个 AI 给出答案，当前只读到 ${haveCount} / ${totalCount} 个有效回答。`;
    show({
      tone: "warning",
      icon: "⚠",
      title: "暂无法开始辩论",
      message,
      tip: missingDisplay + "。可以重新提取一次回答，或先切到「同时提问」让所有 AI 各自回答完再回来辩论。",
      primary: { label: "重新提取所有回答", onClick: () => handlers?.onReextract?.(missing) },
      secondary: { label: "切到同时提问", onClick: () => handlers?.onSwitchAsk?.() },
      cancel: { label: "关闭" },
    });
  }

  window.ChatModal = { show, close, showInsufficientResponses };
})();
