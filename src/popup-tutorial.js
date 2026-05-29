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

  // v5.0.7: 抽出 ensureBindings — prev/next/dots/close 绑定从 init() 里搬出来，让 show() 也能触发。
  //   v5.0.6 bug：init() 在 dismissed=true 时直接 return 不绑定，用户点设置 tab"新手教程"按钮
  //   show() 后 prev/next 按钮死。dataset.bound 防重复绑定。
  function ensureBindings() {
    const $prev = document.getElementById("es-tut-prev");
    const $next = document.getElementById("es-tut-next");
    const $dots = document.getElementById("es-tut-dots");
    const $close = document.getElementById("es-tutorial-close");
    const $el = document.getElementById("es-tutorial");
    if ($prev && !$prev.dataset.bound) {
      $prev.dataset.bound = "1";
      $prev.addEventListener("click", () => showPage(currentPage - 1));
    }
    if ($next && !$next.dataset.bound) {
      $next.dataset.bound = "1";
      $next.addEventListener("click", () => showPage(currentPage + 1));
    }
    if ($dots && !$dots.dataset.bound) {
      $dots.dataset.bound = "1";
      $dots.addEventListener("click", (e) => {
        const dot = e.target?.closest?.(".es-tut-dot");
        if (!dot) return;
        const n = parseInt(dot.dataset.page, 10);
        if (!isNaN(n)) showPage(n);
      });
    }
    if ($close && !$close.dataset.bound && $el) {
      $close.dataset.bound = "1";
      $close.addEventListener("click", () => {
        // modal 模式（show() 手动触发）：只关 modal，不写 dismissed flag
        if ($el.classList.contains("es-tutorial-modal")) {
          $el.classList.remove("es-tutorial-modal");
          $el.hidden = true;
          return;
        }
        // 非 modal 模式（首次自动弹）：关闭 + 写 dismissed flag 永久隐藏
        $el.hidden = true;
        try { chrome.storage.local.set({ [STORAGE_KEY]: true }); } catch (_) {}
      });
    }
  }

  async function init() {
    const $el = document.getElementById("es-tutorial");
    if (!$el) return;
    ensureBindings(); // v5.0.7: dismissed 也要绑（show() 后才能用）
    try {
      const r = await new Promise(res => chrome.storage.local.get([STORAGE_KEY], resp => res(resp || {})));
      if (r[STORAGE_KEY]) return;   // 已 dismiss → 不自动显示（但绑定已 ready，show() 可触发）
    } catch (_) {}
    $el.hidden = false;
    showPage(1);
  }

  // v5.0.6: 设置 tab"新手教程"按钮触发 — 把 tutorial 升级为浮动 modal 覆盖在 popup 上，
  //   不依赖 empty-state 可见性（有对话时也能查看）。
  function show() {
    const $el = document.getElementById("es-tutorial");
    if (!$el) return;
    ensureBindings(); // v5.0.7: 保证 prev/next/dots/close 都已绑定
    $el.classList.add("es-tutorial-modal");
    $el.hidden = false;
    showPage(1);
  }
  // v4.8.67: 暴露给运行时 E2E 验证翻页行为；v5.0.6: 加 show
  window.ChatTutorial = { showPage, show, current: () => currentPage };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
