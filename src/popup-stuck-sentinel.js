// popup-stuck-sentinel.js — v5.0.24 J 全局"卡住"哨兵
// 萌新面对黑盒等待不会自查：发送后 90s 内没有任何 AI 的实质回应（有内容的流式更新或完成），
// 弹温和 toast 指向一键体检。与 chat-bus 的 45s 空文本超时/10min 提取超时不冲突 —
// 那些是单 AI 级兜底，这里是"全场无人响应"的体感级提醒。
(function () {
  const STUCK_MS = 90000;
  let timer = null;
  let warned = false;

  function disarm() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  function fire() {
    timer = null;
    if (warned) return;
    warned = true;
    try {
      window.ChatToast?.show(
        "⏳ 发出 90 秒还没有任何 AI 回应，可能卡住了 — 点这条提示一键体检",
        { type: "warn", duration: 10000, onClick: () => window.ChatDoctor?.run?.() }
      );
      window.ChatLog?.push?.({ ts: Date.now(), text: "90s 无任何 AI 回应，建议 🩺 体检", level: "warn" });
    } catch (_) {}
  }

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === "chatClear" || msg?.type === "hardReset") { disarm(); return; }
      if (msg?.type !== "chatStreamUpdate") return;
      if (msg.role === "user") {
        warned = false;
        disarm();
        timer = setTimeout(fire, STUCK_MS);
      } else if (msg.role === "ai") {
        // 只有"实质回应"才解除（有内容或完成）；发送瞬间的空 typing 占位不算
        const meaningful = (msg.text && msg.text.trim().length > 0) || msg.isDone;
        if (meaningful) disarm();
      }
    });
  } catch (_) {}
})();
