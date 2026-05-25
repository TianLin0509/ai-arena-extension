// popup-rightpanel.js — 右栏 4 Tab 切换调度器
(function () {
  const TABS = ["members", "tasks", "stats", "templates", "settings"];
  let currentTab = "members";

  function activate(name) {
    if (!TABS.includes(name)) return;
    currentTab = name;
    document.querySelectorAll(".rp-tab").forEach(el => {
      el.classList.toggle("active", el.dataset.tab === name);
    });
    document.querySelectorAll(".rp-panel").forEach(el => {
      el.classList.toggle("active", el.dataset.rpPanel === name);
    });
    try { chrome.storage?.local.set({ rpActiveTab: name }); } catch (_) {}
    document.dispatchEvent(new CustomEvent("rp:activated", { detail: { tab: name } }));
  }

  function init() {
    document.querySelectorAll(".rp-tab").forEach(btn => {
      btn.addEventListener("click", () => activate(btn.dataset.tab));
    });
    // v4.8.33: 每次打开默认成员 tab，不恢复上次选择（rpActiveTab 仍写入便于其他模块查询）
  }

  window.ChatRightPanel = {
    activate,
    get current() { return currentTab; },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
