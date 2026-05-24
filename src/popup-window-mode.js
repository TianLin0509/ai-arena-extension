// popup-window-mode.js — 顶栏 AI 窗口布局切换（Tab / 并列）
// v4.5.3: 从 popup-members.js 的"AI 窗口布局" section 迁到顶栏 chat-actions，与 🗑️ ⚡ 同行

(function () {
  let mode = "tiled"; // "tab" | "tiled"

  function $$btns() {
    return document.querySelectorAll("#hdr-mode-toggle .hdr-mode-btn");
  }

  function applyActiveClass() {
    $$btns().forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
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
    // 监听其他端的修改
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes.windowMode) {
          const v = changes.windowMode.newValue;
          if ((v === "tab" || v === "tiled") && v !== mode) {
            mode = v;
            applyActiveClass();
          }
        }
      });
    } catch (_) {}
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
