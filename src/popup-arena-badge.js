// popup-arena-badge.js — v4.8.20 ③ 辩论轮次徽章
// 监听 chatStreamUpdate 解析 displayText 显示徽章；所有 AI 完成 4s 后自动隐藏
(function () {
  const $badge = document.getElementById("arena-badge");
  const $text = document.getElementById("arena-badge-text");
  const $mode = document.getElementById("arena-badge-mode");
  if (!$badge || !$text || !$mode) return;

  // 解析 background.js / chat-bus.js 推过来的 displayText
  // 辩论：「⚔️ 第N轮辩论·自由辩论」/「⚔️ 第N轮辩论·群策群力」
  // 总结：「📋 裁判总结请求 → Claude」/「📋 裁判总结·Claude」
  function parseDisplayText(text) {
    if (typeof text !== "string") return null;
    let m = /第\s*(\d+)\s*轮辩论\s*[·•]\s*(\S+)/.exec(text);
    if (m) return { kind: "debate", round: parseInt(m[1], 10), mode: m[2] };
    m = /裁判总结(?:请求)?\s*[·•→\s]+\s*(\S+?)(?:[\s：]|$)/.exec(text);
    if (m) return { kind: "summary", judge: m[1] };
    return null;
  }

  let hideTimer = null;
  let activeAIs = new Set();   // 当前轮次仍在 busy 的 AI service ids

  function show(info) {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (info.kind === "debate") {
      $badge.classList.remove("summary");
      $text.textContent = `Round ${info.round}`;
      $mode.textContent = info.mode;
    } else if (info.kind === "summary") {
      $badge.classList.add("summary");
      $text.textContent = `裁判总结`;
      $mode.textContent = info.judge;
    }
    $badge.removeAttribute("hidden");
    // 强制 reflow 让 animation 重跑
    $badge.style.animation = "none";
    void $badge.offsetWidth;
    $badge.style.animation = "";
  }

  function hide() {
    $badge.setAttribute("hidden", "");
  }

  function scheduleHideIfIdle() {
    if (activeAIs.size > 0) return;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => hide(), 4000);
  }

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type !== "chatStreamUpdate") return;
      if (msg.role === "user") {
        const info = parseDisplayText(msg.text);
        if (info) {
          activeAIs.clear();   // 新轮次重置
          show(info);
        }
      } else if (msg.role === "ai") {
        if (msg.isDone || msg.skipped || msg.emptyTimeout) {
          activeAIs.delete(msg.participantId);
          scheduleHideIfIdle();
        } else if (msg.participantId) {
          activeAIs.add(msg.participantId);
        }
      }
      // hardReset / chatClear → 立刻清空
      return;
    });
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === "hardReset" || msg?.type === "chatClear") {
        activeAIs.clear();
        if (hideTimer) clearTimeout(hideTimer);
        hide();
      }
    });
  } catch (_) {}

  window.ArenaBadge = { show, hide, _parse: parseDisplayText };
})();
