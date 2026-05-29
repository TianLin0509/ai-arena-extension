// popup-tutorial.js — 新手教程 v4.8.67（5 页 tab 分页，v4.8.62 单页升级）
// 首次打开 popup 显示 .es-tutorial；点 ✕ 后写 storage tutorialDismissed 永久不再显示
// 5 页：基础 3 步 / 窗口模式 / 4 大任务 / 排障 / 进阶；上一页 / 下一页 / 圆点点击切换
(function () {
  const STORAGE_KEY = "tutorialDismissed";
  const TOTAL_PAGES = 5;
  let currentPage = 1;

  function showPage(n) {
    const target = Math.min(Math.max(1, n), TOTAL_PAGES);
    currentPage = target;
    document.querySelectorAll(".es-tut-page").forEach(p => {
      p.hidden = parseInt(p.dataset.page, 10) !== target;
    });
    document.querySelectorAll(".es-tut-dot").forEach(d => {
      d.classList.toggle("active", parseInt(d.dataset.page, 10) === target);
    });
    const $cur = document.getElementById("es-tut-cur");
    if ($cur) $cur.textContent = String(target);
    const $prev = document.getElementById("es-tut-prev");
    const $next = document.getElementById("es-tut-next");
    if ($prev) $prev.disabled = target === 1;
    if ($next) $next.disabled = target === TOTAL_PAGES;
  }

  async function init() {
    const $el = document.getElementById("es-tutorial");
    const $close = document.getElementById("es-tutorial-close");
    if (!$el || !$close) return;
    try {
      const r = await new Promise(res => chrome.storage.local.get([STORAGE_KEY], resp => res(resp || {})));
      if (r[STORAGE_KEY]) return;   // 已 dismiss → 不显示
    } catch (_) {}
    $el.hidden = false;
    showPage(1);

    $close.addEventListener("click", () => {
      $el.hidden = true;
      try { chrome.storage.local.set({ [STORAGE_KEY]: true }); } catch (_) {}
    });

    const $prev = document.getElementById("es-tut-prev");
    const $next = document.getElementById("es-tut-next");
    $prev?.addEventListener("click", () => showPage(currentPage - 1));
    $next?.addEventListener("click", () => showPage(currentPage + 1));

    document.getElementById("es-tut-dots")?.addEventListener("click", (e) => {
      const dot = e.target?.closest?.(".es-tut-dot");
      if (!dot) return;
      const n = parseInt(dot.dataset.page, 10);
      if (!isNaN(n)) showPage(n);
    });
  }

  // v5.0.6: 设置 tab"新手教程"按钮触发 — 把 tutorial 升级为浮动 modal 覆盖在 popup 上，
  //   不依赖 empty-state 可见性（有对话时也能查看）。close 按钮仍 dismiss + 设 storage。
  function show() {
    const $el = document.getElementById("es-tutorial");
    if (!$el) return;
    $el.classList.add("es-tutorial-modal");
    $el.hidden = false;
    showPage(1);
    // close 按钮在 modal 模式下只关 modal 不写 storage（避免误把"我手动开的"当成"用户永久不看"）
    const $close = document.getElementById("es-tutorial-close");
    if ($close && !$close.dataset.modalListenerBound) {
      $close.dataset.modalListenerBound = "1";
      $close.addEventListener("click", () => {
        if ($el.classList.contains("es-tutorial-modal")) {
          $el.classList.remove("es-tutorial-modal");
          $el.hidden = true;
        }
      }, true); // capture 阶段先于原 close handler
    }
  }
  // v4.8.67: 暴露给运行时 E2E 验证翻页行为；v5.0.6: 加 show
  window.ChatTutorial = { showPage, show, current: () => currentPage };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
