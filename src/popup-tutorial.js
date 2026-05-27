// popup-tutorial.js — 新手教程 3 步骤卡 v4.8.62
// 首次打开 popup 显示 .es-tutorial；点 ✕ 后写 storage tutorialDismissed 不再出现
(function () {
  const STORAGE_KEY = "tutorialDismissed";

  async function init() {
    const $el = document.getElementById("es-tutorial");
    const $close = document.getElementById("es-tutorial-close");
    if (!$el || !$close) return;
    try {
      const r = await new Promise(res => chrome.storage.local.get([STORAGE_KEY], resp => res(resp || {})));
      if (r[STORAGE_KEY]) return;  // 已 dismiss → 不显示
    } catch (_) {}
    $el.hidden = false;
    $close.addEventListener("click", () => {
      $el.hidden = true;
      try { chrome.storage.local.set({ [STORAGE_KEY]: true }); } catch (_) {}
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
