// popup-window-mode.js — 顶栏 AI 窗口布局切换（Tab / 并列）
// v4.5.3: 从 popup-members.js 的"AI 窗口布局" section 迁到顶栏 chat-actions，与 🗑️ ⚡ 同行
// v4.8.52: 首次进 Tab 模式时插一条系统消息提醒"chrome 顶部调试提示条不要点取消"

(function () {
  let mode = "tiled"; // "tab" | "tiled"
  const WARN_FLAG = "tabDebuggerWarnSeen";  // v4.8.52: chrome.storage 标记是否已读

  function $$btns() {
    return document.querySelectorAll("#hdr-mode-toggle .hdr-mode-btn");
  }

  function applyActiveClass() {
    $$btns().forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
  }

  // v4.8.52: 检查并提醒 Tab 模式下 chrome 调试横条
  //   chrome 对 debugger API 强制显示"<扩展>已开始调试此浏览器"横条，
  //   用户若点取消会一次性 detach 所有 attach，后台 AI tab 失去反节流 → 流式渲染降到 1 fps
  //   且扩展无法阻止/拦截点击 → 只能教育用户。一次性提示（storage flag），不重复打扰。
  async function maybeShowDebuggerWarning() {
    if (mode !== "tab") return;
    try {
      const r = await new Promise(res => chrome.storage.local.get([WARN_FLAG], resp => res(resp || {})));
      if (r[WARN_FLAG]) return;  // 已读不再提
    } catch (_) {}
    const $messages = document.getElementById("chat-messages");
    if (!$messages) return;  // popup 未加载（sidepanel 端切换时也走这里，没消息区）
    // 同一条提示已存在则不重复（防 setMode 多次触发）
    if ($messages.querySelector('.msg.system[data-sys-key="tab-debugger"]')) return;

    const row = document.createElement("div");
    row.className = "msg system";
    row.dataset.sysKey = "tab-debugger";
    row.innerHTML = `
      <div class="msg-body">
        <div class="msg-sys-bubble">
          <span class="msg-sys-icon">ⓘ</span>
          <div class="msg-sys-text">
            <strong>Tab 模式提示</strong>
            浏览器顶部会出现"<em>AI Arena 已开始调试此浏览器</em>"横条，<strong>请不要点"取消"或 ×</strong>。
            这是 chrome 给 Tab 模式后台 AI 反节流（让流式响应不卡）的必要权限提示——关掉后下次发送会自动恢复，但当前正在生成的 AI 会变慢。
            如果想彻底躲开提示条，切回"并列"模式即可。
          </div>
          <button class="msg-sys-close" type="button" title="不再提醒">✕</button>
        </div>
      </div>`;
    $messages.appendChild(row);
    row.querySelector(".msg-sys-close")?.addEventListener("click", () => {
      row.remove();
    });
    try { chrome.storage.local.set({ [WARN_FLAG]: true }); } catch (_) {}
    try { row.scrollIntoView({ behavior: "smooth", block: "end" }); } catch (_) {}
  }

  async function setMode(next) {
    if (next !== "tab" && next !== "tiled") return;
    if (next === mode) return;
    mode = next;
    applyActiveClass();
    try {
      await new Promise(res => {
        chrome.runtime.sendMessage({ type: "setWindowMode", mode: next }, () => res());
      });
    } catch (_) {}
    // v4.8.52: 切到 Tab 时检查提醒
    if (next === "tab") maybeShowDebuggerWarning();
  }

  async function init() {
    // 读初始值
    try {
      const r = await new Promise(res => {
        chrome.storage.local.get(["windowMode"], resp => res(resp || {}));
      });
      if (r.windowMode === "tab" || r.windowMode === "tiled") mode = r.windowMode;
    } catch (_) {}
    applyActiveClass();
    // 绑定点击
    $$btns().forEach(b => {
      b.addEventListener("click", () => setMode(b.dataset.mode));
    });
    // 监听其他端的修改（sidepanel 端切到 Tab → popup 端也提醒）
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes.windowMode) {
          const v = changes.windowMode.newValue;
          if ((v === "tab" || v === "tiled") && v !== mode) {
            mode = v;
            applyActiveClass();
            if (v === "tab") maybeShowDebuggerWarning();
          }
        }
      });
    } catch (_) {}
    // v4.8.52: popup 启动时若已经处于 Tab 模式且没读过 → 也提醒一次
    if (mode === "tab") maybeShowDebuggerWarning();
  }

  // 暴露给其他模块（如 popup-members.js refresh 时不再管这个）
  window.ChatWindowMode = {
    get current() { return mode; },
    set: setMode
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
