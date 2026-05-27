// popup-mini-roster.js — v4.8.31
// mini 模式下在 picker 和输入框之间横排参与者头像 — 跟右栏 hero-slot 卡槽共享逻辑：
//   · 用 brand svg 朴素图标（而非二次元 hero 卡牌）
//   · 点击 = removeParticipant（等同于 hero-slot 的 ⋯ → 移除），AI 不再收到消息
//   · 状态环显示 busy/ready/error
(function () {
  const $bar = document.getElementById("mini-roster");
  if (!$bar) return;

  // 9 个 AI 的 brand svg 路径（朴素品牌图标，跟右栏添加按钮同款）
  const BRAND_SVG = {
    claude:   "icons/brands/claude.svg",
    gemini:   "icons/brands/gemini.svg",
    chatgpt:  "icons/brands/openai.svg",
    deepseek: "icons/brands/deepseek.svg",
    doubao:   "icons/brands/doubao.svg",
    qwen:     "icons/brands/qwen.svg",
    kimi:     "icons/brands/kimi.svg",
    yuanbao:  "icons/brands/yuanbao.svg",
    grok:     "icons/brands/grok.svg",
  };

  let participants = [];                  // [{id, service, name, ...}]
  const streamStatus = new Map();         // service → "busy"|"ready"|"error"|"skipped"

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  function statusOf(p) {
    const s = streamStatus.get(p.service);
    if (s === "skipped") return "skipped";
    if (s) return s;
    if (p.error) return "error";
    if (p.isStreaming) return "busy";
    if (p.response || p.responsePreview) return "ready";
    return "idle";
  }
  function statusLabel(st) {
    return ({ busy:"提取中", ready:"已完成", error:"失败", skipped:"已跳过", idle:"等待中" })[st] || "等待中";
  }

  function render() {
    if (!participants.length) {
      $bar.innerHTML = "";
      $bar.classList.add("empty");
      return;
    }
    $bar.classList.remove("empty");
    $bar.innerHTML = participants.map(p => {
      const st = statusOf(p);
      const src = BRAND_SVG[p.service] || `icons/brands/${p.service}.svg`;
      return `
        <button class="mini-ai status-${st}"
                data-pid="${escapeHtml(p.id)}"
                data-service="${escapeHtml(p.service)}"
                title="${escapeHtml(p.name)} · ${statusLabel(st)} · 点击移出群聊">
          <img class="mini-ai-logo" src="${src}" alt="${escapeHtml(p.name)}">
          <span class="mini-ai-dot ${st}"></span>
        </button>`;
    }).join("");

    // v4.8.31: 点击 = removeParticipant（跟右栏 hero-slot 卡槽 ⋯→移除 共享逻辑）
    $bar.querySelectorAll(".mini-ai").forEach(btn => {
      btn.addEventListener("click", () => {
        const pid = btn.dataset.pid;
        chrome.runtime.sendMessage({ type: "removeParticipant", id: pid }, () => {
          void chrome.runtime.lastError;
        });
      });
    });
  }

  async function refresh() {
    try {
      const r = await new Promise(res => chrome.runtime.sendMessage({ type: "getState" }, resp => res(resp || {})));
      if (Array.isArray(r.participants)) participants = r.participants;
    } catch (_) {}
    render();
  }

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === "stateUpdate" && Array.isArray(msg.participants)) {
        participants = msg.participants;
        render();
        return;
      }
      if (msg?.type === "chatStreamUpdate" && msg.role === "user") {
        streamStatus.clear();
        render();
        return;
      }
      if (msg?.type === "chatStreamUpdate" && msg.role === "ai" && msg.participantId) {
        let next = "busy";
        if (msg.skipped) next = "skipped";
        else if (msg.emptyTimeout) next = "error";
        else if (msg.isDone) next = "ready";
        streamStatus.set(msg.participantId, next);
        render();
        return;
      }
      if (msg?.type === "chatClear" || msg?.type === "hardReset") {
        streamStatus.clear();
        // v4.8.65: hardReset 时 participants 已被 background 清空 → 本地立刻清并刷新，
        // 再拉一次 state 确保跟 background 一致（双保险，防 background stateUpdate 丢包）
        if (msg.type === "hardReset") { participants = []; render(); refresh(); }
        else render();
      }
    });
  } catch (_) {}

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refresh);
  } else {
    refresh();
  }
})();
