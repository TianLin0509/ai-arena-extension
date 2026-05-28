// popup-settings.js — 设置 Tab：主题 + 快捷键
// v4.6.9: 状态日志已抽到 popup-log.js（右栏下半部分固定区），本文件不再含 log 逻辑
(function () {
  // v4.8.18: 主题中文化（参考"湛蓝陨石"风格 — 4 字诗意命名，跟卡牌风格统一）
  // v5.1.0: 新增 G 绛紫暮霭 / H 碧绿茶林，总 8 套
  const THEMES = [
    { id: "C", name: "极光琉璃",  gradient: "linear-gradient(135deg,#5eead4,#a78bfa)" },
    { id: "A", name: "深海指挥",  gradient: "linear-gradient(135deg,#4f8cff,#6ee7ff)" },
    { id: "B", name: "暖橙书页",  gradient: "linear-gradient(135deg,#b85c38,#e6d7c8)" },
    { id: "D", name: "霓虹赛博",  gradient: "linear-gradient(135deg,#ff2d95,#00f0ff)" },
    { id: "E", name: "月白极简",  gradient: "linear-gradient(135deg,#1a1a2e,#fff)" },
    { id: "F", name: "落日熔金",  gradient: "linear-gradient(135deg,#ff8c42,#e84393)" },
    { id: "G", name: "绛紫暮霭",  gradient: "linear-gradient(135deg,#a855f7,#4a2870)" },
    { id: "H", name: "碧绿茶林",  gradient: "linear-gradient(135deg,#4d8b56,#a3d9a5)" },
  ];
  const THEME_KEY = "uiTheme";

  let currentTheme = "C";

  function render() {
    const root = document.getElementById("rp-panel-settings");
    if (!root) return;
    // v4.8.15: 风格区块 — 卡牌 logo 在「经典英雄」「二次元少女」两套美术之间切换
    const logoStyle = window.ArenaLogoStyle?.current || "classic";
    const styles = window.ArenaLogoStyle?.listStyles() || [];
    const stylesHtml = styles.map(s => {
      const preview = window.ArenaLogoStyle?.previewPath(s.id) || "";
      const active = s.id === logoStyle;
      return `
        <div class="rp-style-item ${active ? "active" : ""}" data-style="${s.id}" title="${s.desc}">
          <img class="rp-style-preview" src="${preview}" alt="${s.name}">
          <div class="rp-style-meta">
            <div class="rp-style-name">${s.name}${active ? " ✓" : ""}</div>
            <div class="rp-style-desc">${s.desc}</div>
          </div>
        </div>`;
    }).join("");

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

      <div class="rp-section-title">风格</div>
      <div class="rp-style-grid">${stylesHtml}</div>

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
    root.querySelectorAll(".rp-style-item").forEach(el => {
      el.addEventListener("click", () => {
        window.ArenaLogoStyle?.setCurrent(el.dataset.style);
        render();   // 立即重绘 active 标记
      });
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
  // v4.8.15: logo 风格跨实例切换 → 重绘以更新 ✓ 标记
  document.addEventListener("logo-style-changed", () => render());

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
