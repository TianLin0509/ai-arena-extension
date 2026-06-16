// AI Arena — popup 群聊渲染 + 输入处理
(function () {
  // v4.6.7 F17: popup 启动时主动告知 SW 自己的 windowId — MV3 SW 30s 空闲被回收时
  // ChatBus.popupWindowId 重建为 null，需要 popup 主动重新注册才能让 focusPopup
  // 等依赖 popupWindowId 的功能恢复（sendToPopup 已改为始终 broadcast 不依赖此 id）。
  try {
    chrome.windows.getCurrent().then(w => {
      if (w?.id != null) {
        chrome.runtime.sendMessage({ type: "popupReady", windowId: w.id }).catch(() => {});
      }
    }).catch(() => {});
  } catch (_) {}

  const $messages = document.getElementById("chat-messages");
  const $empty = document.getElementById("empty-state");
  const $input = document.getElementById("chat-input");
  const $send = document.getElementById("btn-send");
  const $clear = document.getElementById("btn-clear");
  const $mentionMenu = document.getElementById("mention-menu");

  const AVATAR_CLASS = {
    claude: "claude", gemini: "gemini", chatgpt: "chatgpt",
    deepseek: "deepseek", doubao: "doubao", qwen: "qwen",
    kimi: "kimi", yuanbao: "yuanbao", grok: "grok",
  };
  const AVATAR_INITIAL = {
    claude: "C", gemini: "G", chatgpt: "P",
    deepseek: "D", doubao: "豆", qwen: "千",
    kimi: "K", yuanbao: "元", grok: "X",
  };
  const BRAND_SVG = {
    huawei: "icons/brands/huawei.png",
    claude: "icons/brands/claude.svg",
    gemini: "icons/brands/gemini.svg",
    chatgpt: "icons/brands/openai.svg",
    deepseek: "icons/brands/deepseek.svg",
    doubao: "icons/brands/doubao.svg",
    qwen: "icons/brands/qwen.svg",
    kimi: "icons/brands/kimi.svg",
    yuanbao: "icons/brands/yuanbao.svg",
    grok: "icons/brands/grok.svg",
  };
  // v4.8.7: Q 版英雄卡牌（webp，~17KB/张），主对话气泡头像优先用；
  // BRAND_SVG 仍保留作为 fallback（新增 AI 还没卡牌时降级）
  // v4.8.15: 路径走 ArenaLogoStyle.heroPath() 动态切换风格（classic/anime）
  function brandLogoHtml(id) {
    const heroSrc = window.ArenaLogoStyle?.heroPath(id);
    const src = heroSrc || BRAND_SVG[id];
    if (!src) return `<span class="msg-avatar-fallback ${id || ""}">${AVATAR_INITIAL[id] || "?"}</span>`;
    return `<img src="${src}" alt="${id}" class="brand-logo" data-svc="${id}">`;
  }
  const NAME = {
    claude: "Claude", gemini: "Gemini", chatgpt: "ChatGPT",
    deepseek: "DeepSeek", doubao: "豆包", qwen: "千问",
    kimi: "Kimi", yuanbao: "元宝", grok: "Grok",
  };

  // ── 状态 ──
  // bubbleByKey: key = `${msgId}-${participantId}` → DOM element
  const bubbleByKey = new Map();
  const STREAM_RENDER_DEBOUNCE_MS = 220;
  // v5.0.20 PERF-2: 长文本（>8k 字）流式渲染降频 220→600ms — escapeHtml + innerHTML 整段
  //   替换是 O(n)，长回答尾段每秒多次重排无感知收益，拉长窗口省主线程
  const STREAM_RENDER_DEBOUNCE_LONG_MS = 600;
  const STREAM_RENDER_LONG_CHARS = 8000;
  const streamRenderState = new Map();

  // v5.0.20 UX-1: 队长徽章 — 用户普遍"主看一个 AI"，把队长（participants[0]，
  //   prompt 被注入整合指令的那个）在气泡/成员卡/底部 pill 上可视化
  let captainService = null;
  let captainEnabled = true;
  function _refreshCaptainBadges() {
    document.querySelectorAll(".msg.ai").forEach(row => {
      const isCap = !!(captainEnabled && captainService && row?.dataset?.participantId === captainService);
      const b = row.querySelector(".captain-badge");
      if (b) b.style.display = isCap ? "" : "none";
      row.classList.toggle("msg-captain", isCap);                            // v5.0.46: 供「只看队长」过滤
      const ob = row.querySelector('button[data-act="only-captain"]');
      if (ob) ob.style.display = isCap ? "" : "none";                        // 仅队长气泡显示「只看队长」按钮
    });
  }
  function _setCaptainInfo(participants) {
    const next = (participants && participants.length >= 2) ? (participants[0]?.service || null) : null;
    if (next !== captainService) {
      captainService = next;
      _refreshCaptainBadges();
      document.dispatchEvent(new CustomEvent("captain:changed"));
    }
  }
  window.ArenaCaptainInfo = {
    service: () => captainService,
    enabled: () => captainEnabled,
    isCaptain: (svc) => !!(captainEnabled && captainService && svc === captainService),
  };
  try {
    chrome.storage.local.get(["captainModeEnabled"], (d) => {
      captainEnabled = d?.captainModeEnabled !== false;
      _refreshCaptainBadges();
      document.dispatchEvent(new CustomEvent("captain:changed"));
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.captainModeEnabled) {
        captainEnabled = changes.captainModeEnabled.newValue !== false;
        _refreshCaptainBadges();
        document.dispatchEvent(new CustomEvent("captain:changed"));
      }
    });
    chrome.runtime.sendMessage({ type: "getState" }, (r) => {
      if (r?.participants) _setCaptainInfo(r.participants);
    });
  } catch (_) {}

  // ── 渲染 ──
  // v5.0.34 perf: restoreLog 时把气泡 append 到 DocumentFragment 一次性插入，避免 100+ 条逐个重排
  let _restoreTarget = null;
  function ensureEmptyHidden() {
    if ($empty && !$empty.classList.contains("hidden")) {
      $empty.style.display = "none";
    }
  }

  function appendUserMessage(text, msgId) {
    ensureEmptyHidden();
    // v4.6.13 F20: 同 msgId 已存在 → 更新文本（用于辩论 pending 占位 → 正式状态过渡）
    // 避免同一辩论按下产生两条 user 气泡（先 "正在发起..." 后 "第 N 轮辩论"）
    if (msgId) {
      const existing = $messages.querySelector(`.msg.me[data-msg-id="${CSS.escape(msgId)}"]`);
      if (existing) {
        const bubble = existing.querySelector(".msg-bubble");
        if (bubble) bubble.textContent = text;
        return;
      }
    }
    const ts = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    const row = document.createElement("div");
    // v4.8.20 ④ 消息进场动画：just-arrived class 跑 0.5s 入场后移除（避免 hover/重渲染时再跑）
    row.className = "msg me just-arrived";
    row.dataset.msgId = msgId;
    row.innerHTML = `
      <div class="msg-body">
        <div class="msg-meta me-meta">
          <span class="acts"><button data-act="copy" title="复制">${window.ChatActionIcons?.svg("copy") || "📋"}</button></span>
          <span class="stat done"><span class="pip"></span>已发送</span>
          <span class="time">${escapeHtml(ts)}</span>
          <span class="name">我 · Huawei</span>
        </div>
        <div class="msg-bubble">${escapeHtml(text)}</div>
      </div>
      <div class="msg-avatar huawei">${brandLogoHtml('huawei')}</div>`;
    (_restoreTarget || $messages).appendChild(row);
    setTimeout(() => row.classList.remove("just-arrived"), 700);
    // 用户自己发的消息：强制跳底（即使之前在浏览历史也跳到自己刚发的消息）
    if (!_restoreTarget) scrollToBottomForce();
    autoFollow = true; // 用户主动发送 → 恢复 follow 模式
  }

  function appendAIBubble(msgId, participantId, initialText = "", isTyping = true) {
    ensureEmptyHidden();
    const ts = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    const row = document.createElement("div");
    // v4.8.20 ④ 消息进场动画 — typing 初次入场跑动画，restoreLog 重放不跑（避免历史消息一次性跳动）
    row.className = `msg ai${isTyping ? " just-arrived" : ""}${window.ArenaCaptainInfo?.isCaptain?.(participantId) ? " msg-captain" : ""}`;
    if (isTyping) setTimeout(() => row.classList.remove("just-arrived"), 700);
    row.dataset.msgId = msgId;
    row.dataset.participantId = participantId;
    const avatarClass = AVATAR_CLASS[participantId] || "";
    const name = NAME[participantId] || participantId;
    const statClass = isTyping ? "streaming" : "done";
    const statText = isTyping ? "提取中" : "已完成";
    row.innerHTML = `
      <div class="msg-avatar ${avatarClass}">${brandLogoHtml(participantId)}</div>
      <div class="msg-body">
        <div class="msg-meta">
          <span class="name">${name}</span>
          <span class="captain-badge" title="队长：负责整合队友观点，主看它即可" style="display:${window.ArenaCaptainInfo?.isCaptain?.(participantId) ? "" : "none"}">👑 队长</span>
          <button class="cap-only-btn" data-act="only-captain" title="只看队长：聊天区仅保留你的提问和队长回答" style="display:${window.ArenaCaptainInfo?.isCaptain?.(participantId) ? "" : "none"}">👁 只看队长</button>
          <span class="time">${escapeHtml(ts)}</span>
          <span class="stat ${statClass}"><span class="pip"></span>${statText}</span>
          <span class="acts">
            <button data-act="view-prompt" title="查看本轮发给它的 Prompt 全文">${window.ChatActionIcons?.svg("viewPrompt") || "📄"}</button>
            <button data-act="reextract" title="重新提取">${window.ChatActionIcons?.svg("reextract") || "🔄"}</button>
            <button data-act="resend" title="用最新提问重发">${window.ChatActionIcons?.svg("resend") || "📤"}</button>
            <button data-act="skip" title="跳过本轮（避免卡住流程）">${window.ChatActionIcons?.svg("skip") || "⏭"}</button>
            <button data-act="copy" title="复制">${window.ChatActionIcons?.svg("copy") || "📋"}</button>
            <button data-act="jump" title="跳原页">${window.ChatActionIcons?.svg("jump") || "↗"}</button>
          </span>
        </div>
        <div class="msg-bubble">${isTyping ? `<span class="msg-typing"><span></span><span></span><span></span></span>` : renderMarkdown(initialText)}</div>
      </div>`;
    (_restoreTarget || $messages).appendChild(row);
    bubbleByKey.set(`${msgId}-${participantId}`, row);
    // v4.3.6: 如果是非 typing 初始化（restoreLog 重放）且 initialText 已完整，应用折叠
    if (!isTyping && initialText) {
      const bubble = row.querySelector(".msg-bubble");
      if (bubble) applyFoldClass(bubble, initialText, true);
    }
    if (!_restoreTarget) scrollToBottom();
    return row;
  }

  // v4.3.6: AI 长文折叠（>800 字且已完成时显示"展开全文"按钮）
  // v4.8.41: 简洁模式（ChatCompactMode.isOn() === true）下阈值改 100 + 提取中即折叠
  const FOLD_THRESHOLD = 800;
  const FOLD_THRESHOLD_COMPACT = 100;
  function applyFoldClass(bubble, text, isDone) {
    if (!bubble) return;
    // 移除旧 toggle
    bubble.querySelectorAll(".msg-fold-toggle").forEach(el => el.remove());
    const compact = window.ChatCompactMode?.isOn?.() === true;
    const threshold = compact ? FOLD_THRESHOLD_COMPACT : FOLD_THRESHOLD;
    const len = (text || "").length;
    // 简洁模式：提取中也折叠（不要求 isDone）；非简洁：仅完成后折叠
    const shouldFold = compact ? len > threshold : (isDone && len > threshold);
    if (!shouldFold) {
      bubble.classList.remove("msg-bubble-foldable", "expanded", "compact-fold");
      return;
    }
    bubble.classList.add("msg-bubble-foldable");
    if (compact) bubble.classList.add("compact-fold");
    else bubble.classList.remove("compact-fold");
    bubble.classList.remove("expanded");  // 默认折叠
    const btn = document.createElement("button");
    btn.className = "msg-fold-toggle";
    btn.dataset.act = "fold-toggle";
    btn.innerHTML = `<span class="msg-fold-icon">▾</span> 展开全文 <span class="msg-fold-count">${len} 字</span>`;
    bubble.appendChild(btn);
  }

  // v4.8.41: compact mode 切换时，对所有已渲染气泡重新评估折叠状态
  function renderStreamingText(text) {
    const safe = escapeHtml(text || "").replace(/\n/g, "<br>");
    return safe ? `<p>${safe}</p>` : `<span class="msg-typing"><span></span><span></span><span></span></span>`;
  }

  function setAIStat(stat, isDone, hasText) {
    if (!stat) return;
    if (isDone) {
      stat.className = "stat done";
      stat.innerHTML = `<span class="pip"></span>Done`;
    } else if (hasText) {
      stat.className = "stat streaming";
      stat.innerHTML = `<span class="pip"></span>Streaming`;
    }
  }

  function appendRichPill(bubble, participantId, richTypes) {
    if (!bubble || !richTypes?.length) return;
    const pill = document.createElement("a");
    pill.className = "msg-rich-pill";
    pill.dataset.participantId = participantId;
    pill.innerHTML = `View ${richTypes.join("/")} in ${NAME[participantId] || participantId}`;
    pill.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.runtime.sendMessage({ type: "chatJumpToOrigin", participantId });
    });
    bubble.appendChild(pill);
  }

  function renderAIBubbleContent(row, bubble, participantId, text, isDone, hasRichContent, richTypes, renderMarkdownNow) {
    if (!bubble) return;
    bubble.innerHTML = text
      ? (renderMarkdownNow ? renderMarkdown(text) : renderStreamingText(text))
      : `<span class="msg-typing"><span></span><span></span><span></span></span>`;
    if (text) applyFoldClass(bubble, text, isDone);
    const stat = row?.querySelector(".msg-meta .stat");
    setAIStat(stat, isDone, !!text);
    if (isDone && hasRichContent && richTypes?.length) appendRichPill(bubble, participantId, richTypes);
    scrollToBottom();
  }

  function clearStreamRenderTimer(key) {
    const state = streamRenderState.get(key);
    if (state?.timer) clearTimeout(state.timer);
    streamRenderState.delete(key);
  }
  document.addEventListener("compact:changed", () => {
    document.querySelectorAll(".msg.ai").forEach(row => {
      const bubble = row.querySelector(".msg-bubble");
      if (!bubble) return;
      const stat = row.querySelector(".msg-meta .stat");
      const isDone = !!stat?.classList?.contains("done");
      const text = bubble.innerText || bubble.textContent || "";
      applyFoldClass(bubble, text, isDone);
    });
  });

  function updateAIBubble(msgId, participantId, text, isDone, hasRichContent, richTypes) {
    const key = `${msgId}-${participantId}`;
    const row = bubbleByKey.get(key);
    if (!row) return appendAIBubble(msgId, participantId, text, !text);
    const bubble = row.querySelector(".msg-bubble");
    const stat = row.querySelector(".msg-meta .stat");
    if (!bubble) return;
    if (!isDone && text) {
      let state = streamRenderState.get(key);
      if (!state) state = {};
      state.row = row;
      state.bubble = bubble;
      state.participantId = participantId;
      state.text = text;
      if (!state.timer) {
        // v5.0.20 PERF-2: 长文本流式降频（220→600ms），短文本保持原响应速度
        const deferMs = text.length > STREAM_RENDER_LONG_CHARS ? STREAM_RENDER_DEBOUNCE_LONG_MS : STREAM_RENDER_DEBOUNCE_MS;
        state.timer = setTimeout(() => {
          const latest = streamRenderState.get(key);
          if (!latest) return;
          latest.timer = null;
          streamRenderState.delete(key);
          renderAIBubbleContent(latest.row, latest.bubble, latest.participantId, latest.text, false, false, [], false);
        }, deferMs);
      }
      streamRenderState.set(key, state);
      setAIStat(stat, false, true);
      return;
    }
    clearStreamRenderTimer(key);
    renderAIBubbleContent(row, bubble, participantId, text, isDone, hasRichContent, richTypes, true);
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // v5.0.23 F: 登录警告气泡尾部追加「🔑 去登录页」按钮（isDone 渲染完成后 append，不会被流式重绘冲掉）
  function attachLoginAction(msgId, participantId, pid) {
    const row = bubbleByKey.get(`${msgId}-${participantId}`);
    const bubble = row?.querySelector(".msg-bubble");
    if (!bubble || bubble.querySelector(".bubble-login-btn")) return;
    const btn = document.createElement("button");
    btn.className = "bubble-login-btn";
    btn.textContent = "🔑 去登录页";
    btn.title = "打开该 AI 的网页去登录，登录后会自动就绪";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      try { chrome.runtime.sendMessage({ type: "activateParticipantTab", id: pid }, () => { void chrome.runtime.lastError; }); } catch (_) {}
    });
    bubble.appendChild(btn);
  }

  // ── 智能 auto-follow 滚动 ──
  // 用户贴底时自动跟随新消息；用户向上滚浏览历史时停止跟随，回到接近底部时恢复
  const FOLLOW_THRESHOLD_PX = 80;  // 距底 < 80px 视为"贴底"
  let autoFollow = true;
  $messages?.addEventListener("scroll", () => {
    const distFromBottom = $messages.scrollHeight - $messages.scrollTop - $messages.clientHeight;
    autoFollow = distFromBottom < FOLLOW_THRESHOLD_PX;
  });

  function scrollToBottom(force = false) {
    if (force || autoFollow) {
      $messages.scrollTop = $messages.scrollHeight;
    }
  }
  function scrollToBottomForce() { scrollToBottom(true); }

  // 暴露给 history 侧栏：点击跳转条目时临时停 follow（避免流式更新打断阅读）
  window.ChatScroll = {
    pauseFollow: () => { autoFollow = false; },
    resumeFollow: () => { autoFollow = true; scrollToBottomForce(); },
    isFollowing: () => autoFollow,
  };

  // ── @mention 自动补全 ──
  // v4.3.4: 只列已加入的参与者，不再列全部 9 个 AI
  let joinedServices = [];  // 由 stateUpdate 同步
  function refreshJoinedFromState() {
    chrome.runtime.sendMessage({ type: "getState" }, (state) => {
      const set = new Set();
      (state?.participants || []).forEach(p => set.add(p.service));
      joinedServices = [...set];
    });
  }
  refreshJoinedFromState();
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "stateUpdate") refreshJoinedFromState();
  });
  function currentMentionCandidates() {
    return joinedServices.map(id => ({ id, name: NAME[id] || id }));
  }

  let mentionActive = false;
  let mentionStart = -1;

  function detectMentionTrigger() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (range.startContainer.nodeType !== 3) return null;
    const text = range.startContainer.textContent.slice(0, range.startOffset);
    const m = text.match(/@(\w*)$/);
    return m ? { query: m[1], offset: m.index } : null;
  }

  function showMentionMenu(query) {
    const q = query.toLowerCase();
    const candidates = currentMentionCandidates();
    if (!candidates.length) return hideMentionMenu();
    const list = q
      ? candidates.filter(c => c.id.startsWith(q) || c.name.toLowerCase().startsWith(q))
      : candidates;
    if (!list.length) return hideMentionMenu();
    $mentionMenu.innerHTML = list.map((c, i) => `
      <div class="mention-item ${i === 0 ? 'active' : ''}" data-id="${c.id}">
        <img class="mention-logo" src="${BRAND_SVG[c.id] || ''}" alt="${c.id}">
        <span class="mention-name">${c.name}</span>
      </div>
    `).join("");
    $mentionMenu.hidden = false;
    mentionActive = true;
    // v4.8.30: mini 模式下也撑高窗口让菜单可见
    notifyMiniExpand(true);
    $mentionMenu.querySelectorAll(".mention-item").forEach(el => {
      el.addEventListener("click", () => selectMention(el.dataset.id));
    });
  }

  function hideMentionMenu() {
    if (!$mentionMenu.hidden) notifyMiniExpand(false);
    $mentionMenu.hidden = true;
    mentionActive = false;
  }

  // v4.8.30: 通用 mini 撑高 helper（task-menu / mention-menu 共用）
  function isMini() { return document.body.getAttribute("data-mode") === "mini"; }
  function notifyMiniExpand(expand) {
    if (!isMini()) return;
    try {
      chrome.runtime.sendMessage({ type: "miniMenuExpand", expand }, () => void chrome.runtime.lastError);
    } catch (_) {}
  }

  function selectMention(id) {
    const text = $input.innerText;
    const replaced = text.replace(/@(\w*)$/, `@${NAME[id]} `);
    $input.innerText = replaced;
    // 光标移到末尾
    const range = document.createRange();
    range.selectNodeContents($input);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    hideMentionMenu();
    $input.focus();
  }

  $input.addEventListener("input", () => {
    const trigger = detectMentionTrigger();
    if (trigger) showMentionMenu(trigger.query);
    else hideMentionMenu();
  });

  // ── 输入 + 发送 ──
  function parseMentions(text) {
    const targets = [];
    let cleanText = text;
    const nameToId = Object.entries(NAME).reduce((acc, [id, name]) => {
      acc[name.toLowerCase()] = id;
      acc[id] = id;
      return acc;
    }, {});
    const re = /^@(\S+)\s+/;
    while (re.test(cleanText)) {
      const match = cleanText.match(re);
      const key = match[1].toLowerCase();
      const id = nameToId[key];
      if (!id) break;
      targets.push(id);
      cleanText = cleanText.replace(re, "");
    }
    return { targets, text: cleanText };
  }

  // v5.2.10: 共用失败提示 — chatBroadcast / dispatch 返回 ok=false 时统一记 ChatLog + alert
  //   intercepted（守门员 / debate insufficient modal / 取消）= 已处理路径，跳过避免重复
  function _showSendError(resp) {
    if (!resp || resp.ok || resp.intercepted || resp.cancelled) return false;
    const err = resp.error || "未知原因";
    try { window.ChatLog?.push?.({ ts: Date.now(), text: `❌ 发送失败：${err}`, level: "error" }); } catch (_) {}
    return true;
  }

  async function handleSend() {
    const raw = $input.innerText.trim();
    const { targets: mentionTargets, text } = parseMentions(raw);
    const targets = mentionTargets.length
      ? mentionTargets
      : (window.ChatRoster?.getSelected() || []);
    $input.innerText = "";

    // 任务模式分发：非 ask 走 ChatTaskMenu.dispatch
    const menu = window.ChatTaskMenu;
    if (menu && menu.current().task !== "ask") {
      // v5.2.10: dispatch 内部对各任务（debate/summary/ppt）已 alert，
      //   但 ChatLog 这边也记一条便于事后回看 — _showSendError 跳过 intercepted/cancelled
      const resp = await menu.dispatch(text, targets);
      _showSendError(resp);
      return;
    }

    if (!text) return;
    const msg = { type: "chatBroadcast", text, targets, images: [] };
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) console.warn(chrome.runtime.lastError);
      // v4.9.0-hotfix: 守门员命中 → bridge 接管弹 modal + 重发（之前漏了这条 ask 直发路径）
      if (window.ChatGatekeeperBridge?.handleResp(msg, resp, { textField: "text" })) return;
      // v5.2.10 fix: chatBroadcast ok=false（如"无可用参与者"）UI 必须有提示
      //   之前静默 fail 用户感知"按了没反应"。alert 强提示 + ChatLog 红字日志
      if (_showSendError(resp)) {
        const err = resp.error || "未知原因";
        if (window.ChatModal) {
          const noAI = /参与者|无可用|没有.*AI|至少|添加/.test(err);
          window.ChatModal.alert("发送失败：" + err, {
            tone: "warning", title: "发送失败",
            tip: noAI
              ? "右侧「成员」面板还没有可用的 AI —— 点 🟢 标记的 AI logo 加入（至少 1 个）。点「知道了」带你去。"
              : "请确认对应 AI 标签页已打开并登录后重试。",
            onOk: noAI ? function () { try { window.ChatRightPanel && window.ChatRightPanel.activate("members"); } catch (_) {} if (window.ChatModal.spotGuide) window.ChatModal.spotGuide(".rp-add-grid"); } : null,
          });
        } else { alert("发送失败：" + err); }
      }
    });
  }

  $send.addEventListener("click", handleSend);
  $input.addEventListener("keydown", (e) => {
    if (mentionActive) {
      const active = $mentionMenu.querySelector(".mention-item.active");
      if (e.key === "Enter" || e.key === "Tab") {
        if (active) {
          e.preventDefault();
          selectMention(active.dataset.id);
          return;
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        hideMentionMenu();
        return;
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = [...$mentionMenu.querySelectorAll(".mention-item")];
        const idx = items.indexOf(active);
        const next = e.key === "ArrowDown" ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
        items.forEach(el => el.classList.remove("active"));
        items[next].classList.add("active");
        return;
      }
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  });
  // v5.0.0-beta: 清空群聊 改用 ChatModal 替代原生 confirm（视觉一致）
  function doClearChat() {
    chrome.runtime.sendMessage({ type: "chatClear" }, () => {
      $messages.innerHTML = "";
      $messages.appendChild($empty);
      $empty.style.display = "";
      bubbleByKey.clear();
      window.ChatHistory?.clear();
    });
  }
  $clear.addEventListener("click", () => {
    if (!window.ChatModal) { if (confirm("清空群聊（不影响 AI 原页对话）？")) doClearChat(); return; }
    window.ChatModal.show({
      tone: "info",
      icon: "🧹",
      title: "清空群聊？",
      message: "仅清群聊窗口和左侧历史记录，不影响 AI 网页上原本的对话",
      primary: { label: "清空", onClick: doClearChat },
      cancel: { label: "取消" },
    });
  });

  // v5.0.6: 检查更新按钮已迁到设置 tab（popup-settings.js #rp-check-update），顶栏不再持有

  // ── 顶部彻底初始化按钮 ⚡ ──
  // v5.0.0-beta: 彻底重置 改用 ChatModal 替代原生 confirm
  function doHardReset() {
    chrome.runtime.sendMessage({ type: "hardReset" }, () => {
      $messages.innerHTML = "";
      $messages.appendChild($empty);
      $empty.style.display = "";
      bubbleByKey.clear();
      window.ChatHistory?.clear();
      window.ChatMembers?.refresh?.();
      window.ChatStats?.refresh?.();
    });
  }
  document.getElementById("btn-hard-reset")?.addEventListener("click", () => {
    if (!window.ChatModal) { if (confirm("彻底重置？所有 AI + 群聊 + 辩论上下文 都会清零")) doHardReset(); return; }
    window.ChatModal.show({
      tone: "warning",
      icon: "⚡",
      title: "彻底重置？",
      message: "将一次性清除：移除所有 AI 参与者 · 清空群聊窗口 · 清辩论轮次和总结上下文",
      tip: "AI 网页上的原对话保留。插件这边的状态归零，不可恢复。",
      primary: { label: "确认彻底重置", onClick: doHardReset },
      cancel: { label: "取消" },
    });
  });

  // ── 接收 background 推送 ──
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "chatStreamUpdate") {
      const { msgId, role, participantId, text, isDone, hasRichContent, richTypes } = msg;
      if (role === "user") appendUserMessage(text, msgId);
      else {
        updateAIBubble(msgId, participantId, text, isDone, hasRichContent, richTypes);
        // v5.0.23 F: 未登录警告气泡内嵌可点按钮 — 萌新读得懂"去登录"但不知道页面在哪
        if (msg.loginWarning && msg.loginPid) attachLoginAction(msgId, participantId, msg.loginPid);
      }
    } else if (msg.type === "stateUpdate") {
      // v5.0.20 UX-1: 跟踪 participants[0] = 队长（与 background captain-mode isCaptain 同逻辑）
      if (msg.participants) _setCaptainInfo(msg.participants);
    } else if (msg.type === "chatLogPayload") {
      restoreLog(msg.messages);
    } else if (msg.type === "debateSummaryReady") {
      // v4.4.0: 裁判输出的 HTML 总结
      appendDebateSummaryCard(msg.html, msg.meta, msg.downloadId);
    }
  });

  // v4.4.0: 辩论总结 HTML 卡片
  function appendDebateSummaryCard(html, meta, downloadId) {
    ensureEmptyHidden();
    const row = document.createElement("div");
    row.className = "msg ai msg-summary";
    // v4.8.17: 用裁判的卡牌 logo 替代 📋 绿色方块；标题加裁判名
    const judgeSvc = meta?.judgeService;
    const judgeName = meta?.judgeName ? `·${meta.judgeName}` : "";
    const avatarClass = judgeSvc ? `msg-avatar ${AVATAR_CLASS[judgeSvc] || ""}` : "msg-avatar";
    const avatarInner = judgeSvc ? brandLogoHtml(judgeSvc) : "📋";
    const avatarStyle = judgeSvc ? "" : `style="background:#0a5e3a;color:#fff;font-weight:700"`;
    row.innerHTML = `
      <div class="${avatarClass}" ${avatarStyle}>${avatarInner}</div>
      <div class="msg-body">
        <div class="msg-meta">
          <span class="name">辩论总结${escapeHtml(judgeName)}</span>
          <span class="time">${escapeHtml(meta?.date || "")}</span>
          <span class="stat done"><span class="pip"></span>已生成</span>
          <span class="acts">
            <button data-act="summary-open" title="在新标签页打开">↗</button>
            ${downloadId != null ? `<button data-act="summary-redownload" data-did="${downloadId}" title="再次下载">⬇</button>` : ""}
          </span>
        </div>
        <div class="msg-bubble summary-bubble">
          <div class="summary-pitch">
            <strong>${escapeHtml(meta?.topic || "辩论总结")}</strong>
            <span class="summary-pitch-meta">${escapeHtml(meta?.participants?.join(" · ") || "")} · ${escapeHtml(meta?.rounds || 0)} 轮</span>
          </div>
          <!-- v4.8.66: iframe 默认展开，不再需要二次点击切换 -->
          <iframe class="summary-iframe" sandbox="allow-same-origin" srcdoc="${escapeAttr(html)}"></iframe>
        </div>
      </div>`;
    $messages.appendChild(row);
    // 保存 HTML 引用供 open 按钮使用
    row._summaryHtml = html;
    scrollToBottom();
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function restoreLog(messages) {
    if (!messages?.length) return;
    ensureEmptyHidden();
    // v5.0.34 perf: 批量 append 到 fragment 再一次性插入 + 仅滚动一次（100+ 条从 5-10s 降到 1-2s）
    const frag = document.createDocumentFragment();
    _restoreTarget = frag;
    try {
      for (const m of messages) {
        if (m.role === "user") appendUserMessage(m.text, m.msgId);
        else appendAIBubble(m.msgId, m.participantId, m.text, false);
      }
    } finally { _restoreTarget = null; }
    $messages.appendChild(frag);
    scrollToBottomForce();
  }

  // v4.8.15: 切换 logo 风格时，在线更新已渲染气泡的头像 src（不重排消息）
  document.addEventListener("logo-style-changed", () => {
    const imgs = document.querySelectorAll(".msg-avatar img.brand-logo[data-svc]");
    imgs.forEach(img => {
      const svc = img.dataset.svc;
      const next = window.ArenaLogoStyle?.heroPath(svc);
      if (next && next !== img.getAttribute("src")) img.setAttribute("src", next);
    });
  });

  // ── 启动 ──
  chrome.runtime.sendMessage({ type: "chatRestoreLog" }, (resp) => {
    if (resp?.messages?.length) restoreLog(resp.messages);
  });
})();
