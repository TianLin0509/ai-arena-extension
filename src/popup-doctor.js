// popup-doctor.js — v5.0.24 G 一键体检
// 萌新说不清"哪里不对"：一个按钮跑完每个成员的三项检查（标签页在不在 / 插件脚本活没活 /
// 登录了没有），红绿灯报告 + 每个红灯项直接给修复按钮。求助时报"第几项红的"即可。
(function () {
  let overlay = null;
  // 审查修复（v5.0.24）：① 修复按钮的 3s 自动复查不可取消 → 用户关掉面板后又被强制弹回；
  //   ② 快速双击「再查一次」并发 run → 180ms 动画窗口内双 overlay。取消标记 + in-flight 守卫双保险。
  let _cancelPendingRun = false;
  let _running = false;

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function close() {
    _cancelPendingRun = true;
    if (!overlay) return;
    overlay.classList.remove("show");
    const node = overlay;
    overlay = null;
    setTimeout(() => { try { node.remove(); } catch (_) {} }, 180);
  }

  function send(msg) {
    return new Promise(res => {
      try { chrome.runtime.sendMessage(msg, r => { void chrome.runtime.lastError; res(r || {}); }); }
      catch (_) { res({}); }
    });
  }

  function checkRow(ok, labelOk, labelBad, fixBtn) {
    const light = ok ? `<span class="doc-light ok">●</span>` : `<span class="doc-light bad">●</span>`;
    return `<div class="doc-check">${light}<span>${escapeHtml(ok ? labelOk : labelBad)}</span>${!ok && fixBtn ? fixBtn : ""}</div>`;
  }

  function render(report) {
    close();
    const items = report?.items || [];
    const rows = items.map(it => {
      const loginOk = it.loginStatus !== "login_required";
      const allOk = it.tabAlive && it.csAlive && loginOk;
      return `
        <div class="doc-item ${allOk ? "all-ok" : "has-bad"}" data-pid="${escapeHtml(it.id)}">
          <div class="doc-item-name">${escapeHtml(it.name || it.service)}${allOk ? ' <span class="doc-ok-mark">✓ 正常</span>' : ""}</div>
          ${checkRow(it.tabAlive, "网页标签页正常", "它的网页标签页被关掉了",
            `<button class="doc-fix" data-fix="reopen" data-pid="${escapeHtml(it.id)}">重新打开</button>`)}
          ${it.tabAlive ? checkRow(it.csAlive, "插件通道正常", "插件没连上这个页面（页面可能太久没刷新）",
            `<button class="doc-fix" data-fix="reload" data-pid="${escapeHtml(it.id)}">刷新页面</button>`) : ""}
          ${it.tabAlive ? checkRow(loginOk, "登录状态正常", "还没登录这个 AI 的网站",
            `<button class="doc-fix" data-fix="login" data-pid="${escapeHtml(it.id)}">去登录</button>`) : ""}
        </div>`;
    }).join("");
    const allGreen = items.length && items.every(it => it.tabAlive && it.csAlive && it.loginStatus !== "login_required");

    overlay = document.createElement("div");
    overlay.className = "arena-modal-overlay tone-info doctor-modal";
    overlay.innerHTML = `
      <div class="arena-modal" role="dialog" aria-modal="true">
        <div class="arena-modal-icon">🩺</div>
        <div class="arena-modal-title">${items.length ? (allGreen ? "体检完成 · 一切正常" : "体检完成 · 发现问题") : "还没有 AI 成员"}</div>
        <div class="arena-modal-message">${items.length
          ? (allGreen ? "所有 AI 选手都在线、已登录，可以放心提问。" : "红点项就是没法回答的原因，点旁边的按钮修复：")
          : "先在右侧「成员」里添加 AI，再来体检。"}</div>
        <div class="doc-list">${rows}</div>
        <div class="arena-modal-actions">
          <button type="button" class="arena-modal-btn secondary" data-role="rerun">↻ 再查一次</button>
          <button type="button" class="arena-modal-btn primary" data-role="cancel">关闭</button>
        </div>
        <button type="button" class="arena-modal-close" data-role="cancel" aria-label="关闭">✕</button>
      </div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener("click", async (e) => {
      const role = e.target?.dataset?.role;
      if (role === "cancel" || e.target === overlay) { close(); return; }
      if (role === "rerun") { run(); return; }
      const fix = e.target?.dataset?.fix;
      const pid = e.target?.dataset?.pid;
      if (!fix || !pid) return;
      e.target.disabled = true;
      e.target.textContent = "⏳";
      if (fix === "reopen") await send({ type: "reopenParticipantTab", id: pid });
      else if (fix === "reload") await send({ type: "reloadParticipantTab", id: pid });
      else if (fix === "login") { await send({ type: "activateParticipantTab", id: pid }); close(); return; }
      // 修复动作要时间生效（页面加载/脚本注入），3s 后自动复查
      setTimeout(run, 3000);
    });
    requestAnimationFrame(() => overlay.classList.add("show"));
  }

  async function run() {
    if (_running) return;
    _running = true;
    _cancelPendingRun = false;
    try {
      const report = await send({ type: "runDiagnosis" });
      if (_cancelPendingRun) return;   // 等待期间用户已关闭 → 不再弹回
      render(report);
    } finally {
      _running = false;
    }
  }

  // 体检按钮由 popup-members 渲染（innerHTML 每次重建）→ 用事件委托绑定
  document.addEventListener("click", (e) => {
    if (e.target?.closest?.("#rp-doctor-btn")) run();
  });

  window.ChatDoctor = { run, close };
})();
