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
      // v5.2.4: 图片步骤显示具体模板名，方便用户一眼看出当前是哪种风格
      if (state.kind === "image" && state.template) {
        const tplNames = {
          intro: "介绍", topic: "专题", compare: "对比",
          insight: "洞察", landscape: "全景", all: "全风格",
        };
        return `PPT·图片·${tplNames[state.template] || state.template}`;
      }
      const m = { copy: "PPT·文案", image: "PPT·图片", pptx: "PPT·生成" };
      return m[state.kind] || "PPT";
    }
    if (state.task === "baton") return "AI接力棒";
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

  // v5.0.0-beta: 任务切换时同步更新 chat-input placeholder
  //   让用户知道辩论/总结/PPT 等可"留空直接发送"，不必非要输入文字
  const PLACEHOLDER_BY_TASK = {
    ask:     "输入消息…  Ctrl+Enter 发送  @ 单发",
    debate:  "可选：辩论引导（如\"聚焦性能问题\"）·留空直接开始 · Ctrl+Enter",
    summary: "可选：给裁判的额外指令·留空用默认模板 · Ctrl+Enter",
    ppt:     "PPT 工坊请到右栏「任务」Tab 操作 prompt",
    baton:   "🪄 接棒简报会自动生成到这里 — 在右栏选浓缩官后点「生成」",
  };
  function updatePlaceholder(taskState) {
    const $inp = document.getElementById("chat-input");
    if (!$inp) return;
    $inp.dataset.placeholder = PLACEHOLDER_BY_TASK[taskState?.task] || PLACEHOLDER_BY_TASK.ask;
  }

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
      // v5.2.4: 图片步骤 dataset.template 直接传到 panel（5 种风格 + 我全都要）
      current = { task, kind: item.dataset.kind };
      if (item.dataset.template) current.template = item.dataset.template;
    }
    else if (task === "baton") current = { task };
    refreshPill();
    updatePlaceholder(current);
    close();
    // 通知右栏任务 Tab 同步内容
    document.dispatchEvent(new CustomEvent("task:changed", {
      detail: { ...current }
    }));
  });

  refreshPill();
  updatePlaceholder(current);
  // 首次启动也发一次 task:changed，让右栏任务 Tab 初始化
  document.dispatchEvent(new CustomEvent("task:changed", {
    detail: { ...current }
  }));

  // v4.8.65: 外部触发任务切换（modal "切到同时提问" 按钮用）
  function setTask(task) {
    if (task === "ask") current = { task: "ask" };
    else if (task === "debate") current = { task: "debate", style: current.style || "free" };
    else return;
    refreshPill();
    updatePlaceholder(current);
    document.dispatchEvent(new CustomEvent("task:changed", { detail: { ...current } }));
  }

  // v4.8.65: 并行重新提取指定 AI 列表的回答（modal "重新提取" 按钮用）
  async function _reextractMissing(missing) {
    let targets = Array.isArray(missing) && missing.length ? missing : null;
    if (!targets) {
      try {
        const r = await new Promise(res => chrome.runtime.sendMessage({ type: "getState" }, resp => res(resp || {})));
        targets = (r.participants || []).map(p => ({ id: p.id, name: p.name, service: p.service }));
      } catch (_) { targets = []; }
    }
    if (!targets.length) return;
    try { window.ChatLog?.push?.({ ts: Date.now(), text: `手动重新提取 ${targets.length} 个 AI 回答…`, level: "info" }); } catch (_) {}
    await Promise.allSettled(targets.map(t => new Promise(res => {
      chrome.runtime.sendMessage({ type: "chatReextractOne", participantId: t.id }, resp => res(resp));
    })));
    try { window.ChatLog?.push?.({ ts: Date.now(), text: "重新提取完成，可再次尝试辩论", level: "ok" }); } catch (_) {}
  }

  // 暴露给 popup.js handleSend 用
  window.ChatTaskMenu = {
    current: () => ({ ...current }),
    setTask,
    async dispatch(text, targets) {
      const c = current;
      // v4.7.0: emit 任务类型事件给 popup-stats.js 埋点（任务分布饼图）
      try {
        document.dispatchEvent(new CustomEvent("task:dispatched", {
          detail: { task: c.task, style: c.style, kind: c.kind }
        }));
      } catch (_) {}
      if (c.task === "ask") {
        const msg = { type: "chatBroadcast", text, targets, images: [] };
        return new Promise((res) => {
          chrome.runtime.sendMessage(msg, (resp) => {
            // v4.9.0: 守门员命中 → bridge 接管弹 modal + 重发
            if (window.ChatGatekeeperBridge?.handleResp(msg, resp, { textField: "text" })) {
              res({ ok: false, intercepted: "sensitive_blocked" });
              return;
            }
            res(resp || { ok: false, error: chrome.runtime.lastError?.message });
          });
        });
      }
      if (c.task === "debate") {
        // v4.8.38: 处理 needsConfirm — handleDebateRound 检测到有 AI 正在 polling 时
        //   先返回 { needsConfirm: true, message }，用户确认后再用 force:true 重发
        // v4.8.65: insufficient_responses → 弹自定义 modal（重新提取 / 切同时提问）
        return new Promise((res) => {
          const sendOnce = (force) => {
            const msg = { type: "debateRound", style: c.style, guidance: text || "", concise: false, force };
            chrome.runtime.sendMessage(msg, (resp) => {
              // v4.9.0: 守门员拦截（在 needsConfirm 之前判断 — guardedSend 在 handleDebateRound 之前已 return）
              if (window.ChatGatekeeperBridge?.handleResp(msg, resp, { textField: "guidance" })) {
                res({ ok: false, intercepted: "sensitive_blocked" });
                return;
              }
              if (resp?.needsConfirm) {
                if (window.confirm(resp.message)) {
                  sendOnce(true);
                } else {
                  res({ ok: false, cancelled: true });
                }
                return;
              }
              if (resp && !resp.ok) {
                if (resp.reason === "insufficient_responses" && window.ChatModal) {
                  window.ChatModal.showInsufficientResponses(resp, {
                    onReextract: (missing) => _reextractMissing(missing),
                    onSwitchAsk: () => setTask("ask"),
                  });
                } else {
                  alert(`辩论失败：${resp.error || "未知错误"}`);
                }
              }
              res(resp || { ok: false, error: chrome.runtime.lastError?.message });
            });
          };
          sendOnce(false);
        });
      }
      if (c.task === "summary") {
        const msg = { type: "summary", judgeId: c.judgeId, customInstruction: text || "" };
        return new Promise((res) => {
          chrome.runtime.sendMessage(msg, (resp) => {
            // v4.9.0: 守门员拦截（textField: customInstruction）
            if (window.ChatGatekeeperBridge?.handleResp(msg, resp, { textField: "customInstruction" })) {
              res({ ok: false, intercepted: "sensitive_blocked" });
              return;
            }
            if (resp && !resp.ok) alert(`总结失败：${resp.error || "未知错误"}`);
            res(resp || { ok: false, error: chrome.runtime.lastError?.message });
          });
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
