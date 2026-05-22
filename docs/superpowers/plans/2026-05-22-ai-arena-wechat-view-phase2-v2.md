# AI Arena WeChat Group Chat View — Phase 2 v2 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. 旧 plan `phase2.md` 已被推翻（sidepanel 减肥方向作废），本 plan v2 为最终版。

**Goal**: 把 popup 升级成独立完整工具：左下角参与者多选 + 输入框左侧任务模式选择器（同时提问/辩论/总结/PPT，hover 子菜单）+ 气泡紧凑 meta 行（名字/时间/状态/actions 一行）+ 真品牌 logo + 微动效美化。**sidepanel 全保留**——两个入口 mirror 同一组 background handler。

**Architecture**: 复用 background.js 现有 handler（broadcast / debateRound / summary / sendPromptToService / exportSession / hardReset / checkAllCompletion）。PPT 三个 prompt 构造函数（`buildPptCopyPrompt` / `buildHuaweiImagePrompt` / `buildPptxPrompt`）从 sidepanel.js 抽到独立 `src/ppt-prompts.js`，两边共用。popup 端用新模块管 roster/task-menu/bubble-actions，但 popup.js 仍是主入口。

**Spec**: `docs/superpowers/specs/2026-05-22-ai-arena-wechat-view-design.md`
**Baseline**: tag `v4.0.0-alpha` (`982742f`) + plan v2 commit (本 plan)

## File Structure

### 新建
- `src/icons/brands/huawei.svg` — 红色花瓣占位
- `src/ppt-prompts.js` — 从 sidepanel.js 抽出的 PPT prompt 构造函数（buildPptCopyPrompt / buildHuaweiImagePrompt / buildPptxPrompt），挂 window
- `src/popup-roster.js` — 左下参与者多选 + 持久化
- `src/popup-task-menu.js` — 任务模式选择器（4 主项 + hover 子菜单）+ 任务分发
- `src/popup-bubble-actions.js` — 气泡 actions（🔄重提/📤重发/📋复制/↗跳原页）
- `src/test/popup-roster.test.mjs`
- `src/test/popup-task-menu.test.mjs`

### 修改
- `src/popup.html` — header live dot + footer roster + task-picker + 引入新 js
- `src/popup.css` — meta 一行 + roster + task-picker + 子菜单 + 微动效 + light 镜像
- `src/popup.js` — 改 appendAIBubble 用紧凑 meta + actions 集成 + 头像换 SVG logo
- `src/sidepanel.html` — 加载共享 `ppt-prompts.js`（在 sidepanel.js 之前）
- `src/sidepanel.js` — 删除内部 buildPpt* 函数（已迁出）+ 修复 auto-extract bug（T8）

---

## Task v2-T1: huawei.svg + brand SVG 头像

**Files:** Create `src/icons/brands/huawei.svg`; Modify `src/popup.js` AVATAR_INITIAL 替换为 SVG 引用; Modify `src/popup.css` 头像图片样式.

- [ ] **T1.1 创建 `src/icons/brands/huawei.svg`**:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <circle cx="16" cy="16" r="15" fill="#E60012"/>
  <text x="16" y="20" text-anchor="middle" fill="#fff" font-size="11" font-weight="900" font-family="Arial,sans-serif">HW</text>
