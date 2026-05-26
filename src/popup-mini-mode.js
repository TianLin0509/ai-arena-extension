// AI Arena — 群聊简洁模式（Mini Bar）v4.8.15 F30
// 点击 "⇲ 折叠到顶" → body[data-mode="mini"] + 通知 background 把 popup window resize 到一行
// 再点（文字变 "⇱ 展开"）→ 恢复原 bounds + data-mode="full"
//
// 设计细节：
// - body[data-mode] 切换 CSS，隐藏不需要的 DOM 但不 unmount（DOM 持续接收 chatStreamUpdate）
// - bounds 由 chat-bus.js 双套记忆：popupBoundsFull / popupBoundsMini
// - mode 持久化到 chrome.storage.local.popupMode，popup 启动时读取应用
(function () {
  const STORAGE_KEY = "popupMode";

  function setLabel(mode) {
    const btn = document.getElementById("btn-mini-mode");
    if (!btn) return;
    btn.textContent = mode === "mini" ? "⇱ 展开" : "⇲ 折叠到顶";
    btn.title = mode === "mini" ? "展开恢复完整窗口" : "折叠到顶部一行";
  }

  // v4.8.58: mini 下把"⇱ 展开"和"⊟ 简洁"按钮 DOM-move 到 task-picker 旁边
  //   原位置：chat-header > chat-actions（顶栏右侧）
  //   mini 新位置：chat-input-bar 内 task-picker-wrap 之后
  //   full 时移回 chat-actions（保留顶栏原始顺序：先 btn-mini-mode 再 btn-compact-mode）
  //   事件监听绑在 DOM 节点上，move 后保留，不需要重绑
  // v4.8.60: 加防御 — 如果 task-picker-wrap 找不到（HTML 重构 / 极端 DOM 状态），
  //   不能 silent return（会导致按钮留在 chat-header 而 chat-header CSS display:none → 锁死）
  //   返回 false 让调用方知道，调用方降级为 full 模式确保按钮始终可见
  function relocateModeButtons(m) {
    const miniBtn = document.getElementById("btn-mini-mode");
    const compactBtn = document.getElementById("btn-compact-mode");
    if (!miniBtn || !compactBtn) return true;  // 按钮不存在（popup 未加载），跳过但不算失败
    if (m === "mini") {
      const taskWrap = document.querySelector(".task-picker-wrap");
      const inputBar = taskWrap?.parentNode;
      if (!inputBar) {
        console.warn("[popup-mini-mode] v4.8.60: task-picker-wrap 不存在 → relocate 失败，降级 full 避免按钮锁死");
        return false;
      }
      // 按顺序 insert：task-picker-wrap → btn-mini-mode → btn-compact-mode → ...
      inputBar.insertBefore(miniBtn, taskWrap.nextSibling);
      inputBar.insertBefore(compactBtn, miniBtn.nextSibling);
      miniBtn.classList.add("in-input-bar");
      compactBtn.classList.add("in-input-bar");
    } else {
      const actions = document.querySelector(".chat-actions");
      if (!actions) {
        console.warn("[popup-mini-mode] v4.8.60: .chat-actions 不存在 → relocate full 失败");
        return false;
      }
      // 移回顶栏（放在 chat-actions 最前，保持原始顺序）
      actions.insertBefore(miniBtn, actions.firstChild);
      actions.insertBefore(compactBtn, miniBtn.nextSibling);
      miniBtn.classList.remove("in-input-bar");
      compactBtn.classList.remove("in-input-bar");
    }
    return true;
  }

  function applyMode(mode) {
    const m = mode === "mini" ? "mini" : "full";
    // v4.8.60: 先 relocate，失败时降级到 full 避免按钮被 CSS 隐藏锁死
    const ok = relocateModeButtons(m);
    const finalMode = (m === "mini" && !ok) ? "full" : m;
    document.body.setAttribute("data-mode", finalMode);
    setLabel(finalMode);
    if (finalMode !== m) {
      // 降级到 full 时同步 storage（防下次启动又卡死）
      try { chrome.storage.local.set({ [STORAGE_KEY]: finalMode }); } catch (_) {}
    }
  }

  function toggleMode() {
    const cur = document.body.getAttribute("data-mode") === "mini" ? "mini" : "full";
    const next = cur === "mini" ? "full" : "mini";
    applyMode(next);
    chrome.storage.local.set({ [STORAGE_KEY]: next }).catch(() => {});
    chrome.runtime.sendMessage({ type: "miniModeToggle", mode: next }, () => {
      if (chrome.runtime.lastError) {
        console.warn("[mini-mode] toggle msg fail:", chrome.runtime.lastError?.message);
      }
    });
  }

  function init() {
    // 启动时从 storage 读取上次状态，应用
    chrome.storage.local.get([STORAGE_KEY]).then(d => {
      applyMode(d[STORAGE_KEY] || "full");
    }).catch(() => applyMode("full"));

    const btn = document.getElementById("btn-mini-mode");
    if (btn) btn.addEventListener("click", toggleMode);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
