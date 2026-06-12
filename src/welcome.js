// welcome.js — v5.0.23 安装欢迎页（仅 onInstalled reason=install 自动打开一次）
// 职责：教萌新钉图标 + 一键打开圆桌窗口（新手之旅在 popup 内自动接管）
(function () {
  const btn = document.getElementById("btn-open");
  const done = document.getElementById("cta-done");
  btn?.addEventListener("click", () => {
    try {
      chrome.runtime.sendMessage({ type: "openArenaPopup" }, () => {
        void chrome.runtime.lastError;
        if (done) done.style.display = "block";
      });
    } catch (_) {}
  });
})();
