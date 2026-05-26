// AI Arena — popup 左下参与者多选 + 下轮回答预览编辑（v4.8.43 方案 C）
//
// pill 形态：[logo (toggle 参与)] [一行预览 (点击编辑)]
// 编辑器：右下方独立 textarea，blur 自动保存到 p.response
// 用户编辑后 p.userEdited=true，polling/watcher 不再覆盖
(function () {
  const $items = document.getElementById("roster-items");
  const $hint  = document.getElementById("roster-upload-hint");
  const $editor = document.getElementById("resp-editor");
  const $editorLogo = document.getElementById("resp-editor-logo");
  const $editorName = document.getElementById("resp-editor-name");
  const $editorText = document.getElementById("resp-editor-text");
  const $editorClose = document.getElementById("resp-editor-close");
  if (!$items) return;

  const BRAND_SVG = {
    claude: "icons/brands/claude.svg", gemini: "icons/brands/gemini.svg",
    chatgpt: "icons/brands/openai.svg", deepseek: "icons/brands/deepseek.svg",
    doubao: "icons/brands/doubao.svg", qwen: "icons/brands/qwen.svg",
    kimi: "icons/brands/kimi.svg", yuanbao: "icons/brands/yuanbao.svg",
    grok: "icons/brands/grok.svg",
  };
  const NAME = {
    claude: "Claude", gemini: "Gemini", chatgpt: "ChatGPT",
    deepseek: "DeepSeek", doubao: "豆包", qwen: "通义千问",
    kimi: "Kimi", yuanbao: "元宝", grok: "Grok",
  };

  let participants = [];
  let selected = new Set();
  let lastKnownServices = new Set();
  let editingPid = null;   // 当前编辑中的 participant.id
  // v4.8.60 F7 fix: popup 重启时 lastKnownServices 初始为空 → 现有 AI 都被视为"新加入"
  //   → 强制覆盖用户的取消选择（破坏用户偏好）。加 firstRefresh 标志跳过首次"自动选中"
  let firstRefresh = true;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  function truncate(s, n) {
    s = String(s || "").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n) + "…" : s;
  }

  async function refresh() {
    chrome.runtime.sendMessage({ type: "getState" }, (state) => {
      if (!state?.participants) { participants = []; selected = new Set(); render(); return; }
      participants = state.participants;
      const known = new Set(participants.map(p => p.service));

      chrome.storage.local.get("rosterSelected", (data) => {
        if (Array.isArray(data.rosterSelected)) {
          selected = new Set(data.rosterSelected.filter(s => known.has(s)));
        }
        // v4.8.60 F7 fix: 首次 refresh 不做"自动选中新加入 AI"（视作 storage 恢复，保留用户偏好）
        //   非首次：检测到 known 中有 lastKnownServices 没的 service → 真新加入 → 自动选中
        if (!firstRefresh) {
          for (const s of known) {
            if (!lastKnownServices.has(s) && !selected.has(s)) selected.add(s);
          }
        }
        lastKnownServices = known;
        firstRefresh = false;
        if (selected.size === 0) selected = new Set(known);
        render();
      });
    });
  }

  function render() {
    if (!participants.length) {
      $items.innerHTML = '<span class="rp-empty">还没添加 AI</span>';
      $hint?.classList.remove("hidden");
      chrome.storage.local.set({ rosterSelected: [...selected] });
      document.dispatchEvent(new CustomEvent("roster:changed", { detail: { selected: [...selected] } }));
      return;
    }
    $items.innerHTML = participants.map(p => {
      const sel = selected.has(p.service);
      const src = BRAND_SVG[p.service] || "icons/brands/claude.svg";
      const name = NAME[p.service] || p.service;
      const resp = (p.response || "").trim();
      const previewText = resp ? truncate(resp, 18) : "等待回复…";
      const isEmpty = !resp;
      const userEdited = !!p.userEdited;
      return `<div class="roster-pill ${sel ? "selected" : "unselected"}${userEdited ? " user-edited" : ""}" data-service="${p.service}" data-pid="${p.id}" title="${escapeHtml(name)}${sel ? "（参与下轮）" : "（不参与）"} — 点 logo 切换参与，点预览编辑回答${userEdited ? "（用户已修改）" : ""}">
        <button class="rp-logo-btn" data-toggle="1" type="button" title="${sel ? "已加入下轮，点击移出" : "未加入下轮，点击加入"}">
          <img class="rp-logo-img" src="${src}" alt="${p.service}">
          ${sel ? '<span class="rp-check">✓</span>' : ''}
        </button>
        <button class="rp-preview ${isEmpty ? 'empty' : ''}" data-edit="1" type="button" title="点击编辑">
          <span class="rp-name">${escapeHtml(name)}</span>
          <span class="rp-text">${escapeHtml(previewText)}</span>
          ${userEdited ? '<span class="rp-edited" title="用户已修改，AI 后续刷新不会覆盖">✎</span>' : ''}
        </button>
      </div>`;
    }).join("");
    chrome.storage.local.set({ rosterSelected: [...selected] });
    document.dispatchEvent(new CustomEvent("roster:changed", { detail: { selected: [...selected] } }));

    if (editingPid && !participants.find(p => p.id === editingPid)) {
      closeEditor();
    }
  }

  // ── pill 点击：logo = toggle，preview = 编辑 ──
  $items.addEventListener("click", (e) => {
    const pill = e.target.closest(".roster-pill");
    if (!pill) return;
    const svc = pill.dataset.service;
    const pid = pill.dataset.pid;
    if (e.target.closest("[data-toggle='1']")) {
      if (selected.has(svc)) selected.delete(svc);
      else selected.add(svc);
      if (selected.size === 0) selected = new Set(participants.map(p => p.service));
      render();
      return;
    }
    if (e.target.closest("[data-edit='1']")) {
      openEditor(pid);
      return;
    }
  });

  // ── editor 显示/隐藏/保存 ──
  function openEditor(pid) {
    const p = participants.find(x => x.id === pid);
    if (!p || !$editor) return;
    editingPid = pid;
    if ($editorLogo) $editorLogo.src = BRAND_SVG[p.service] || "icons/brands/claude.svg";
    if ($editorName) $editorName.textContent = NAME[p.service] || p.service;
    if ($editorText) $editorText.value = p.response || "";
    $editor.hidden = false;
    setTimeout(() => $editorText?.focus(), 30);
  }
  function closeEditor() {
    editingPid = null;
    if ($editor) $editor.hidden = true;
  }
  function saveEditorIfDirty() {
    if (!editingPid) return;
    const p = participants.find(x => x.id === editingPid);
    if (!p || !$editorText) return;
    const newText = $editorText.value;
    if (newText === (p.response || "")) return;
    chrome.runtime.sendMessage({
      type: "setParticipantResponse",
      id: editingPid,
      text: newText,
      userEdited: true,
    }, () => { void chrome.runtime.lastError; });
    p.response = newText;
    p.userEdited = true;
    render();
  }
  $editorText?.addEventListener("blur", saveEditorIfDirty);
  $editorClose?.addEventListener("click", () => {
    saveEditorIfDirty();
    closeEditor();
  });
  $editor?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      saveEditorIfDirty();
      closeEditor();
    }
  });

  // ── upload-hint 智能隐藏：一旦任意 AI 已有 response 就隐藏 ──
  let _anyAiResponded = false;
  function checkAndHideHint() {
    if (_anyAiResponded || !$hint) return;
    const hasResp = participants.some(p => (p.response || "").trim().length > 0);
    if (hasResp) {
      _anyAiResponded = true;
      $hint.classList.add("hidden");
    }
  }

  refresh();
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "stateUpdate" || msg.type === "participantsChanged") {
      if (Array.isArray(msg.participants)) {
        participants = msg.participants;
        const known = new Set(participants.map(p => p.service));
        // v4.8.44 修复：新加入的 service 自动加 selected（image #59 之前 stateUpdate 快路径漏了）
        // v4.8.60 F7 fix: 首次同步（popup 重启时 stateUpdate 可能比 refresh 先到）不做"自动选中"
        //   → 保留用户 storage 里取消的选择，避免重启后所有 AI 都被强制选回
        if (!firstRefresh) {
          for (const s of known) {
            if (!lastKnownServices.has(s) && !selected.has(s)) selected.add(s);
          }
        }
        lastKnownServices = known;
        firstRefresh = false;
        // 清理已不存在的 service
        for (const s of [...selected]) if (!known.has(s)) selected.delete(s);
        if (selected.size === 0) selected = new Set(known);
        if (editingPid && document.activeElement !== $editorText) {
          const p = participants.find(x => x.id === editingPid);
          if (p && $editorText && (p.response || "") !== $editorText.value) {
            $editorText.value = p.response || "";
          }
        }
        render();
        checkAndHideHint();
      } else {
        refresh();
      }
      return;
    }
    if (msg.type === "chatStreamUpdate" && msg.role === "ai" && msg.isDone && msg.text) {
      checkAndHideHint();
    }
    if (msg.type === "chatClear" || msg.type === "hardReset") {
      _anyAiResponded = false;
      $hint?.classList.remove("hidden");
    }
  });

  window.ChatRoster = { getSelected: () => [...selected], refresh };
})();