</svg>
```

- [ ] **T1.2 改 `src/popup.js`** — 在 IIFE 顶部，**替换** AVATAR_INITIAL 常量为 BRAND_SVG（不删除 AVATAR_INITIAL，作为 fallback）：

```javascript
  const BRAND_SVG = {
    huawei: "icons/brands/huawei.svg",  // 用户头像
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
  function brandLogoHtml(id) {
    const src = BRAND_SVG[id];
    if (!src) return `<span class="msg-avatar-fallback">${AVATAR_INITIAL[id] || "?"}</span>`;
    return `<img src="${src}" alt="${id}" class="brand-logo">`;
  }
```

- [ ] **T1.3 改 `src/popup.js`** — `appendUserMessage` 和 `appendAIBubble` 内 `<div class="msg-avatar ${avatarClass}">${initial}</div>` 替换为 `<div class="msg-avatar ${avatarClass}">${brandLogoHtml(participantId)}</div>`。用户气泡用 `brandLogoHtml('huawei')`。

- [ ] **T1.4 改 `src/popup.css`** — 追加：

```css
.msg-avatar { background: #fff !important; padding: 4px; }
.msg-avatar .brand-logo { width: 24px; height: 24px; object-fit: contain; }
.msg-avatar-fallback { color: var(--ink); font-weight: 600; font-size: 12px; }
@media (prefers-color-scheme: dark) {
  .msg-avatar { background: rgba(255,255,255,0.95) !important; }
}
```

- [ ] **T1.5** `npm test` 仍 22/22。

- [ ] **T1.6 commit**: `feat(popup): brand SVG avatars + huawei logo for user`

---

## Task v2-T2: 紧凑 meta 行（名字/时间/状态/actions 一行）

**Files:** Modify `src/popup.js` (appendUserMessage/appendAIBubble/updateAIBubble); Modify `src/popup.css`.

- [ ] **T2.1 改 `src/popup.js` `appendUserMessage`**:

```javascript
  function appendUserMessage(text, msgId) {
    ensureEmptyHidden();
    const ts = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    const row = document.createElement("div");
    row.className = "msg me";
    row.dataset.msgId = msgId;
    row.innerHTML = `
      <div class="msg-body">
        <div class="msg-meta me-meta">
          <span class="acts"><button data-act="copy" title="复制">📋</button></span>
          <span class="stat done"><span class="pip"></span>已发送</span>
          <span class="time">${escapeHtml(ts)}</span>
          <span class="name">我 · Huawei</span>
        </div>
        <div class="msg-bubble">${escapeHtml(text)}</div>
      </div>
      <div class="msg-avatar huawei">${brandLogoHtml('huawei')}</div>`;
    $messages.appendChild(row);
    scrollToBottom();
  }
```

- [ ] **T2.2 改 `appendAIBubble`**:

```javascript
  function appendAIBubble(msgId, participantId, initialText = "", isTyping = true) {
    ensureEmptyHidden();
    const ts = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    const row = document.createElement("div");
    row.className = "msg ai";
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
          <span class="time">${escapeHtml(ts)}</span>
          <span class="stat ${statClass}"><span class="pip"></span>${statText}</span>
          <span class="acts">
            <button data-act="reextract" title="重新提取">🔄</button>
            <button data-act="resend" title="重新发送">📤</button>
            <button data-act="copy" title="复制">📋</button>
            <button data-act="jump" title="跳原页">↗</button>
          </span>
        </div>
        <div class="msg-bubble">${isTyping ? `<span class="msg-typing"><span></span><span></span><span></span></span>` : renderMarkdown(initialText)}</div>
      </div>`;
    $messages.appendChild(row);
    bubbleByKey.set(`${msgId}-${participantId}`, row);
    scrollToBottom();
    return row;
  }
```

- [ ] **T2.3 改 `updateAIBubble`** — 找到现有函数末尾的 isDone 处理，把状态切换写到 meta 里。**完整替换函数**：

```javascript
  function updateAIBubble(msgId, participantId, text, isDone, hasRichContent, richTypes) {
    const row = bubbleByKey.get(`${msgId}-${participantId}`);
    if (!row) return appendAIBubble(msgId, participantId, text, !text);
    const bubble = row.querySelector(".msg-bubble");
    const stat = row.querySelector(".msg-meta .stat");
    if (!bubble) return;
    bubble.innerHTML = text ? renderMarkdown(text) : `<span class="msg-typing"><span></span><span></span><span></span></span>`;
    if (stat) {
      if (isDone) {
        stat.className = "stat done";
        stat.innerHTML = `<span class="pip"></span>已完成`;
      } else if (text) {
        stat.className = "stat streaming";
        stat.innerHTML = `<span class="pip"></span>提取中`;
      }
    }
    if (isDone && hasRichContent && richTypes?.length) {
      // 富文本 pill 加在 bubble 下方（保留原行为）
      const pill = document.createElement("a");
      pill.className = "msg-rich-pill";
      pill.dataset.participantId = participantId;
      pill.innerHTML = `📦 含 ${richTypes.join("/")} ↗ 在 ${NAME[participantId]} 查看`;
      pill.addEventListener("click", (e) => {
        e.preventDefault();
        chrome.runtime.sendMessage({ type: "chatJumpToOrigin", participantId });
      });
      bubble.appendChild(pill);
    }
    scrollToBottom();
  }
```

- [ ] **T2.4 改 `src/popup.css`** — 追加 meta 行样式 + 重写气泡布局：

```css
.msg-meta {
  display: flex; align-items: center; gap: 8px;
  padding: 0 4px 3px;
  font-size: 10.5px; color: var(--ink-soft);
  height: 18px;
}
.msg-meta .name { color: var(--ink); font-weight: 600; font-size: 11.5px; }
.msg-meta .time { font-family: "SF Mono","JetBrains Mono",Consolas,monospace; font-size: 10px; color: var(--ink-soft); }
.msg-meta .stat { display: flex; align-items: center; gap: 3px; font-size: 10px; }
.msg-meta .stat .pip { width: 6px; height: 6px; border-radius: 50%; }
.msg-meta .stat.done .pip { background: #34c759; }
.msg-meta .stat.done { color: #34c759; }
.msg-meta .stat.streaming .pip { background: #ff9f0a; animation: pulse-stream 1.2s ease-in-out infinite; }
.msg-meta .stat.streaming { color: #ff9f0a; }
.msg-meta .stat.failed .pip { background: #ff3b30; }
.msg-meta .stat.failed { color: #ff3b30; }
@keyframes pulse-stream {
  0%,100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.4); opacity: 0.5; }
}
.msg-meta .acts { margin-left: auto; display: flex; gap: 1px; opacity: 0; transition: opacity 0.15s; }
.msg:hover .msg-meta .acts { opacity: 1; }
.msg-meta .acts button {
  background: transparent; border: none;
  color: var(--ink-soft); cursor: pointer;
  padding: 1px 5px; border-radius: 4px;
  font-size: 10.5px;
  transition: all 0.12s;
}
.msg-meta .acts button:hover { background: rgba(0,0,0,0.05); color: var(--ink); }
@media (prefers-color-scheme: dark) {
  .msg-meta .acts button:hover { background: rgba(255,255,255,0.08); color: var(--ink); }
}
.me-meta { flex-direction: row-reverse; }
.me-meta .acts { margin-left: 0; margin-right: auto; }
```

- [ ] **T2.5** `npm test`; commit: `feat(popup): compact meta row (name/time/status/actions on one line)`

---

## Task v2-T3: 气泡 actions 行为 + popup-bubble-actions.js

**Files:** Create `src/popup-bubble-actions.js`; Modify `src/popup.html` (引入); Modify `src/chat-bus.js` (加 reextractOne handler).

- [ ] **T3.1 改 `src/chat-bus.js`** — 在 IIFE 内部加新方法 `reextractOne(participantId)`：先 chrome.tabs.sendMessage 读取一次最新 readResponse，回推到 popup。

```javascript
  async function reextractOne(participantId) {
    const p = (StateMachine.participants || []).find(x => x.service === participantId);
    if (!p || !p.tabId) return { ok: false, error: "未找到参与者" };
    try {
      const r = await chrome.tabs.sendMessage(p.tabId, { action: "readResponse" });
      const text = (r?.text || "").trim();
      // 用一个 ad-hoc msgId 推到 popup（不挂到任何对话）
      const msgId = `manual_${Date.now()}`;
      sendToPopup({
        type: "chatStreamUpdate", role: "ai", msgId,
        participantId, text, isDone: true,
        hasRichContent: !!r?.hasRichContent, richTypes: r?.richTypes || [],
      });
      return { ok: true, text };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
```

并在 IIFE 末尾的 `return { ... }` 加入 `reextractOne`。

- [ ] **T3.2 改 `src/background.js`** — 在 switch case 加：

```javascript
        case "chatReextractOne":
          sendResponse(await ChatBus.reextractOne(msg.participantId)); break;
```

- [ ] **T3.3 创建 `src/popup-bubble-actions.js`**:

```javascript
// AI Arena — popup 气泡 actions
(function () {
  document.getElementById("chat-messages")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const row = btn.closest(".msg");
    if (!row) return;
    const participantId = row.dataset.participantId;
    const act = btn.dataset.act;
    const bubble = row.querySelector(".msg-bubble");
    const text = bubble?.innerText?.trim() || "";

    if (act === "copy") {
      try { await navigator.clipboard.writeText(text); btn.textContent = "✓"; setTimeout(() => btn.textContent = "📋", 1000); } catch {}
    } else if (act === "jump") {
      chrome.runtime.sendMessage({ type: "chatJumpToOrigin", participantId });
    } else if (act === "reextract") {
      if (!participantId) return;
      btn.disabled = true; btn.textContent = "⏳";
      chrome.runtime.sendMessage({ type: "chatReextractOne", participantId }, () => {
        btn.disabled = false; btn.textContent = "🔄";
      });
    } else if (act === "resend") {
      // 重发：找上一条用户消息文本，sendPromptToService(participantId)
      const userRow = [...document.querySelectorAll(".msg.me")].pop();
      const userText = userRow?.querySelector(".msg-bubble")?.innerText?.trim();
      if (!userText) { alert("找不到要重发的用户消息"); return; }
      btn.disabled = true; btn.textContent = "⏳";
      chrome.runtime.sendMessage({ type: "sendPromptToService", service: participantId, text: userText }, () => {
        btn.disabled = false; btn.textContent = "📤";
      });
    }
  });
})();
```

- [ ] **T3.4 改 `src/popup.html`** — 在 `<script src="popup.js"></script>` 之前加 `<script src="popup-bubble-actions.js"></script>`.

- [ ] **T3.5** commit: `feat(popup): bubble actions (copy/jump/reextract/resend)`

---

## Task v2-T4: 左下参与者多选 roster

**Files:** Create `src/popup-roster.js`; Modify `src/popup.html` (加 roster div); Modify `src/popup.css`; Modify `src/chat-bus.js` (broadcast 按 roster filter).

- [ ] **T4.1 改 `src/popup.html`** — 在 `<footer class="chat-input-bar">` **之前**插入：

```html
<div class="chat-roster" id="chat-roster">
  <span class="roster-label">下轮发言</span>
  <div class="roster-items" id="roster-items"></div>
  <span class="roster-count" id="roster-count">0 / 0</span>
</div>
```

并在 `<script src="popup.js"></script>` 之前加 `<script src="popup-roster.js"></script>`.

- [ ] **T4.2 改 `src/popup.css`** 末尾追加：

```css
.chat-roster {
  display: flex; gap: 8px; align-items: center;
  padding: 9px 16px; background: var(--card);
  border-top: 1px solid var(--border);
}
.roster-label { color: var(--ink-soft); font-size: 10.5px; }
.roster-items { display: flex; gap: 8px; align-items: center; }
.roster-item {
  width: 28px; height: 28px; border-radius: 7px;
  cursor: pointer; background: #fff;
  display: flex; align-items: center; justify-content: center;
  position: relative;
  transition: all 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
  padding: 3px;
}
.roster-item img { width: 100%; height: 100%; object-fit: contain; }
.roster-item.selected { box-shadow: 0 0 0 2px var(--accent), 0 4px 10px rgba(10,132,255,0.35); transform: translateY(-1px); }
.roster-item.unselected { opacity: 0.32; filter: grayscale(0.7); }
.roster-item:hover { transform: translateY(-2px); }
.roster-item .check {
  position: absolute; right: -4px; top: -4px;
  width: 13px; height: 13px;
  background: var(--accent); border-radius: 50%;
  color: #fff; font-size: 8px;
  display: flex; align-items: center; justify-content: center;
  border: 2px solid var(--card);
  font-weight: 700;
}
.roster-count { margin-left: auto; color: var(--ink-soft); font-size: 10.5px; font-family: "SF Mono",monospace; }
```

- [ ] **T4.3 创建 `src/popup-roster.js`**:

```javascript
// AI Arena — popup 左下参与者多选
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
  let selected = new Set();  // 选中的 service id

  async function refresh() {
    chrome.runtime.sendMessage({ type: "getState" }, (state) => {
      if (!state?.participants) return;
      participants = state.participants;
      // 默认全选
      const known = new Set(participants.map(p => p.service));
      // 从 storage 读上次选择
      chrome.storage.local.get("rosterSelected", (data) => {
        if (Array.isArray(data.rosterSelected)) {
          selected = new Set(data.rosterSelected.filter(s => known.has(s)));
        }
        if (selected.size === 0) selected = new Set(known);
        render();
      });
    });
  }

  function render() {
    $items.innerHTML = participants.map(p => {
      const sel = selected.has(p.service);
      const src = BRAND_SVG[p.service] || "icons/brands/claude.svg";
      return `<div class="roster-item ${sel ? "selected" : "unselected"}" data-service="${p.service}" title="${p.name}">
        <img src="${src}" alt="${p.service}">
        ${sel ? '<span class="check">✓</span>' : ''}
      </div>`;
    }).join("");
    $count.textContent = `${selected.size} / ${participants.length}`;
    chrome.storage.local.set({ rosterSelected: [...selected] });
    document.dispatchEvent(new CustomEvent("roster:changed", { detail: { selected: [...selected] } }));
  }

  $items.addEventListener("click", (e) => {
    const item = e.target.closest(".roster-item");
    if (!item) return;
    const svc = item.dataset.service;
    if (selected.has(svc)) selected.delete(svc);
    else selected.add(svc);
    if (selected.size === 0) selected = new Set(participants.map(p => p.service));  // 不允许全空
    render();
  });

  // 启动 + 监听 state 变化
  refresh();
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "stateUpdate") refresh();
  });

  // 暴露 API
  window.ChatRoster = { getSelected: () => [...selected], refresh };
})();
```

- [ ] **T4.4 改 `src/popup.js`** — `handleSend` 函数里 broadcast 的 targets 改为 `window.ChatRoster?.getSelected() || []`（当无 @mention 时）。完整改写 `handleSend`：

```javascript
  async function handleSend() {
    const raw = $input.innerText.trim();
    if (!raw) return;
    const { targets: mentionTargets, text } = parseMentions(raw);
    let targets = mentionTargets;
    if (!targets.length) {
      // 无 @mention，用 roster 选中的
      targets = window.ChatRoster?.getSelected() || [];
    }
    $input.innerText = "";
    chrome.runtime.sendMessage({ type: "chatBroadcast", text, targets, images: [] }, (resp) => {
      if (chrome.runtime.lastError) console.warn(chrome.runtime.lastError);
    });
  }
```

- [ ] **T4.5 改 `src/chat-bus.js`** — 现有的 `broadcast` 函数已支持 `targets` 过滤，无需改。

- [ ] **T4.6** commit: `feat(popup): bottom-left roster (multi-select for next turn)`

---

## Task v2-T5: 任务模式选择器（核心）

**Files:** Create `src/popup-task-menu.js`; Modify `src/popup.html` (task-picker + submenu DOM); Modify `src/popup.css`.

- [ ] **T5.1 改 `src/popup.html`** — 把现有的 `<footer class="chat-input-bar">` 整段替换为：

```html
<footer class="chat-input-bar">
  <div class="task-picker-wrap">
    <button class="task-picker" id="task-picker-btn">
      <span class="icon">⚙️</span>
      <span class="picker-label">任务</span>
      <span class="picked" id="task-picked-pill">同时提问</span>
      <span class="caret">▾</span>
    </button>
    <div class="task-menu" id="task-menu" hidden>
      <div class="menu-item" data-task="ask"><span class="em">💬</span><span>同时提问</span><span class="check-mark">●</span></div>
      <div class="menu-item has-sub" data-task="debate"><span class="em">⚔️</span><span>辩论</span><span class="caret">▸</span>
        <div class="sub-menu">
          <div class="menu-item" data-task="debate" data-style="free">⚔️ 自由辩论</div>
          <div class="menu-item" data-task="debate" data-style="collab">🤝 群策群力</div>
        </div>
      </div>
      <div class="menu-item has-sub" data-task="summary"><span class="em">📋</span><span>裁判总结</span><span class="caret">▸</span>
        <div class="sub-menu" id="summary-judge-list"></div>
      </div>
      <div class="menu-item has-sub" data-task="ppt"><span class="em">📊</span><span>PPT 制作</span><span class="caret">▸</span>
        <div class="sub-menu">
          <div class="menu-item" data-task="ppt" data-kind="copy">📝 文案生成</div>
          <div class="menu-item" data-task="ppt" data-kind="image">🎨 图片生成</div>
          <div class="menu-item" data-task="ppt" data-kind="pptx">📊 PPT 生成</div>
        </div>
      </div>
    </div>
  </div>
  <div class="chat-input-wrap">
    <div id="chat-input" class="chat-input" contenteditable="true"
         data-placeholder="输入消息…  Ctrl+Enter 发送  @ 单发"></div>
    <div class="mention-menu" id="mention-menu" hidden></div>
  </div>
  <button class="btn-send" id="btn-send" title="发送 (Ctrl+Enter)">↑</button>
</footer>
```

并在 `<script src="popup.js">` 之前加 `<script src="popup-task-menu.js"></script>` 和 `<script src="ppt-prompts.js"></script>`（T6 创建）.

- [ ] **T5.2 改 `src/popup.css`** 末尾追加：

```css
.task-picker-wrap { position: relative; }
.task-picker {
  background: var(--bg); color: var(--ink);
  border: 1px solid var(--border); border-radius: 8px;
  padding: 7px 11px; cursor: pointer;
  font-size: 11px; display: flex; align-items: center; gap: 5px;
  transition: all 0.15s;
}
.task-picker:hover { background: rgba(0,0,0,0.04); }
@media (prefers-color-scheme: dark) {
  .task-picker:hover { background: rgba(255,255,255,0.06); }
}
.task-picker .icon { font-size: 13px; }
.task-picker .picked {
  background: var(--accent); color: #fff;
  padding: 2px 6px; border-radius: 4px; font-size: 9.5px;
  margin-left: 2px;
}
.task-picker .caret { color: var(--ink-soft); font-size: 9px; }
.task-menu {
  position: absolute; bottom: calc(100% + 6px); left: 0;
  background: var(--card); border: 1px solid var(--border);
  border-radius: 10px; padding: 6px; min-width: 180px;
  box-shadow: 0 12px 32px rgba(0,0,0,0.18);
  z-index: 20;
}
.menu-item {
  padding: 7px 10px; color: var(--ink); font-size: 12px;
  border-radius: 6px; display: flex; align-items: center; gap: 8px;
  cursor: pointer; position: relative;
}
.menu-item:hover { background: var(--bg); }
.menu-item.active { background: rgba(10,132,255,0.15); color: var(--accent); }
.menu-item .em { font-size: 14px; }
.menu-item .check-mark { margin-left: auto; color: var(--accent); }
.menu-item.has-sub .caret { margin-left: auto; color: var(--ink-soft); font-size: 9px; }
.sub-menu {
  position: absolute; left: 100%; top: -6px;
  background: var(--card); border: 1px solid var(--border);
  border-radius: 10px; padding: 6px; min-width: 150px;
  box-shadow: 0 12px 32px rgba(0,0,0,0.18);
  display: none;
}
.menu-item.has-sub:hover .sub-menu { display: block; }
```

- [ ] **T5.3 创建 `src/popup-task-menu.js`**:

```javascript
// AI Arena — popup 任务模式选择器
(function () {
  const $picker = document.getElementById("task-picker-btn");
  const $menu = document.getElementById("task-menu");
  const $pickedPill = document.getElementById("task-picked-pill");
  const $judgeList = document.getElementById("summary-judge-list");
  if (!$picker || !$menu) return;

  // 当前任务状态：{ task, style?, kind?, judgeId? }
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
  function refreshPill() { $pickedPill.textContent = labelOf(current); }

  function close() { $menu.hidden = true; }
  function open() {
    refreshJudges();
    $menu.hidden = false;
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
      if (!state?.participants) return;
      $judgeList.innerHTML = state.participants.map(p =>
        `<div class="menu-item" data-task="summary" data-judge-id="${p.id}" data-judge-name="${p.name}">⚖️ ${p.name}</div>`
      ).join("") || `<div class="menu-item" style="opacity:0.5">（先添加参与者）</div>`;
    });
  }

  $menu.addEventListener("click", (e) => {
    const item = e.target.closest(".menu-item");
    if (!item) return;
    const task = item.dataset.task;
    if (!task) return;
    e.stopPropagation();
    if (task === "ask") current = { task };
    else if (task === "debate") {
      if (!item.dataset.style) return;  // 父节点点击不选定
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
  });

  refreshPill();

  // 暴露 dispatch 给 popup.js 的发送按钮使用
  window.ChatTaskMenu = {
    current: () => ({ ...current }),
    async dispatch(text, targets) {
      const c = current;
      if (c.task === "ask") {
        return chrome.runtime.sendMessage({ type: "chatBroadcast", text, targets, images: [] });
      }
      if (c.task === "debate") {
        // text 作为 guidance（如有）+ 触发 debateRound
        const guidance = text || "";
        return chrome.runtime.sendMessage({ type: "debateRound", style: c.style, guidance, concise: false });
      }
      if (c.task === "summary") {
        return chrome.runtime.sendMessage({ type: "summary", judgeId: c.judgeId, customInstruction: text || "" });
      }
      if (c.task === "ppt") {
        // 构造 prompt 走 ppt-prompts.js 全局函数（T6 加载）
        let prompt = "";
        try {
          if (c.kind === "copy") prompt = window.buildPptCopyPrompt?.();
          else if (c.kind === "image") prompt = window.buildHuaweiImagePrompt?.("intro");  // 默认 intro template
          else if (c.kind === "pptx") prompt = window.buildPptxPrompt?.();
        } catch (e) { return { ok: false, error: "prompt 构造失败: " + e.message }; }
        if (!prompt) return { ok: false, error: "PPT prompt 构造失败（ppt-prompts.js 未加载？）" };
        return chrome.runtime.sendMessage({ type: "sendPromptToService", service: "chatgpt", text: prompt });
      }
    },
  };
})();
```

- [ ] **T5.4 改 `src/popup.js`** — `handleSend` 改为按当前 task 分发：

```javascript
  async function handleSend() {
    const raw = $input.innerText.trim();
    const { targets: mentionTargets, text } = parseMentions(raw);
    const targets = mentionTargets.length ? mentionTargets : (window.ChatRoster?.getSelected() || []);
    $input.innerText = "";

    const menu = window.ChatTaskMenu;
    if (menu && menu.current().task !== "ask") {
      // 走任务模式
      menu.dispatch(text, targets).then((resp) => {
        if (!resp?.ok) console.warn("task failed:", resp?.error);
      });
      return;
    }

    if (!text) return;
    chrome.runtime.sendMessage({ type: "chatBroadcast", text, targets, images: [] }, (resp) => {
      if (chrome.runtime.lastError) console.warn(chrome.runtime.lastError);
    });
  }
```

- [ ] **T5.5** commit: `feat(popup): task mode picker with hover submenu (debate/summary/ppt)`

---

## Task v2-T6: 抽 PPT prompt 函数到共享文件

**Files:** Create `src/ppt-prompts.js`; Modify `src/sidepanel.js` (删除 build* 函数); Modify `src/sidepanel.html` (引入 ppt-prompts.js).

- [ ] **T6.1 grep + 复制** `sidepanel.js` 中的 `buildPptCopyPrompt` / `buildHuaweiImagePrompt` / `buildPptxPrompt` 函数完整定义到新文件 `src/ppt-prompts.js`，包裹成 IIFE 挂 window：

```javascript
// AI Arena — PPT prompt 构造函数（sidepanel 和 popup 共用）
(function (global) {
  function buildPptCopyPrompt() { /* PASTE FROM sidepanel.js */ }
  function buildHuaweiImagePrompt(template) { /* PASTE FROM sidepanel.js */ }
  function buildPptxPrompt() { /* PASTE FROM sidepanel.js */ }
  global.buildPptCopyPrompt = buildPptCopyPrompt;
  global.buildHuaweiImagePrompt = buildHuaweiImagePrompt;
  global.buildPptxPrompt = buildPptxPrompt;
})(typeof window !== "undefined" ? window : globalThis);
```

> Subagent: grep `sidepanel.js` 找到这 3 个函数的实际定义（包括它们依赖的辅助函数如 collectAllResponses 等），整段拷贝。**保留 sidepanel.js 中的 wrapper 调用**（btnPptCopy.click handler 等），但 wrapper 调的是 `window.buildPptCopyPrompt`（因为函数被外提）。**实际操作**：把函数本体剪到 `ppt-prompts.js`，sidepanel.js 中的 `function buildPptCopyPrompt(...)` 行替换为 `var buildPptCopyPrompt = window.buildPptCopyPrompt;`（保持原 callers 不变）。如果有依赖函数（如 collectResponses），一并搬。

- [ ] **T6.2 改 `src/sidepanel.html`** — 在 `<script src="sidepanel.js"></script>` **之前**加 `<script src="ppt-prompts.js"></script>`.

- [ ] **T6.3 改 `src/popup.html`** — 已在 T5.1 标注要加 `<script src="ppt-prompts.js"></script>`，verify it's there.

- [ ] **T6.4** 跑 npm test，加载扩展验证 sidepanel 和 popup 的 PPT 都能用。

- [ ] **T6.5** commit: `refactor: extract PPT prompt builders to shared ppt-prompts.js`

---

## Task v2-T7: 视觉精致化（动效 + 字体 + light 镜像）

**Files:** Modify `src/popup.css`.

- [ ] **T7.1 替换/追加 `src/popup.css`** 顶部 :root 块为：

```css
:root {
  --bg: #f5f5f7;
  --card: #fff;
  --ink: #1d1d1f;
  --ink-soft: #6e6e73;
  --border: #d2d2d7;
  --accent: #0a84ff;
  --bubble-me-bg: linear-gradient(135deg, #0a84ff 0%, #007aff 100%);
  --bubble-them-bg: rgba(255,255,255,0.9);
  --code-bg: #1d1d1f;
  --code-ink: #f5f5f7;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1c1c1e;
    --card: #2c2c2e;
    --ink: #f5f5f7;
    --ink-soft: #aeaeb2;
    --border: #38383a;
    --accent: #0a84ff;
    --bubble-me-bg: linear-gradient(135deg, #0a84ff 0%, #007aff 100%);
    --bubble-them-bg: rgba(58,58,60,0.85);
  }
}
```

- [ ] **T7.2 追加** 微动效到 `src/popup.css` 末尾：

```css
.msg { animation: slide-in 0.25s ease-out; }
@keyframes slide-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
.chat-header .chat-icon { animation: pulse-live 2.4s ease-in-out infinite; }
@keyframes pulse-live { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.6; transform: scale(1.1); } }
.btn-send {
  background: var(--bubble-me-bg);
  box-shadow: 0 4px 10px rgba(10,132,255,0.35);
  transition: all 0.18s;
}
.btn-send:hover { transform: translateY(-1px) scale(1.05); box-shadow: 0 6px 14px rgba(10,132,255,0.45); }
.btn-send:active { transform: translateY(0) scale(0.98); }
.msg-bubble {
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  letter-spacing: -0.01em;
}
body { letter-spacing: -0.01em; }
```

- [ ] **T7.3** commit: `style(popup): refined micro-animations and typography`

---

## Task v2-T8: 单元测试

**Files:** Create `src/test/popup-task-menu.test.mjs`; Create `src/test/popup-roster.test.mjs`.

- [ ] **T8.1 popup-task-menu.test.mjs** — 测 labelOf 函数（纯逻辑）：

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";

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

test("labelOf: ask", () => assert.equal(labelOf({task:"ask"}), "同时提问"));
test("labelOf: debate free", () => assert.equal(labelOf({task:"debate",style:"free"}), "辩论·自由"));
test("labelOf: debate collab", () => assert.equal(labelOf({task:"debate",style:"collab"}), "辩论·群策"));
test("labelOf: summary with judge", () => assert.equal(labelOf({task:"summary",judgeName:"Claude"}), "总结·Claude"));
test("labelOf: summary no judge", () => assert.equal(labelOf({task:"summary"}), "总结·选裁判"));
test("labelOf: ppt copy", () => assert.equal(labelOf({task:"ppt",kind:"copy"}), "PPT·文案"));
test("labelOf: ppt image", () => assert.equal(labelOf({task:"ppt",kind:"image"}), "PPT·图片"));
test("labelOf: ppt pptx", () => assert.equal(labelOf({task:"ppt",kind:"pptx"}), "PPT·生成"));
```

- [ ] **T8.2 popup-roster.test.mjs** — 测 roster state machine：

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";

function makeRoster(all) {
  let selected = new Set(all);
  return {
    toggle(svc) {
      if (selected.has(svc)) selected.delete(svc);
      else selected.add(svc);
      if (selected.size === 0) selected = new Set(all);
      return [...selected];
    },
    get() { return [...selected]; },
  };
}

test("roster: 默认全选", () => {
  const r = makeRoster(["claude","gemini","chatgpt"]);
  assert.deepEqual(r.get().sort(), ["chatgpt","claude","gemini"]);
});
test("roster: toggle 去除", () => {
  const r = makeRoster(["claude","gemini","chatgpt"]);
  r.toggle("gemini");
  assert.deepEqual(r.get().sort(), ["chatgpt","claude"]);
});
test("roster: 全空时回弹全选", () => {
  const r = makeRoster(["claude","gemini"]);
  r.toggle("claude"); r.toggle("gemini");
  assert.equal(r.get().length, 2);
});
test("roster: 再 toggle 加回", () => {
  const r = makeRoster(["claude","gemini","chatgpt"]);
  r.toggle("gemini");  // ["claude","chatgpt"]
  r.toggle("gemini");  // ["claude","gemini","chatgpt"]
  assert.deepEqual(r.get().sort(), ["chatgpt","claude","gemini"]);
});
```

- [ ] **T8.3** npm test 应为 30 个（22 + 8）.

- [ ] **T8.4** commit: `test: roster + task-menu state machine unit tests`

---

## Task v2-T9: 修复 sidepanel auto-extract bug

**Files:** Modify `src/sidepanel.js` (line ~629-742 流式检测逻辑).

**Bug**: sidepanel 显示"提取失败"频繁触发，要求用户手动提取。popup 的 chat-bus polling 用"连续 3 次相同文本"判定，更稳。

**修复策略**: 不动 sidepanel 的轮询调度（保留 `startStreamingPoll` / `streamingPollTimer` 等），但简化判定逻辑——去掉对 `isStreaming`/`hasStreamedMap` 的依赖，改为：每个 participant 维护 `_sameCount`（每次 readResponse 文本与上次比较，相同 +1），≥3 即判完成。

- [ ] **T9.1** 读 `src/sidepanel.js` line 629-742 整段（startStreamingPoll + 内部 pollOnce），定位 `if (v.textLength > 0 && !lengthChanged && !v.isStreaming && hasStreamedMap[id])` 完成判定条件（约 line 685）。

- [ ] **T9.2 替换该判定**：

把：
```javascript
if (v.textLength > 0 && !lengthChanged && !v.isStreaming && hasStreamedMap[id]) {
  // 完成
}
```

替换为：
```javascript
// 简化判定：连续 N 次文本不变 + 已有内容 → 完成（不依赖 isStreaming）
if (v.textLength > 0 && !lengthChanged) {
  sameCountMap[id] = (sameCountMap[id] || 0) + 1;
} else {
  sameCountMap[id] = 0;
}
if (v.textLength > 0 && sameCountMap[id] >= 3) {
  // 完成
}
```

并在 `startStreamingPoll` 函数顶部声明 `const sameCountMap = {};`（替换或补充 `hasStreamedMap`）。

> Subagent: 这是真实 bug，逻辑替换后必须手动验证（加载扩展，sidepanel 跑一次广播，看 AI 完成时是否自动转"已完成"态而无需手动）。如不确定，BLOCKED 回报。

- [ ] **T9.3** commit: `fix(sidepanel): replace streaming-indicator detection with simple 'N stable polls' (matches chat-bus polling)`

---

## Task v2-T10: v4.0.0-beta release + build + tag + email report

**Files:** Modify `src/popup.html` (顶部 version → v4.0.0-beta); Modify `src/sidepanel.html` (footer version); Create `docs/release-notes-4.0.0-beta.html`; Build + tag.

- [ ] **T10.1** popup.html / sidepanel.html 版本字符 `v4.0.0` → `v4.0.0-beta`。manifest.json 加 `"version_name": "4.0.0-beta"`。

- [ ] **T10.2** 创建 `docs/release-notes-4.0.0-beta.html`（仿 alpha 版样式）—— 三张卡片：新增 / 体验建议 / 已知限制。新增重点：左下参与者多选 / 任务模式选择器 / 紧凑 meta 行 / 品牌 logo / 微动效 / sidepanel auto-extract bug 修复。

- [ ] **T10.3** `npm run build`，生成 v4.0.0 zip。

- [ ] **T10.4** commit `release(v4.0.0-beta): popup task picker + roster + bubble actions + auto-extract fix`，tag `v4.0.0-beta`.

- [ ] **T10.5** 发邮件到 lintian3@huawei.com（zip 附件 + 简短英文 body，避免 spam 过滤）。复用 `.superpowers/send-zip-only.py`，更新 ZIP_PATH 即可。

---

## 自审清单

- ✅ popup 任务按钮全部 mirror 现有 sidepanel handler（broadcast / debateRound / summary / sendPromptToService / exportSession / hardReset）
- ✅ PPT 三个 prompt builder 抽到共享文件，两边一致
- ✅ 左下 roster 默认全选 + 持久化 + 全空回弹保护
- ✅ 气泡 meta 一行（名字/时间/状态/actions）
- ✅ 真品牌 logo（含华为）
- ✅ 微动效（slide-in/pulse-live/pulse-stream/弹性 roster）+ light 镜像
- ✅ sidepanel 不删 panel，全部保留
- ✅ sidepanel auto-extract bug 修复（T9，独立）
- ✅ 单元测试覆盖 labelOf 8 个 + roster 4 个 = 12 个新测试

## 不在范围

- 历史回填 → v1.1
- Mermaid / Artifact 内嵌渲染 → v3+
- 跨设备群聊同步 → v3+
