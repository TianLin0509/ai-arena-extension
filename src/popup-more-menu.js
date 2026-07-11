// popup-more-menu.js — v5.0.67 header「⋯更多」菜单
//   ② 彻底重置全等级收纳：危险且低频，不常驻一级操作面（防误触）
//   ① 新手模式（body.adv-locked）下折叠的进阶按钮（折叠到顶/简洁/PPT/对比）
//      在此保持可达 + 「解锁完整界面」入口 —— 好奇的新手点 ⋯ 能看到全部
//   菜单项 = 原按钮代理（proxy click），业务逻辑零复制；显隐由 popup.css 按等级控制
(function () {
  const wrap = document.getElementById("hdr-more-wrap");
  const btn = document.getElementById("btn-more");
  const menu = document.getElementById("hdr-more-menu");
  if (!wrap || !btn || !menu) return;

  function close() { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); }
  function open() { menu.hidden = false; btn.setAttribute("aria-expanded", "true"); }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu.hidden) open(); else close();
  });
  document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  menu.addEventListener("click", (e) => {
    const item = e.target.closest("[data-more]");
    if (!item) return;
    e.stopPropagation();
    close();
    const act = item.dataset.more;
    if (act === "unlock") { window.ChatProgressive?.unlock("manual"); return; }
    // 原按钮可能被 CSS 隐藏（display:none），.click() 依然触发其既有 handler
    document.getElementById(act)?.click();
  });
})();
