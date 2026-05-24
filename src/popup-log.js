// popup-log.js — 状态日志（v4.6.9 从设置 Tab 抽出来，独立放在右栏下半部分固定位置）
// 数据流：background.js / chat-bus.js 通过 chrome.runtime.sendMessage({type:"status",...}) 推日志，
//         本模块监听后追加到 #rp-log-box（保留近 200 条），自动滚到底。
(function () {
  const MAX_LOGS = 200;
  let logs = [];

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function fmtTime(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleTimeString("zh-CN", {
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    });
  }

  function lineHtml(line) {
    const ts = fmtTime(line.ts);
    const level = line.level || "info";
    const cls = level === "warn" ? "warn"
      : (level === "error" || level === "err") ? "err"
      : (level === "success" || level === "ok") ? "ok"
      : "";
    return `<div class="rp-log-line"><span class="t">[${ts}]</span><span class="${cls}">${escapeHtml(line.text || "")}</span></div>`;
  }

  function renderAll() {
    const box = document.getElementById("rp-log-box");
    if (!box) return;
    if (!logs.length) {
      box.innerHTML = '<div class="rp-log-empty">暂无日志</div>';
      return;
    }
    box.innerHTML = logs.map(lineHtml).join("");
    // 自动滚到底（用户没主动往上滚的情况下）
    box.scrollTop = box.scrollHeight;
  }

  function pushLog(line) {
    logs.push(line);
    if (logs.length > MAX_LOGS) logs = logs.slice(-MAX_LOGS);
    const box = document.getElementById("rp-log-box");
    if (!box) return;
    // 若当前是 empty 状态，先清空提示再写
    if (box.querySelector(".rp-log-empty")) box.innerHTML = "";
    box.insertAdjacentHTML("beforeend", lineHtml(line));
    // 滚到底（自动 follow），但若用户上滚远离底部 > 50px 不强制 follow
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 50;
    if (nearBottom) box.scrollTop = box.scrollHeight;
  }

  function clearLogs() {
    logs = [];
    renderAll();
  }

  // 绑定清空按钮
  function bindHeaderActions() {
    const btn = document.getElementById("rp-log-clear");
    if (btn && !btn._bound) {
      btn._bound = true;
      btn.addEventListener("click", () => {
        if (confirm("清空所有状态日志？")) clearLogs();
      });
    }
  }

  // 监听 background 推送的 status 消息
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === "status" && msg.message) {
        pushLog({ ts: Date.now(), text: msg.message, level: msg.level || "info" });
      }
    });
  } catch (_) {}

  function init() {
    bindHeaderActions();
    renderAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // 暴露给外部（popup-settings 失效后，其他模块用 ChatLog.push）
  window.ChatLog = { push: pushLog, clear: clearLogs, _state: () => logs.slice() };
  // 兼容老代码（ChatSettings.pushLog）
  if (!window.ChatSettings) window.ChatSettings = {};
  window.ChatSettings.pushLog = pushLog;
})();
