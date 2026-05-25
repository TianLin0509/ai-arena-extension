// AI Arena — popup 任务模式选择器
(function () {
  const $picker = document.getElementById("task-picker-btn");
  const $menu = document.getElementById("task-menu");
  const $pickedPill = document.getElementById("task-picked-pill");
  const $judgeList = document.getElementById("summary-judge-list");
  if (!$picker || !$menu) return;

  // 当前任务状态：{ task, style?, kind?, judgeId?, judgeName? }
  let current = { task: "ask" };

  function labelOf(state) {
    if (state.task === "ask") return "同时提问";
    if (state.task === "debate") return state.style === "collab" ? "辩论·群策" : "辩论·自由";
    if (state.task === "summary") return `总结·${state.judgeName || "选裁判"}`;
    if (state.task === "ppt") {
      const m = { copy: "PPT·文案", image: "PPT·图片", pptx: "PPT·生成" };
      return m[state.kind] || "PPT";
    }
    return "?";
  }
  // v4.8.23: refreshPill 同时把当前任务 task 写到 data-mode，让 CSS 按模式换配色
  function refreshPill() {
    $pickedPill.textContent = labelOf(current);
    if ($picker) $picker.dataset.mode = current.task || "ask";
  }

  // v4.8.28: mini 模式下打开菜单时通知 background 临时撑大窗口（菜单向下弹露出来）
  function isMini() { return document.body.getAttribute("data-mode") === "mini"; }
  function notifyMiniExpand(expand) {
    if (!isMini()) return;
    try {
      chrome.runtime.sendMessage({ type: "miniMenuExpand", expand }, () => {
        void chrome.runtime.lastError;
      });
    } catch (_) {}
  }
  function close() {
    if (!$menu.hidden) notifyMiniExpand(false);
    $menu.hidden = true;
  }
  function open() {
    refreshJudges();
    $menu.hidden = false;
    notifyMiniExpand(true);
  }
  $picker.addEventListener("click", (e) => {
    e.stopPropagation();
    if ($menu.hidden) open(); else close();
  });
  document.addEventListener("click", (e) => {
    if (!$menu.hidden && !e.target.closest(".task-picker-wrap")) close();
  });

  function refreshJudges() {
    chrome.runtime.sendMessage({ type: "getState" }, (state) => {
      if (!state?.participants?.length) {
        $judgeList.innerHTML = `<div class="menu-item" style="opacity:0.5">（先添加参与者）</div>`;
        return;
      }
      $judgeList.innerHTML = state.participants.map(p =>
        `<div class="menu-item" data-task="summary" data-judge-id="${p.id}" data-judge-name="${escapeAttr(p.name)}">⚖️ ${escapeAttr(p.name)}</div>`
      ).join("");
    });
  }
  function escapeAttr(s) { return String(s).replace(/"/g, "&quot;").replace(/</g, "&lt;"); }

  $menu.addEventListener("click", (e) => {
    const item = e.target.closest(".menu-item");
    if (!item) return;
    const task = item.dataset.task;
    if (!task) return;
    e.stopPropagation();
    if (task === "ask") current = { task };
    else if (task === "debate") {
      if (!item.dataset.style) return;
      current = { task, style: item.dataset.style };
    }
    else if (task === "summary") {
      if (!item.dataset.judgeId) return;
      current = { task, judgeId: item.dataset.judgeId, judgeName: item.dataset.judgeName };
    }
    else if (task === "ppt") {
      if (!item.dataset.kind) return;
      current = { task, kind: item.dataset.kind };
    }
    refreshPill();
    close();
    // 通知右栏任务 Tab 同步内容
    document.dispatchEvent(new CustomEvent("task:changed", {
      detail: { ...current }
    }));
  });

  refreshPill();
  // 首次启动也发一次 task:changed，让右栏任务 Tab 初始化
  document.dispatchEvent(new CustomEvent("task:changed", {
    detail: { ...current }
  }));

  // 暴露给 popup.js handleSend 用
  window.ChatTaskMenu = {
    current: () => ({ ...current }),
    async dispatch(text, targets) {
      const c = current;
      // v4.7.0: emit 任务类型事件给 popup-stats.js 埋点（任务分布饼图）
      try {
        document.dispatchEvent(new CustomEvent("task:dispatched", {
          detail: { task: c.task, style: c.style, kind: c.kind }
        }));
      } catch (_) {}
      if (c.task === "ask") {
        return new Promise((res) => {
          chrome.runtime.sendMessage(
            { type: "chatBroadcast", text, targets, images: [] },
            (resp) => res(resp || { ok: false, error: chrome.runtime.lastError?.message })
          );
        });
      }
      if (c.task === "debate") {
        // v4.8.38: 处理 needsConfirm — handleDebateRound 检测到有 AI 正在 polling 时
        //   先返回 { needsConfirm: true, message }，用户确认后再用 force:true 重发
        return new Promise((res) => {
          const sendOnce = (force) => {
            chrome.runtime.sendMessage(
              { type: "debateRound", style: c.style, guidance: text || "", concise: false, force },
              (resp) => {
                if (resp?.needsConfirm) {
                  if (window.confirm(resp.message)) {
                    sendOnce(true);
                  } else {
                    res({ ok: false, cancelled: true });
                  }
                  return;
                }
                if (resp && !resp.ok) alert(`辩论失败：${resp.error || "未知错误"}`);
                res(resp || { ok: false, error: chrome.runtime.lastError?.message });
              }
            );
          };
          sendOnce(false);
        });
      }
      if (c.task === "summary") {
        return new Promise((res) => {
          chrome.runtime.sendMessage(
            { type: "summary", judgeId: c.judgeId, customInstruction: text || "" },
            (resp) => {
              if (resp && !resp.ok) alert(`总结失败：${resp.error || "未知错误"}`);
              res(resp || { ok: false, error: chrome.runtime.lastError?.message });
            }
          );
        });
      }
      if (c.task === "ppt") {
        // PPT 工坊逻辑高度依赖 sidepanel 内部状态，popup 提示用户跳 sidepanel
        alert(`PPT 工坊（${c.kind === 'copy' ? '文案' : c.kind === 'image' ? '图片' : 'PPT 生成'}）请在 sidepanel 工具栏完成。\n点击扩展图标打开 sidepanel → PPT 制作 tab。`);
        return { ok: false, error: "PPT 工坊需在 sidepanel 完成" };
      }
    },
  };
})();
