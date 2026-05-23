// AI Arena — popup 左下参与者多选 roster
(function () {
  const $items = document.getElementById("roster-items");
  const $count = document.getElementById("roster-count");
  if (!$items) return;

  const BRAND_SVG = {
    claude: "icons/brands/claude.svg", gemini: "icons/brands/gemini.svg",
    chatgpt: "icons/brands/openai.svg", deepseek: "icons/brands/deepseek.svg",
    doubao: "icons/brands/doubao.svg", qwen: "icons/brands/qwen.svg",
    kimi: "icons/brands/kimi.svg", yuanbao: "icons/brands/yuanbao.svg",
    grok: "icons/brands/grok.svg",
  };

  let participants = [];
  let selected = new Set();
  let lastKnownServices = new Set();  // v4.3.4: 记录上次 known 列表，识别新加入的 AI

  async function refresh() {
    chrome.runtime.sendMessage({ type: "getState" }, (state) => {
      if (!state?.participants) { participants = []; selected = new Set(); render(); return; }
      participants = state.participants;
      const known = new Set(participants.map(p => p.service));
      chrome.storage.local.get("rosterSelected", (data) => {
        if (Array.isArray(data.rosterSelected)) {
          selected = new Set(data.rosterSelected.filter(s => known.has(s)));
        }
        // v4.3.4: 新加入的 AI（known 里有但 lastKnownServices 里没有）→ 自动选中
        for (const s of known) {
          if (!lastKnownServices.has(s) && !selected.has(s)) selected.add(s);
        }
        lastKnownServices = known;
        if (selected.size === 0) selected = new Set(known);
        render();
      });
    });
  }

  function render() {
    $items.innerHTML = participants.map(p => {
      const sel = selected.has(p.service);
      const src = BRAND_SVG[p.service] || "icons/brands/claude.svg";
      return `<div class="roster-item ${sel ? "selected" : "unselected"}" data-service="${p.service}" title="${p.name}${sel ? "（参与下轮）" : "（不参与）"}">
        <img src="${src}" alt="${p.service}">
        ${sel ? '<span class="check">✓</span>' : ''}
      </div>`;
    }).join("");
    if ($count) $count.textContent = `${selected.size} / ${participants.length}`;
    chrome.storage.local.set({ rosterSelected: [...selected] });
    document.dispatchEvent(new CustomEvent("roster:changed", { detail: { selected: [...selected] } }));
  }

  $items.addEventListener("click", (e) => {
    const item = e.target.closest(".roster-item");
    if (!item) return;
    const svc = item.dataset.service;
    if (selected.has(svc)) selected.delete(svc);
    else selected.add(svc);
    // 全空回弹：不允许零参与，回退到全选
    if (selected.size === 0) selected = new Set(participants.map(p => p.service));
    render();
  });

  refresh();
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "stateUpdate" || msg.type === "participantsChanged") refresh();
  });

  window.ChatRoster = { getSelected: () => [...selected], refresh };
})();
