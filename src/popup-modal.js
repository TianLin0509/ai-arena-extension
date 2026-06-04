// popup-modal.js — v4.8.65
// 通用 action dialog（苹果极简白，比 alert/confirm 美观），目前给"辩论回答不足"用
// API: window.ChatModal.show({ tone, icon, title, message, tip, primary, secondary, cancel })
//   - primary / secondary 是 { label, onClick }，cancel 是 { label } 仅关 modal
//   - tone: "warning" | "info"（控制图标圈和标题色）
(function () {
  let activeOverlay = null;
  // v5.0.0-beta fix: escListener 必须在 close 时统一移除，否则点按钮关 modal 后
  // listener 泄漏在 document 上，下次用户按 Ctrl+Enter 想发消息时会被旧 listener
  // 误捕获并重新触发 primary.onClick（典型坑：彻底重置后按 Enter 又重置一遍）
  let activeEscListener = null;

  function close() {
    if (activeEscListener) {
      document.removeEventListener("keydown", activeEscListener);
      activeEscListener = null;
    }
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

    // v5.0.0-beta fix: 注册 escListener 时存到模块级 activeEscListener，
    // close() 统一移除（不再依赖 listener 自己 self-remove，避免点按钮关 modal 时泄漏）
    activeEscListener = function escListener(ev) {
      if (ev.key === "Escape") {
        close();   // close 内部会 removeEventListener
      } else if (ev.key === "Enter" && primary) {
        close();
        try { primary.onClick?.(); } catch (err) { console.warn(err); }
      }
    };
    document.addEventListener("keydown", activeEscListener);

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

  // v4.9.0: 敏感信息守门员命中专用 modal
  //   ctx: { hits: Hit[], masked: string, original: string }
  //   handlers: { onMask(masked), onConfirm(original, hits), onCancel() }
  function showSensitiveBlocked(ctx, handlers) {
    const { hits = [], masked = "", original = "" } = ctx || {};
    const n = hits.length;

    // 命中清单 HTML — 每条一行 "类别 高亮原文"
    const hitsHtml = hits.map(h => `
      <div class="gk-hit-row">
        <span class="gk-hit-cat">${escapeHtml(h.category)}</span>
        <span class="gk-hit-text">${escapeHtml(h.text)}</span>
      </div>
    `).join("");

    // masked 预览 — 简单 escape + 把 <类别> 包成 highlight span
    const previewHtml = escapeHtml(masked).replace(
      /&lt;([^&]+?)&gt;/g,
      '<span class="gk-mask-tag">&lt;$1&gt;</span>'
    );

    close();   // 关掉可能已存在的 modal
    const overlay = document.createElement("div");
    overlay.className = "arena-modal-overlay tone-warning gatekeeper-modal";
    overlay.innerHTML = `
      <div class="arena-modal" role="dialog" aria-modal="true">
        <div class="arena-modal-icon">⚠</div>
        <div class="arena-modal-title">检测到 ${n} 处敏感信息</div>
        <div class="arena-modal-message">发送前请确认，避免内部信息流向外部 AI</div>

        <div class="gk-hits">
          <div class="gk-hits-label">命中项：</div>
          ${hitsHtml}
        </div>

        <div class="gk-preview">
          <div class="gk-preview-label">📝 自动打码后的预览：</div>
          <div class="gk-preview-body">${previewHtml}</div>
        </div>

        <div class="arena-modal-actions gk-actions">
          <button type="button" class="arena-modal-btn secondary" data-role="cancel">取消修改</button>
          <button type="button" class="arena-modal-btn primary"   data-role="mask">自动打码后发送</button>
          <button type="button" class="arena-modal-btn secondary" data-role="confirm">我确认无敏感 · 加入白名单</button>
        </div>

        <button type="button" class="arena-modal-close" data-role="cancel" aria-label="关闭">✕</button>
      </div>`;
    document.body.appendChild(overlay);
    activeOverlay = overlay;

    overlay.addEventListener("click", (e) => {
      const role = e.target?.dataset?.role;
      if (role === "mask") {
        close();
        try { handlers?.onMask?.(masked); } catch (err) { console.warn(err); }
      } else if (role === "confirm") {
        close();
        try { handlers?.onConfirm?.(original, hits); } catch (err) { console.warn(err); }
      } else if (role === "cancel") {
        close();
        try { handlers?.onCancel?.(); } catch (err) { console.warn(err); }
      } else if (e.target === overlay) {
        close();
        try { handlers?.onCancel?.(); } catch (err) { console.warn(err); }
      }
    });

    // v5.0.0-beta fix: 同上 — 用模块级 activeEscListener，close 统一移除避免泄漏
    activeEscListener = function escListener(ev) {
      if (ev.key === "Escape") {
        close();
        try { handlers?.onCancel?.(); } catch (err) {}
      }
    };
    document.addEventListener("keydown", activeEscListener);

    requestAnimationFrame(() => overlay.classList.add("show"));
  }

  // v5.0.11: 辩论 partial inject 警告专用 modal
  //   场景：handleDebateRound 候选 N 个 AI，实际 inject 成功 M 个（M < N），缺 N-M 个被静默丢
  //   ctx: { missing: [{id, name, service, error}], sentCount, totalCount, debateStarted }
  //   handlers: { onResend(missing), onSkip() }
  function showPartialDebateInject(ctx, handlers) {
    const { missing = [], sentCount = 0, totalCount = 0, debateStarted = true } = ctx || {};
    const missingNames = missing.map(m => m.name || m.service).filter(Boolean).join(" · ") || "未知 AI";
    const firstErr = missing.find(m => m.error)?.error || "";
    const errorTip = firstErr ? `失败原因：${firstErr}` : "可能是 tab 失联、注入超时或页面未就绪";

    const title = debateStarted
      ? "辩论部分发送成功 · 有 AI 漏掉了"
      : "辩论发送失败 · 有效接收方不足";
    const message = debateStarted
      ? `辩论 prompt 已发给 ${sentCount} / ${totalCount} 个 AI，${missing.length} 个 AI 漏掉了。`
      : `仅 ${sentCount} / ${totalCount} 个 AI 接收成功，不足以开始辩论。`;
    const primaryLabel = missing.length === 1
      ? `🔄 补发给 ${missingNames}`
      : `🔄 补发给 ${missing.length} 个 AI`;
    const secondaryLabel = debateStarted
      ? `⏭ 跳过 · 用 ${sentCount} 个 AI 继续`
      : "⏭ 跳过 · 关闭弹窗";

    show({
      tone: "warning",
      icon: "⚠",
      title,
      message,
      tip: `缺失：${missingNames}。${errorTip}`,
      primary: { label: primaryLabel, onClick: () => handlers?.onResend?.(missing) },
      secondary: { label: secondaryLabel, onClick: () => handlers?.onSkip?.() },
      cancel: { label: "关闭" },
    });
  }

  window.ChatModal = { show, close, showInsufficientResponses, showSensitiveBlocked, showPartialDebateInject };
})();
