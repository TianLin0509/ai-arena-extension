// popup-feature-tour.js — v5.0.45 空状态能力标签「点击导览」
// 点能力标签 → 高亮该功能在界面的位置（复用新手指引的 .arena-spot 呼吸光圈）+ 一句气泡提示。
// 方案 A：只高亮位置、不改当前任务状态（不 setTask、不展开菜单）；super PPT 例外 = 直接打开弹窗。
(function () {
  "use strict";

  function spot(sel) {
    document.querySelectorAll(".arena-spot").forEach(function (e) { e.classList.remove("arena-spot"); });
    var el = document.querySelector(sel);
    if (!el) return false;
    el.classList.add("arena-spot");
    try { el.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (_) {}
    setTimeout(function () { el.classList.remove("arena-spot"); }, 3500);
    return true;
  }
  function toast(msg) {
    try { if (window.ChatToast && window.ChatToast.show) { window.ChatToast.show(msg, { type: "info" }); return; } } catch (_) {}
    try { window.ChatStatus && window.ChatStatus.show && window.ChatStatus.show(msg); } catch (_) {}
  }

  // 标签 → { 高亮目标 selector, 气泡文案 }
  var MAP = {
    "debate-free":   { sel: "#task-picker-btn", msg: "⚔️ 自由辩论在底部「同时提问 ▾」→ 辩论 → 自由辩论（先加 2+ 个 AI）" },
    "debate-collab": { sel: "#task-picker-btn", msg: "🤝 群策群力在底部「同时提问 ▾」→ 辩论 → 群策群力" },
    "summary":       { sel: "#task-picker-btn", msg: "📋 裁判总结在底部「同时提问 ▾」→ 裁判总结（选一个 AI 当裁判出报告）" },
    "ppt":           { sel: "#task-picker-btn", msg: "📊 PPT 工坊在底部「同时提问 ▾」→ PPT 制作（文案 → 图片 → PPTX 三步）" },
    "roles":         { sel: '.rp-tab[data-tab="templates"]', msg: "🎭 角色帽（问题澄清员 / 事实核验员 / 反方挑战者 / 综合裁判）是内置模板，在右栏「模板」里" },
    "templates":     { sel: '.rp-tab[data-tab="templates"]', msg: "📐 常用提问模板都在右栏「模板」库，点开即可复用" }
  };

  function onClick(e) {
    var btn = e.target && e.target.closest ? e.target.closest(".es-feat") : null;
    if (!btn) return;
    var feat = btn.dataset.feat;
    if (feat === "super") {                                  // super PPT = 直接打开弹窗式一键 PPT
      try {
        if (window.PptSuper && window.PptSuper.open) window.PptSuper.open();
        else { var b = document.getElementById("btn-ppt-super"); if (b) b.click(); }
      } catch (_) {}
      return;
    }
    var m = MAP[feat];
    if (!m) return;
    spot(m.sel);
    toast(m.msg);
  }

  function bind() {
    var box = document.getElementById("es-features");
    if (box && !box.__tourBound) { box.__tourBound = true; box.addEventListener("click", onClick); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
