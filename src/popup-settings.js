// popup-settings.js — 设置 Tab：主题 + 快捷键
// v4.6.9: 状态日志已抽到 popup-log.js（右栏下半部分固定区），本文件不再含 log 逻辑
(function () {
  const THEMES = [
    { id: "C", name: "Aurora",  gradient: "linear-gradient(135deg,#5eead4,#a78bfa)" },
    { id: "A", name: "Dark",    gradient: "linear-gradient(135deg,#4f8cff,#6ee7ff)" },
    { id: "B", name: "Warm",    gradient: "linear-gradient(135deg,#b85c38,#e6d7c8)" },
    { id: "D", name: "Neon",    gradient: "linear-gradient(135deg,#ff2d95,#00f0ff)" },
    { id: "E", name: "Light",   gradient: "linear-gradient(135deg,#1a1a2e,#fff)" },
    { id: "F", name: "Sunset",  gradient: "linear-gradient(135deg,#ff8c42,#e84393)" },
  ];
  const THEME_KEY = "uiTheme";

  let currentTheme = "C";

  function render() {
    const root = document.getElementById("rp-panel-settings");
    if (!root) return;
    root.innerHTML = `
      <div class="rp-section-title">主题</div>
      <div class="rp-theme-grid">
        ${THEMES.map(t => `
          <div class="rp-theme-item ${t.id === currentTheme ? "active" : ""}" data-theme="${t.id}">
            <span class="rp-theme-swatch" style="background:${t.gradient}"></span>
            <span>${t.name}${t.id === currentTheme ? " ✓" : ""}</span>
          </div>
        `).join("")}
      </div>

      <div class="rp-section-title">快捷键</div>
      <div class="rp-kbd-list">
        <div><span class="rp-kbd">Ctrl+Enter</span> 发送给全部</div>
        <div><span class="rp-kbd">Ctrl+Shift+D</span> 辩论</div>
        <div><span class="rp-kbd">@</span> 单发指定 AI</div>
        <div><span class="rp-kbd">@all</span> 显式全发</div>
      </div>
    `;

    root.querySelectorAll(".rp-theme-item").forEach(el => {
      el.addEventListener("click", () => setTheme(el.dataset.theme));
    });
  }

  function setTheme(id) {
    currentTheme = id;
    document.body.setAttribute("data-theme", id);
    try { chrome.storage.local.set({ [THEME_KEY]: id }); } catch (_) {}
    render();
    document.dispatchEvent(new CustomEvent("theme:changed", { detail: { theme: id } }));
  }

  async function refresh() {
    try {
      const r = await new Promise(res => {
        chrome.storage.local.get([THEME_KEY], resp => res(resp || {}));
      });
      if (r[THEME_KEY]) {
        currentTheme = r[THEME_KEY];
        document.body.setAttribute("data-theme", currentTheme);
      } else {
        document.body.setAttribute("data-theme", currentTheme);
      }
    } catch (_) {}
    render();
  }

  document.addEventListener("rp:activated", (e) => {
    if (e.detail?.tab === "settings") refresh();
  });

  document.addEventListener("theme:cycle", () => {
    const ids = THEMES.map(t => t.id);
    const idx = ids.indexOf(currentTheme);
    const next = ids[(idx + 1) % ids.length];
    setTheme(next);
  });

  // pushLog 兼容入口由 popup-log.js 接管：window.ChatSettings.pushLog = ChatLog.push
  // 这里不再监听 chrome.runtime.onMessage (避免双重监听导致日志重复)
  const api = {
    refresh, render, setTheme,
    currentTheme: () => currentTheme,
  };
  // 跟 popup-log.js 共存：popup-log.js 已经把 pushLog 挂到了 window.ChatSettings
  if (window.ChatSettings) Object.assign(window.ChatSettings, api);
  else window.ChatSettings = api;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refresh);
  } else {
    refresh();
  }
})();
