// popup-tasks.js — 任务 Tab：context-sensitive，随 task-picker 切换内容
(function () {
  const state = {
    task: "ask",
    style: "free",
    judgeId: null,
    judgeName: null,
    kind: null,
    guidance: "",
    concise: false,
    // v4.9.1: 接力棒任务状态
    batonOfficerId: null,
    batonLength: 500,
    batonStance: "neutral",
    // v5.0.60: 顺序接力 — 用户排定的发言顺序（participant id 列表）
    sequenceOrder: [],
  };
  let judgesList = [];
  // v4.9.1: 当前在进行的接力棒生成 — 用于切换任务时清理监听
  let _batonListener = null;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function render() {
    const root = document.getElementById("rp-panel-tasks");
    if (!root) return;
    if (state.task === "ask") {
      root.innerHTML = `<div class="rp-empty">
        在底部输入框直接输入消息<br>
        <span class="rp-kbd">Ctrl+Enter</span> 发送给全部<br>
        <span class="rp-kbd">@</span> 单发指定 AI
      </div>`;
      return;
    }
    if (state.task === "debate") {
      root.innerHTML = renderDebate();
      bindDebate(root);
      return;
    }
    if (state.task === "summary") {
      root.innerHTML = renderSummary();
      bindSummary(root);
      return;
    }
    if (state.task === "ppt") {
      root.innerHTML = renderPpt();
      bindPpt(root);
      return;
    }
    if (state.task === "baton") {
      root.innerHTML = renderBaton();
      bindBaton(root);
      return;
    }
    if (state.task === "sequential") {
      root.innerHTML = renderSequential();
      bindSequential(root);
      return;
    }
    root.innerHTML = `<div class="rp-empty">未识别任务</div>`;
  }

  function renderDebate() {
    return `
      <div class="rp-section-title">辩论控制台</div>
      <div class="rp-mode-toggle">
        <button class="rp-mode-btn ${state.style === "free" ? "active" : ""}" data-style="free">⚔️ 自由</button>
        <button class="rp-mode-btn ${state.style === "collab" ? "active" : ""}" data-style="collab">🤝 群策</button>
      </div>
      <details style="margin-bottom:6px">
        <summary style="cursor:pointer;font-size:11px;color:var(--ink-soft);padding:4px 0">引导注入（可选）</summary>
        <textarea class="rp-textarea" id="rp-guidance" placeholder="如：聚焦性能问题">${escapeHtml(state.guidance)}</textarea>
      </details>
      <label class="rp-checkbox-row">
        <input type="checkbox" id="rp-concise" ${state.concise ? "checked" : ""}> 简洁模式
      </label>
      <button class="rp-btn primary" id="rp-btn-debate">⚔️ 开始辩论</button>
      <button class="rp-btn" id="rp-btn-debate-retry" title="如果辩论卡住可强制重试">🔄 强制重试</button>
    `;
  }

  function bindDebate(root) {
    root.querySelectorAll(".rp-mode-btn[data-style]").forEach(b => {
      b.addEventListener("click", () => {
        state.style = b.dataset.style;
        // 保留 textarea 当前值
        const cur = root.querySelector("#rp-guidance")?.value;
        const cc = root.querySelector("#rp-concise")?.checked;
        if (cur !== undefined) state.guidance = cur;
        if (cc !== undefined) state.concise = cc;
        render();
      });
    });
    root.querySelector("#rp-btn-debate")?.addEventListener("click", () => {
      state.guidance = root.querySelector("#rp-guidance")?.value || "";
      state.concise = root.querySelector("#rp-concise")?.checked || false;
      // v4.8.38: needsConfirm — 有 AI 在 polling 时让用户决定
      // v4.8.65: insufficient_responses → 弹自定义 modal（重新提取 / 切同时提问）
      const sendOnce = (force) => {
        const msg = {
          type: "debateRound",
          style: state.style,
          guidance: state.guidance,
          concise: state.concise,
          force,
        };
        chrome.runtime.sendMessage(msg, (resp) => {
          // v4.9.0: 守门员拦截
          if (window.ChatGatekeeperBridge?.handleResp(msg, resp, { textField: "guidance" })) return;
          if (resp?.needsConfirm) {
            if (window.ChatModal) {
              window.ChatModal.confirm({ tone: "warning", title: "仍要继续？", message: resp.message, okLabel: "继续" })
                .then(ok => { if (ok) sendOnce(true); });
              return;
            }
            if (window.confirm(resp.message)) sendOnce(true);
            return;
          }
          // v5.0.11: partial inject 警告（无论辩论是否成功启动都可能带这个字段）
          //   场景：3 个 AI 候选，inject 失败 1 个被静默丢 → 弹窗让用户补发或跳过
          if (resp?.partialInject && window.ChatModal?.showPartialDebateInject) {
            window.ChatModal.showPartialDebateInject(resp, {
              onResend: (missing) => resendMissingDebate(missing),
              // v5.0.19: 压缩后补发 — background 重建压缩版 prompt（应对网关上传限额）
              onResendCompressed: (missing) => resendMissingDebate(missing, { compress: true }),
              onSkip: () => {},  // 已开始的辩论保持 / 未开始的不动，关弹窗即可
            });
            return;
          }
          if (resp && !resp.ok) {
            if (resp.reason === "insufficient_responses" && window.ChatModal) {
              window.ChatModal.showInsufficientResponses(resp, {
                onReextract: (missing) => reextractMissing(missing),
                onSwitchAsk: () => window.ChatTaskMenu?.setTask?.("ask"),
              });
            } else {
              const m = `辩论失败：${resp.error || "未知错误"}`;
              window.ChatModal ? window.ChatModal.alert(m, { tone: "warning", title: "辩论失败" }) : alert(m);
            }
          }
        });
      };
      sendOnce(false);
    });
    root.querySelector("#rp-btn-debate-retry")?.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "retryInject" }, () => {});
    });
  }

  // v5.0.11: showPartialDebateInject modal 的"补发缺失"回调 — 对每个 missing AI 调
  //   retryDebateInjectForParticipant，background 用 _lastPartialDebatePrompts 暂存的
  //   辩论 prompt 重 inject + 启 polling
  async function resendMissingDebate(missing, opts = {}) {
    if (!Array.isArray(missing) || !missing.length) return;
    const pushLog = (text, level) => {
      try { window.ChatLog?.push?.({ ts: Date.now(), text, level }); } catch (_) {}
    };
    pushLog(`${opts.compress ? "🗜 压缩后" : ""}补发辩论给 ${missing.length} 个缺失 AI…`, "info");
    const results = await Promise.allSettled(missing.map(m => new Promise(res => {
      chrome.runtime.sendMessage(
        { type: "retryDebateInjectForParticipant", participantId: m.id, compress: !!opts.compress },
        resp => res({ name: m.name || m.service, resp })
      );
    })));
    const okCount = results.filter(r => r.status === "fulfilled" && r.value?.resp?.ok).length;
    pushLog(`补发完成：${okCount}/${missing.length} 成功`, okCount === missing.length ? "ok" : "warn");
  }

  // v4.8.65: insufficient_responses modal 的"重新提取所有"回调 — 优先只提取缺失的 AI，
  // 拿不到 missing 列表时退回到全部 participants
  async function reextractMissing(missing) {
    let targets = Array.isArray(missing) && missing.length ? missing : null;
    if (!targets) {
      try {
        const r = await new Promise(res => chrome.runtime.sendMessage({ type: "getState" }, resp => res(resp || {})));
        targets = (r.participants || []).map(p => ({ id: p.id, name: p.name, service: p.service }));
      } catch (_) { targets = []; }
    }
    if (!targets.length) return;
    const pushLog = (text, level) => {
      try { window.ChatLog?.push?.({ ts: Date.now(), text, level }); } catch (_) {}
    };
    pushLog(`手动重新提取 ${targets.length} 个 AI 回答…`, "info");
    // 并行调 reextract — chat-bus.reextractOne 自带 5 次重试和占位气泡
    await Promise.allSettled(targets.map(t => new Promise(res => {
      chrome.runtime.sendMessage({ type: "chatReextractOne", participantId: t.id }, resp => res(resp));
    })));
    pushLog("重新提取完成，可再次尝试辩论", "ok");
  }

  function renderSummary() {
    const opts = judgesList.length
      ? judgesList.map(j => `<option value="${escapeHtml(j.id)}" ${j.id === state.judgeId ? "selected" : ""}>${escapeHtml(j.name)}</option>`).join("")
      : `<option value="">（先添加参与者）</option>`;
    return `
      <div class="rp-section-title">裁判总结</div>
      <select class="rp-select" id="rp-judge">
        <option value="">选择裁判…</option>
        ${opts}
      </select>
      <button class="rp-btn primary" id="rp-btn-summary" title="输出结构化 HTML 报告（可归档可分享）">📋 输出总结</button>
      <button class="rp-btn" id="rp-btn-summary-text" title="输出老版 markdown 散文（共识/分歧/裁定/建议四段）">📄 输出文本总结</button>
      <button class="rp-btn" id="rp-btn-export">📤 导出会话</button>
      <button class="rp-btn danger-soft" id="rp-btn-reset">⚡ 重置</button>
    `;
  }

  function bindSummary(root) {
    function dispatchSummary(format) {
      const judgeId = root.querySelector("#rp-judge")?.value;
      if (!judgeId) {
        window.ChatModal
          ? window.ChatModal.alert("请先选择裁判", { tone: "warning", title: "请先选择裁判", tip: "在右侧任务面板的「裁判总结」里选择一个 AI 作为裁判，再点开始。" })
          : alert("请先选择裁判");
        return;
      }
      state.judgeId = judgeId;
      const msg = { type: "summary", judgeId, customInstruction: "", format };
      chrome.runtime.sendMessage(msg, (resp) => {
        // v4.9.0.2 fix I3: 防御性接 bridge，customInstruction 当前写死空，巧合安全；
        // 一旦 v4.9.1 改为可编辑 customInstruction 立即生效
        if (window.ChatGatekeeperBridge?.handleResp(msg, resp, { textField: "customInstruction" })) return;
        if (resp && !resp.ok) {
          const m = `总结失败：${resp.error || "未知错误"}`;
          window.ChatModal ? window.ChatModal.alert(m, { tone: "warning", title: "总结失败" }) : alert(m);
        }
      });
    }
    root.querySelector("#rp-btn-summary")?.addEventListener("click", () => dispatchSummary("html"));
    root.querySelector("#rp-btn-summary-text")?.addEventListener("click", () => dispatchSummary("text"));
    // v4.7.2 fix: 导出会话之前只 handle error，markdown 拿到后没复制/没下载 → 用户感觉按了没反应
    root.querySelector("#rp-btn-export")?.addEventListener("click", async () => {
      const pushLog = (text, level) => {
        try { window.ChatLog?.push?.({ ts: Date.now(), text, level }); } catch (_) {}
      };
      try {
        const r = await new Promise(res => {
          chrome.runtime.sendMessage({ type: "exportSession" }, resp => res(resp || {}));
        });
        if (!r?.ok || !r.markdown) {
          const m = "无辩论记录可导出（先发送几条提问 / 跑一轮辩论）";
          window.ChatModal ? window.ChatModal.alert(m, { tone: "warning", title: "无可导出记录" }) : alert(m);
          pushLog("导出失败：无可导出记录", "warn");
          return;
        }
        // 复制到剪贴板
        try {
          await navigator.clipboard.writeText(r.markdown);
          pushLog("辩论记录已复制到剪贴板", "ok");
        } catch (e) {
          pushLog("剪贴板复制失败（无 focus 时浏览器会拒），降级仅下载文件", "warn");
        }
        // 下载 .md 文件
        const blob = new Blob([r.markdown], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `ai-arena-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        pushLog("Markdown 文件已下载", "ok");
      } catch (e) {
        const m = `导出失败：${e.message}`;
        window.ChatModal ? window.ChatModal.alert(m, { tone: "warning", title: "导出失败" }) : alert(m);
        pushLog("导出异常：" + e.message, "err");
      }
    });
    root.querySelector("#rp-btn-reset")?.addEventListener("click", () => {
      // v5.0.0-beta: 用 ChatModal 替代原生 confirm，跟顶栏「彻底重置」视觉一致
      const doReset = () => chrome.runtime.sendMessage({ type: "hardReset" }, () => {});
      if (window.ChatModal) {
        window.ChatModal.confirm({
          tone: "warning",
          title: "重置会话上下文？",
          message: "将清除当前会话的辩论轮次 / 总结上下文等未导出内容",
          tip: "所有未导出的内容会丢失，不可恢复。",
          okLabel: "重置",
        }).then(ok => { if (ok) doReset(); });
        return;
      }
      if (confirm("重置当前会话上下文？所有未导出的内容会丢失。")) doReset();
    });
  }

  const PPT_TEMPLATES = [
    { key: "intro",     name: "技术介绍", desc: "核心原理" },
    { key: "topic",     name: "技术专题", desc: "总分结构" },
    { key: "compare",   name: "技术对比", desc: "As-Is / To-Be" },
    { key: "insight",   name: "技术洞察", desc: "新技术科普" },
    { key: "landscape", name: "技术全景", desc: "领域沙盘" },
    // v5.2.4: "我全都要" — 让 AI 一次输出 5 种风格 5 张预览图
    { key: "all",       name: "🌈 我全都要", desc: "一次输出 5 种风格 5 张预览图" },
  ];

  const pptUi = {
    template: "intro",
    prompt: "",
    lastKind: null,
    autoLoaded: false,  // v4.9.x: 首次进入 PPT 工坊自动加载文案 prompt 的 guard
  };

  function renderPpt() {
    const k = state.kind || pptUi.lastKind || "copy";
    const kindLabel = { copy: "📝 文案生成", image: "🎨 图片生成", pptx: "📊 PPT 生成" }[k] || "📝 文案生成";
    const tpl = pptUi.template;
    const showTemplate = k === "image";
    return `
      <div class="rp-section-title">PPT 工坊 · 三步流程</div>
      <div class="rp-ppt-steps">
        <button class="rp-ppt-step ${k === "copy" ? "active" : ""}" data-kind="copy">1️⃣ 文案</button>
        <button class="rp-ppt-step ${k === "image" ? "active" : ""}" data-kind="image">2️⃣ 图片</button>
        <button class="rp-ppt-step ${k === "pptx" ? "active" : ""}" data-kind="pptx">3️⃣ PPT</button>
      </div>
      ${showTemplate ? `
        <div class="rp-section-title" style="margin-top:10px">模板（图片生成用）</div>
        <div class="rp-ppt-tpl-grid">
          ${PPT_TEMPLATES.map(t => `
            <button class="rp-ppt-tpl ${t.key === tpl ? "active" : ""}" data-tpl="${t.key}" title="${t.desc}">
              ${escapeHtml(t.name)}
            </button>
          `).join("")}
        </div>
      ` : ""}
      <div class="rp-section-title" style="margin-top:10px">${kindLabel} prompt</div>
      <textarea class="rp-textarea" id="rp-ppt-prompt" placeholder="点击上方 1/2/3 任一步骤按钮生成 prompt，或在这里粘贴/编辑后发送" style="min-height:140px;font-size:11px;font-family:'SF Mono','Consolas',monospace">${escapeHtml(pptUi.prompt)}</textarea>
      <button class="rp-btn primary" id="rp-btn-ppt-send">📤 发送给 ChatGPT</button>
      <button class="rp-btn" id="rp-btn-ppt-copy-text" title="复制 prompt 到剪贴板">📋 复制 prompt</button>
      <div class="rp-empty" style="font-size:10px;padding:4px 0;color:var(--ink-soft);text-align:left">
        ⓘ 流程：① 文案 → AI 整理材料 ② 图片 → AI 生成华为风格效果图 ③ PPT → AI 转 PPTX
      </div>
    `;
  }

  function bindPpt(root) {
    // v4.9.x: 首次进入 PPT 工坊自动加载 prompt（不用用户再点 1/2/3 按钮）
    // v5.2.3 fix: 之前 autoLoaded 强制 reset 成 "copy"，导致从菜单点"图片生成"/"PPT 生成"
    //   右栏总跳到第 1 步文案 — 现在尊重 state.kind 当前值
    if (!pptUi.autoLoaded && !pptUi.prompt) {
      pptUi.autoLoaded = true;
      const initialKind = state.kind || "copy";
      pptUi.lastKind = initialKind;
      state.kind = initialKind;
      loadPptPrompt(initialKind).then(() => render());
    }
    // 1/2/3 step 按钮
    root.querySelectorAll(".rp-ppt-step").forEach(b => {
      b.addEventListener("click", async () => {
        const kind = b.dataset.kind;
        pptUi.lastKind = kind;
        state.kind = kind;
        await loadPptPrompt(kind);
        render();
      });
    });
    // 模板选择
    root.querySelectorAll(".rp-ppt-tpl").forEach(b => {
      b.addEventListener("click", async () => {
        pptUi.template = b.dataset.tpl;
        if ((state.kind || pptUi.lastKind) === "image") await loadPptPrompt("image");
        render();
      });
    });
    // textarea 同步到 state
    const ta = root.querySelector("#rp-ppt-prompt");
    ta?.addEventListener("input", () => { pptUi.prompt = ta.value; });
    // 发送
    root.querySelector("#rp-btn-ppt-send")?.addEventListener("click", () => {
      const text = ta?.value?.trim();
      if (!text) {
        window.ChatModal
          ? window.ChatModal.alert("prompt 为空，先点 1/2/3 按钮生成", { tone: "warning", title: "prompt 为空", tip: "在上方 1/2/3 步骤按钮里点一个生成 prompt，或直接在文本框粘贴。" })
          : alert("prompt 为空，先点 1/2/3 按钮生成");
        return;
      }
      const msg = { type: "sendPromptToService", service: "chatgpt", text };
      chrome.runtime.sendMessage(msg, (resp) => {
        // v4.9.0: 守门员拦截（PPT prompt 可能很长，更可能含敏感信息）
        if (window.ChatGatekeeperBridge?.handleResp(msg, resp, { textField: "text" })) return;
        if (resp && !resp.ok) {
          const m = `发送失败：${resp.error || "未知错误"}\n（请先添加 GPT 参与者并打开 chatgpt.com 标签页）`;
          window.ChatModal ? window.ChatModal.alert(m, { tone: "warning", title: "发送失败" }) : alert(m);
        }
      });
    });
    root.querySelector("#rp-btn-ppt-copy-text")?.addEventListener("click", () => {
      const text = ta?.value?.trim();
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        const btn = root.querySelector("#rp-btn-ppt-copy-text");
        if (btn) { const o = btn.textContent; btn.textContent = "✓ 已复制"; setTimeout(() => btn.textContent = o, 1000); }
      }).catch(() => {});
    });
  }

  async function loadPptPrompt(kind) {
    try {
      const r = await new Promise(res => {
        chrome.runtime.sendMessage({
          type: "pptBuildPrompt",
          kind,
          template: pptUi.template,
        }, resp => res(resp || {}));
      });
      if (r.ok && r.prompt) {
        pptUi.prompt = r.prompt;
      } else if (r.error) {
        const m = "生成 prompt 失败：" + r.error;
        window.ChatModal ? window.ChatModal.alert(m, { tone: "warning", title: "生成失败" }) : alert(m);
      }
    } catch (e) { console.warn("loadPptPrompt fail", e); }
  }

  // ── v4.9.1: 🪄 AI接力棒 ─────────────────────────────────────────────
  // 把当前对话浓缩成给新 AI 看的 prompt，流式回填到群聊主输入框
  function renderBaton() {
    const opts = judgesList.length
      ? judgesList.map(j => `<option value="${escapeHtml(j.id)}" ${j.id === state.batonOfficerId ? "selected" : ""}>${escapeHtml(j.name)}</option>`).join("")
      : `<option value="">（先添加参与者）</option>`;
    return `
      <div class="rp-section-title">🪄 AI接力棒</div>
      <div class="rp-empty" style="font-size:11px;text-align:left;padding:2px 0 8px;color:var(--ink-soft);line-height:1.5">
        把当前对话浓缩成 prompt，自动写到下方输入框 — 复制给任何新 AI 即可秒接话
      </div>
      <label class="rp-label" style="font-size:11px;color:var(--ink-soft);display:block;margin:8px 0 4px">浓缩官</label>
      <select class="rp-select" id="rp-baton-officer">
        <option value="">选浓缩官…</option>
        ${opts}
      </select>
      <label class="rp-label" style="font-size:11px;color:var(--ink-soft);display:block;margin:8px 0 4px">长度</label>
      <select class="rp-select" id="rp-baton-length">
        <option value="300" ${state.batonLength === 300 ? "selected" : ""}>短（300 字以内）</option>
        <option value="500" ${state.batonLength === 500 ? "selected" : ""}>中（500 字以内）</option>
        <option value="800" ${state.batonLength === 800 ? "selected" : ""}>长（800 字以内）</option>
      </select>
      <label class="rp-label" style="font-size:11px;color:var(--ink-soft);display:block;margin:8px 0 4px">视角</label>
      <select class="rp-select" id="rp-baton-stance">
        <option value="neutral" ${state.batonStance === "neutral" ? "selected" : ""}>中立旁观（默认）</option>
        <option value="pro-current" ${state.batonStance === "pro-current" ? "selected" : ""}>继承当前主流立场</option>
        <option value="contrarian" ${state.batonStance === "contrarian" ? "selected" : ""}>鼓励反方观点</option>
      </select>
      <button class="rp-btn primary" id="rp-btn-baton" style="margin-top:10px">🪄 生成接棒简报并复制到输入框</button>
      <div class="rp-empty" style="font-size:10.5px;padding:6px 0 0;color:var(--ink-soft);text-align:left;line-height:1.5">
        ⓘ 浓缩官会在群聊里输出接棒简报，同时实时灌到主输入框；完成后可微调再发送/复制
      </div>
    `;
  }

  function bindBaton(root) {
    const $officer = root.querySelector("#rp-baton-officer");
    const $length  = root.querySelector("#rp-baton-length");
    const $stance  = root.querySelector("#rp-baton-stance");
    const $btn     = root.querySelector("#rp-btn-baton");
    if (!$btn) return;

    $officer?.addEventListener("change", () => { state.batonOfficerId = $officer.value; });
    $length?.addEventListener("change",  () => { state.batonLength = parseInt($length.value, 10) || 500; });
    $stance?.addEventListener("change",  () => { state.batonStance = $stance.value || "neutral"; });

    $btn.addEventListener("click", async () => {
      const officerId = $officer?.value;
      if (!officerId) {
        window.ChatModal
          ? window.ChatModal.alert("请先选择浓缩官", { tone: "warning", title: "请先选择浓缩官", tip: "在上方「浓缩官」下拉里选一个已加入群聊的 AI，再点生成接棒简报。" })
          : alert("请先选择浓缩官");
        return;
      }
      const length = parseInt($length?.value || "500", 10);
      const stance = $stance?.value || "neutral";

      const pushLog = (text, level) => {
        try { window.ChatLog?.push?.({ ts: Date.now(), text, level }); } catch (_) {}
      };

      // v5.2.11: 浓缩官是当前讨论的全程参与者，网页里已有完整上下文 →
      // 不再 popup 端拼 transcript 塞回去（冗余且浪费 token），直接简明 prompt
      const metaPrompt = window.BatonPrompts?.buildBatonMetaPrompt?.({ length, stance });
      if (!metaPrompt) {
        const m = "BatonPrompts 模板未加载，请刷新扩展";
        window.ChatModal ? window.ChatModal.alert(m, { tone: "warning", title: "模板未加载" }) : alert(m);
        return;
      }

      // 4. 找浓缩官 service（chatStreamUpdate 用 service 作 participantId 字段）
      let officerService = judgesList.find(j => j.id === officerId)?.service || null;
      if (!officerService) {
        try {
          const r = await new Promise(res => chrome.runtime.sendMessage({ type: "getState" }, resp => res(resp || {})));
          const p = (r.participants || []).find(pp => pp.id === officerId);
          officerService = p?.service || null;
        } catch (_) {}
      }
      if (!officerService) {
        const m = "找不到该浓缩官，请刷新群聊";
        window.ChatModal ? window.ChatModal.alert(m, { tone: "warning", title: "找不到浓缩官" }) : alert(m);
        return;
      }

      // 5. 清空 chat-input、注册流式监听
      const $input = document.getElementById("chat-input");
      if ($input) { $input.textContent = ""; }

      // 卸掉上次残留的监听（用户连续点）
      if (_batonListener) {
        try { chrome.runtime.onMessage.removeListener(_batonListener); } catch (_) {}
        _batonListener = null;
      }
      let lastText = "";
      _batonListener = (msg) => {
        if (!msg || msg.type !== "chatStreamUpdate" || msg.role !== "ai") return;
        if (msg.participantId !== officerService) return;
        const txt = msg.displayText || msg.responsePreview || "";
        if (txt && txt !== lastText) {
          lastText = txt;
          if ($input) $input.textContent = txt;
        }
        if (msg.isDone || msg.skipped || msg.emptyTimeout) {
          try { chrome.runtime.onMessage.removeListener(_batonListener); } catch (_) {}
          _batonListener = null;
          $btn.textContent = "🪄 生成接棒简报并复制到输入框";
          $btn.disabled = false;
          if (msg.skipped || msg.emptyTimeout) {
            pushLog("🪄 接棒简报生成中断", "warn");
          } else {
            pushLog("🪄 接棒简报已写入输入框，可微调后发送/复制", "ok");
            // 完成后给输入框 focus，让用户能立刻 Ctrl+A / Ctrl+C
            try { $input?.focus(); } catch (_) {}
          }
        }
      };
      chrome.runtime.onMessage.addListener(_batonListener);

      // 6. 发起浓缩 — chatBroadcast 单发给浓缩官
      // v5.2.8 fix: chat-bus._resolveTargetsWithSkipped 用 p.service 匹配 targets,
      // 之前传 officerId（participant.id）匹配不上任何 service → "无可用参与者"
      $btn.disabled = true;
      $btn.textContent = "🪄 浓缩中…";
      pushLog(`🪄 接力棒：让 ${escapeHtml($officer.options[$officer.selectedIndex]?.text || officerService)} 浓缩对话…`, "info");
      const msgOut = {
        type: "chatBroadcast",
        text: metaPrompt,
        targets: [officerService],
        images: [],
      };
      chrome.runtime.sendMessage(msgOut, (resp) => {
        // 守门员拦截兜底（meta-prompt 含原文，可能被规则匹中）
        if (window.ChatGatekeeperBridge?.handleResp?.(msgOut, resp, { textField: "text" })) {
          try { chrome.runtime.onMessage.removeListener(_batonListener); } catch (_) {}
          _batonListener = null;
          $btn.disabled = false;
          $btn.textContent = "🪄 生成接棒简报并复制到输入框";
          return;
        }
        if (resp && !resp.ok) {
          try { chrome.runtime.onMessage.removeListener(_batonListener); } catch (_) {}
          _batonListener = null;
          $btn.disabled = false;
          $btn.textContent = "🪄 生成接棒简报并复制到输入框";
          const m = `生成失败：${resp.error || "未知错误"}`;
          window.ChatModal ? window.ChatModal.alert(m, { tone: "warning", title: "生成失败" }) : alert(m);
        }
      });
    });
  }

  // ── v5.0.60: 🔗 顺序接力 ─────────────────────────────────────────────
  // 排定 AI 发言顺序，逐个串行（后端 handleDebateRoundSequential）；后者看到前者回答，超时自动跳过。
  function _syncSequenceOrder() {
    const ids = judgesList.map(p => p.id);
    state.sequenceOrder = (state.sequenceOrder || []).filter(id => ids.includes(id));
    judgesList.forEach(p => { if (!state.sequenceOrder.includes(p.id)) state.sequenceOrder.push(p.id); });
  }
  function moveSeq(i, dir) {
    const arr = state.sequenceOrder;
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    render();
  }
  function renderSequential() {
    _syncSequenceOrder();
    if (judgesList.length < 2) {
      return `<div class="rp-section-title">🔗 顺序接力</div>
        <div class="rp-empty" style="text-align:left;line-height:1.6">先添加 <b>至少 2 个</b> 参与者，再来这里排顺序接力。</div>`;
    }
    const rows = state.sequenceOrder.map((id, i) => {
      const p = judgesList.find(x => x.id === id);
      if (!p) return "";
      const last = i === state.sequenceOrder.length - 1;
      return `<div class="rp-seq-item" data-id="${escapeHtml(id)}" style="display:flex;align-items:center;gap:8px;padding:6px 9px;margin:4px 0;background:rgba(127,127,127,.10);border-radius:7px">
        <span style="flex:none;width:20px;height:20px;border-radius:6px;background:var(--accent,#6366f1);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center">${i + 1}</span>
        <span style="flex:1;font-size:13px">${escapeHtml(p.name)}</span>
        <button class="rp-seq-up" data-i="${i}" title="上移" ${i === 0 ? "disabled" : ""} style="background:none;border:0;cursor:pointer;color:var(--ink-soft);font-size:12px;padding:2px 4px">▲</button>
        <button class="rp-seq-dn" data-i="${i}" title="下移" ${last ? "disabled" : ""} style="background:none;border:0;cursor:pointer;color:var(--ink-soft);font-size:12px;padding:2px 4px">▼</button>
      </div>`;
    }).join("");
    return `
      <div class="rp-section-title">🔗 顺序接力</div>
      <div class="rp-empty" style="font-size:11px;text-align:left;padding:2px 0 8px;color:var(--ink-soft);line-height:1.5">
        按下面顺序逐个发言，后者能看到前面所有 AI 的回答 · 某家超时自动跳过
      </div>
      <div class="rp-seq-list">${rows}</div>
      <details style="margin:8px 0 6px">
        <summary style="cursor:pointer;font-size:11px;color:var(--ink-soft);padding:4px 0">引导注入（可选）</summary>
        <textarea class="rp-textarea" id="rp-seq-guidance" placeholder="如：聚焦性能问题">${escapeHtml(state.guidance)}</textarea>
      </details>
      <button class="rp-btn primary" id="rp-btn-sequential">▶ 开始顺序接力</button>
      <div class="rp-empty" style="font-size:10.5px;padding:6px 0 0;color:var(--ink-soft);text-align:left;line-height:1.5">
        ⓘ 在下方输入框输入问题后点「开始」：第 1 个 AI 收到你的提问，后面每个 AI 都能看到前面 AI 的回答
      </div>
    `;
  }
  // 改进1：发起顺序接力的统一入口 —— 右栏「▶ 开始」按钮 与 主输入框「发送」(dispatch) 都走它，效果一致。
  //   question 来自主输入框；order 来自当前排定顺序；后端 handleDebateRoundSequential 第一棒发纯提问，后面累积。
  async function startSequential(question) {
    const order = (state.sequenceOrder || [])
      .map(id => judgesList.find(p => p.id === id)?.service)
      .filter(Boolean);
    if (order.length < 2) {
      const m = "顺序接力至少需要 2 个 AI";
      window.ChatModal ? window.ChatModal.alert(m, { tone: "warning", title: "AI 不足", tip: "先在右栏「成员」加至少 2 个 AI，再排顺序接力。" }) : alert(m);
      return { ok: false, error: m };
    }
    const q = String(question || "").trim();
    if (!q) {
      const m = "请先在下方输入框输入要讨论的问题";
      window.ChatModal ? window.ChatModal.alert(m, { tone: "warning", title: "缺少问题", tip: "顺序接力从你的提问开始 —— 先在底部输入框打一个问题再发送。" }) : alert(m);
      return { ok: false, error: m };
    }
    const msg = { type: "debateRoundSequential", userInput: q, guidance: state.guidance || "", concise: false, force: false, sequence: { order } };
    return await new Promise((res) => {
      chrome.runtime.sendMessage(msg, (resp) => {
        if (window.ChatGatekeeperBridge?.handleResp(msg, resp, { textField: "userInput" })) { res({ ok: false, intercepted: "sensitive_blocked" }); return; }
        if (resp && !resp.ok) {
          const reasonMap = {
            not_enough_participants: "至少需要 2 个参与者",
            empty_question: "请先在输入框输入要讨论的问题",
            duplicate_service: "发言顺序里有重复的 AI",
            empty_order: "请先排定发言顺序",
            no_valid_participants: "排定的 AI 不在当前会话里",
          };
          const m = reasonMap[resp.reason] || resp.error || "顺序接力启动失败";
          window.ChatModal ? window.ChatModal.alert(m, { tone: "warning", title: "无法开始顺序接力" }) : alert(m);
        } else if (resp?.ok) {
          const $i = document.getElementById("chat-input");
          if ($i) { if (typeof $i.value === "string") $i.value = ""; else $i.textContent = ""; }
        }
        res(resp || { ok: false, error: chrome.runtime.lastError?.message });
      });
    });
  }
  function bindSequential(root) {
    root.querySelectorAll(".rp-seq-up").forEach(b => b.addEventListener("click", () => moveSeq(parseInt(b.dataset.i, 10), -1)));
    root.querySelectorAll(".rp-seq-dn").forEach(b => b.addEventListener("click", () => moveSeq(parseInt(b.dataset.i, 10), 1)));
    const $g = root.querySelector("#rp-seq-guidance");
    $g?.addEventListener("input", () => { state.guidance = $g.value; });
    const $btn = root.querySelector("#rp-btn-sequential");
    $btn?.addEventListener("click", async () => {
      state.guidance = $g?.value || "";
      const $inp = document.getElementById("chat-input");
      const question = (($inp && (typeof $inp.value === "string" ? $inp.value : $inp.innerText)) || "").trim();
      $btn.disabled = true; $btn.textContent = "🔗 接力进行中…";
      await startSequential(question);
      $btn.disabled = false; $btn.textContent = "▶ 开始顺序接力";
    });
  }

  async function refreshJudges() {
    try {
      const r = await new Promise(res => {
        chrome.runtime.sendMessage({ type: "getState" }, resp => res(resp || {}));
      });
      judgesList = (r.participants || []).map(p => ({ id: p.id, name: p.name || p.service, service: p.service }));
    } catch (_) {}
  }

  document.addEventListener("task:changed", (e) => {
    const d = e.detail || {};
    state.task = d.task || "ask";
    if (d.style) state.style = d.style;
    if (d.judgeId) { state.judgeId = d.judgeId; state.judgeName = d.judgeName; }
    if (d.kind) state.kind = d.kind;
    // v5.2.4: PPT 图片步骤从菜单带 template 进来 → 直接套用 + 触发对应 prompt
    if (d.template && state.task === "ppt") {
      pptUi.template = d.template;
      // 切到 image 步骤跳转触发，让 panel 渲染对应 prompt
      if (state.kind === "image") {
        loadPptPrompt("image").then(() => render());
        return;
      }
    }
    if (state.task === "summary" || state.task === "baton" || state.task === "sequential") {
      refreshJudges().then(render);
    } else {
      render();
    }
    // 自动切到任务 Tab（仅当不是 ask）
    if (state.task !== "ask" && window.ChatRightPanel?.current !== "tasks") {
      window.ChatRightPanel?.activate("tasks");
    }
  });

  document.addEventListener("rp:activated", (e) => {
    if (e.detail?.tab === "tasks") {
      if (state.task === "summary") refreshJudges().then(render);
      else render();
    }
  });

  window.ChatTasks = { render, state: () => ({ ...state }), startSequential };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
})();
