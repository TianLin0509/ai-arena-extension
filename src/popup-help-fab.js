// popup-help-fab.js — v5.0.26 ⑩ 全局"遇到问题?"浮标
// 右下角常驻「?」浮标，聚合萌新自救入口：一键体检 / 新手之旅 / 完整教程 / 常见问题。
// 让无助的萌新永远有一个可点的"求救按钮"（可达的帮助降低首周流失）。
(function () {
  let menu = null;

  function closeMenu() {
    if (menu) { try { menu.remove(); } catch (_) {} menu = null; }
    document.removeEventListener("click", onDocClick, true);
  }

  function onDocClick(e) {
    if (menu && !e.target.closest("#arena-help-menu") && !e.target.closest("#arena-help-fab")) closeMenu();
  }

  function openMenu(fab) {
    if (menu) { closeMenu(); return; }
    menu = document.createElement("div");
    menu.id = "arena-help-menu";
    menu.innerHTML = `
      <div class="hf-title">遇到问题？</div>
      <button class="hf-item" data-hf="doctor">🩺 一键体检（检查 AI 是否在线/已登录）</button>
      <button class="hf-item" data-hf="onboarding">🔰 重走新手之旅</button>
      <button class="hf-item" data-hf="tutorial">📘 完整玩法手册</button>
      <button class="hf-item" data-hf="faq">📖 常见问题</button>`;
    document.body.appendChild(menu);
    menu.addEventListener("click", (e) => {
      const act = e.target?.closest?.(".hf-item")?.dataset?.hf;
      if (!act) return;
      closeMenu();
      if (act === "doctor") window.ChatDoctor?.run?.();
      else if (act === "onboarding") window.ChatOnboarding?.restart?.();
      else if (act === "tutorial") window.ChatTutorial?.show?.();
      else if (act === "faq") {
        try { window.ChatRightPanel?.activate("settings"); } catch (_) {}
        setTimeout(() => {
          const faq = document.querySelector(".rp-faq");
          if (faq) { try { faq.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {} }
        }, 200);
      }
    });
    // 审查修复：先 remove 再 add，防快速开关时 setTimeout 的 add 在 closeMenu 的 remove 之后执行 → 孤儿监听器累积
    document.removeEventListener("click", onDocClick, true);
    setTimeout(() => document.addEventListener("click", onDocClick, true), 0);
  }

  function init() {
    if (document.getElementById("arena-help-fab")) return;
    const fab = document.createElement("button");
    fab.id = "arena-help-fab";
    fab.type = "button";
    fab.title = "遇到问题？点这里求助";
    fab.textContent = "?";
    fab.addEventListener("click", (e) => { e.stopPropagation(); openMenu(fab); });
    document.body.appendChild(fab);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
