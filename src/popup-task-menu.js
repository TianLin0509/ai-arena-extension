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
    if (state.task === "sequential") return "顺序接力";
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
    sequential: "🔗 顺序接力：先输入问题；在右栏排好 AI 顺序后点「开始」或直接发送",
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
    else if (task === "sequential") current = { task };
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
  // v5.0.72: 支持 summary + 指定裁判（精简模式「📋 裁判总结」一键用，自动选队长）；
  //   单参调用行为不变，向后兼容
  function setTask(task, opts) {
    if (task === "ask") current = { task: "ask" };
    else if (task === "debate") current = { task: "debate", style: current.style || "free" };
    else if (task === "summary" && opts?.judgeId) {
      current = { task: "summary", judgeId: opts.judgeId, judgeName: opts.judgeName || "" };
    }
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

  // v5.0.11: showPartialDebateInject modal "补发缺失"按钮回调 — 对每个 missing AI 调
  //   retryDebateInjectForParticipant，background 用暂存的辩论 prompt 重 inject + 启 polling
  async function _resendMissingDebate(missing, opts = {}) {
    if (!Array.isArray(missing) || !missing.length) return;
    try { window.ChatLog?.push?.({ ts: Date.now(), text: `${opts.compress ? "🗜 压缩后" : ""}补发辩论给 ${missing.length} 个缺失 AI…`, level: "info" }); } catch (_) {}
    const results = await Promise.allSettled(missing.map(m => new Promise(res => {
      chrome.runtime.sendMessage(
        { type: "retryDebateInjectForParticipant", participantId: m.id, compress: !!opts.compress },
        resp => res({ name: m.name || m.service, resp })
      );
    })));
    const okCount = results.filter(r => r.status === "fulfilled" && r.value?.resp?.ok).length;
    try { window.ChatLog?.push?.({ ts: Date.now(), text: `补发完成：${okCount}/${missing.length} 成功`, level: okCount === missing.length ? "ok" : "warn" }); } catch (_) {}
  }

  // v5.2.9 fix: hardReset 时把 task 重置回 ask
  //   bug：用户切到 debate/summary/ppt/baton → 点彻底重置 → 加新 AI → 输入框打字 Ctrl+Enter
  //   handleSend 看 menu.current().task !== "ask" 走 dispatch (debateRound/summary/etc)
  //   不是 chatBroadcast → debate 检查 participants.length < 2 / summary 找不到 judge → 静默 fail
  //   用户感知"按了没反应"。修：监听 hardReset 把 task 拉回 ask，跟视觉对齐
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "hardReset") setTask("ask");
  });

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
            // v5.2.10 fix: chatBroadcast ok=false（如"无可用参与者"）必须 alert
            //   跟 task=debate/summary 内部 alert 行为一致 — 之前 ask 分支静默 fail
            if (resp && !resp.ok) {
              const err = resp.error || "未知原因";
              if (window.ChatModal) {
                const noAI = /参与者|无可用|没有.*AI|至少|添加/.test(err);
                window.ChatModal.alert("发送失败：" + err, {
                  tone: "warning", title: "发送失败",
                  tip: noAI ? "右侧「成员」面板还没有可用的 AI —— 点 🟢 标记的 AI logo 加入（至少 1 个）。点「知道了」带你去。" : "请确认对应 AI 标签页已打开并登录后重试。",
                  onOk: noAI ? function () { try { window.ChatRightPanel && window.ChatRightPanel.activate("members"); } catch (_) {} if (window.ChatModal.spotGuide) window.ChatModal.spotGuide(".rp-add-grid"); } : null,
                });
              } else { alert("发送失败：" + err); }
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
                if (window.ChatModal) {
                  window.ChatModal.confirm({ tone: "warning", title: "仍要继续辩论？", message: resp.message, okLabel: "继续" })
                    .then(ok => { if (ok) sendOnce(true); else res({ ok: false, cancelled: true }); });
                } else {
                  if (window.confirm(resp.message)) sendOnce(true);
                  else res({ ok: false, cancelled: true });
                }
                return;
              }
              // v5.0.11: partial inject 警告 — 候选 AI 部分 inject 失败被静默丢，弹窗补发
              if (resp?.partialInject && window.ChatModal?.showPartialDebateInject) {
                window.ChatModal.showPartialDebateInject(resp, {
                  onResend: (missing) => _resendMissingDebate(missing),
                  // v5.0.19: 压缩后补发（应对网关上传限额）
                  onResendCompressed: (missing) => _resendMissingDebate(missing, { compress: true }),
                  onSkip: () => {},
                });
                res(resp);
                return;
              }
              if (resp && !resp.ok) {
                if (resp.reason === "insufficient_responses" && window.ChatModal) {
                  window.ChatModal.showInsufficientResponses(resp, {
                    onReextract: (missing) => _reextractMissing(missing),
                    onSwitchAsk: () => setTask("ask"),
                  });
                } else {
                  const e = resp.error || "未知错误";
                  window.ChatModal ? window.ChatModal.alert("辩论失败：" + e, { tone: "warning", title: "辩论失败" }) : alert("辩论失败：" + e);
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
            if (resp && !resp.ok) { const e = resp.error || "未知错误"; window.ChatModal ? window.ChatModal.alert("总结失败：" + e, { tone: "warning", title: "总结失败" }) : alert("总结失败：" + e); }
            res(resp || { ok: false, error: chrome.runtime.lastError?.message });
          });
        });
      }
      if (c.task === "ppt") {
        // PPT 工坊逻辑高度依赖 sidepanel 内部状态，popup 提示用户跳 sidepanel
        const _pk = c.kind === 'copy' ? '文案' : c.kind === 'image' ? '图片' : 'PPT 生成';
        window.ChatModal
          ? window.ChatModal.alert("PPT 工坊（" + _pk + "）需在 sidepanel 工具栏完成", { tone: "info", title: "请到 sidepanel 操作", tip: "点浏览器工具栏的扩展图标打开 sidepanel → 进「PPT 制作」tab；或试主界面顶部「🚀 super PPT」弹窗式一键生成。" })
          : alert("PPT 工坊请在 sidepanel 完成");
        return { ok: false, error: "PPT 工坊需在 sidepanel 完成" };
      }
      if (c.task === "sequential") {
        // 改进1：顺序接力模式下，主输入框「发送」= 用当前排定顺序开始接力（与右栏「开始顺序接力」等效）
        if (window.ChatTasks?.startSequential) return await window.ChatTasks.startSequential(text);
        return { ok: false, error: "顺序接力面板未就绪，请在右栏「任务」里操作" };
      }
    },
  };
})();
