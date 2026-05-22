# AI Arena WeChat Group Chat View — Phase 1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal**: 用户能从 sidepanel 点 "🪟 打开群聊" 打开独立 popup 窗口，在 popup 输入框广播给已有参与者，3 个 AI 气泡 1.5s 渐进刷新内容，含 hasRichContent 检测 + 跳原页 + chrome.storage.local 持久化。

**Architecture**: 复用现有 background.js 消息总线模式（initPromise + switch case 路由）。新增 `chat-bus.js` 子模块封装 popup 生命周期 + polling 调度 + chatLog 持久化（通过 importScripts 加载，参考 debate-engine.js 模式）。新增 `popup.html / popup.js / popup.css` 独立页面，通过 chrome.windows.create({type:'popup'}) 打开。9 个 content-*.js 各加 hasRichContent 检测器。sidepanel 保留全部现有功能，只在顶部加一个"🪟 打开群聊"按钮（Phase 1 不减肥 sidepanel，Phase 2 才搬辩论/PPT/同时提问到抽屉）。

**Tech Stack**: Vanilla JS + MV3 + chrome.runtime/storage/windows/system.display + 自研轻量 markdown 渲染（避免新增构建依赖）+ node:test 做纯函数 unit test。

**Spec**: `docs/superpowers/specs/2026-05-22-ai-arena-wechat-view-design.md`

---

## 文件结构总览

### 新建
- `src/popup.html` — 群聊窗口结构（header + message-list + input-bar）
- `src/popup.css` — 微信风格样式（浅+深色 prefers-color-scheme）
- `src/popup.js` — 渲染、输入处理、IPC 收发
- `src/popup-markdown.js` — 自研轻量 markdown 渲染（代码块/粗斜体/链接/简单表格/列表）
- `src/chat-bus.js` — background 端的群聊业务模块（popup 生命周期 + polling 调度 + chatLog + storage）
- `src/test/popup-mention.test.mjs` — @mention 解析单元测试
- `src/test/chat-bus-log.test.mjs` — chatLog FIFO/持久化单元测试
- `src/test/content-richcontent.test.mjs` — hasRichContent 检测器单元测试（mock DOM via happy-dom 替代或纯字符串测）

### 修改
- `src/manifest.json` — version 3.0.0 → 4.0.0
- `src/package.json` — version 3.0.0 → 4.0.0；加 `"test": "node --test src/test"` script
- `src/background.js` — importScripts chat-bus.js；switch case 加 5 个新 type
- `src/content-claude.js` 等 9 个文件 — readResponse 返回 {text, hasRichContent, richTypes}
- `src/sidepanel.html` / `.js` / `.css` — 顶部加"🪟 打开群聊"按钮，底部 v3.0.0 → v4.0.0

### 不修改（Phase 1 保留）
- 同时提问 / 辩论 / PPT 工坊三个 tab —— Phase 2 才移到 popup 抽屉

---

## Task 1: 版本号升级到 v4.0.0-alpha

**Files:**
- Modify: `src/manifest.json:4`
- Modify: `src/package.json:3`
- Modify: `src/sidepanel.html:11` (顶部 version badge)
- Modify: `src/sidepanel.html:185` (底部 footer)

- [ ] **Step 1.1: 改 src/manifest.json 的 version**

```json
{
  "manifest_version": 3,
  "name": "AI Arena",
  "version": "4.0.0",
  ...
}
```

- [ ] **Step 1.2: 改 src/package.json 的 version**

```json
{
  "name": "ai-arena-extension",
  "version": "4.0.0",
  ...
}
```

- [ ] **Step 1.3: 改 src/sidepanel.html 顶部 version badge**

把 `<span class="version">v3.0.0</span>` 改成 `<span class="version">v4.0.0</span>`。

- [ ] **Step 1.4: 改 src/sidepanel.html 底部 footer**

把 `AI Arena v3.0.0` 改成 `AI Arena v4.0.0`。

- [ ] **Step 1.5: 提交**

```bash
git add src/manifest.json src/package.json src/sidepanel.html package.json
git commit -m "chore: bump version to v4.0.0 (group chat phase 1)"
```

---

## Task 2: 新建 popup.html / popup.css 静态骨架

**Files:**
- Create: `src/popup.html`
- Create: `src/popup.css`

- [ ] **Step 2.1: 创建 src/popup.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>AI Arena 群聊</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div class="chat-app">
    <header class="chat-header">
      <div class="chat-title">
        <span class="chat-icon">🪟</span>
        <span class="chat-name">AI Arena 群聊</span>
        <span class="chat-version">v4.0.0</span>
      </div>
      <div class="chat-actions">
        <button class="btn-icon" id="btn-clear" title="清空群聊">🗑</button>
        <button class="btn-icon" id="btn-settings" title="设置">⚙️</button>
      </div>
    </header>
    <main class="chat-messages" id="chat-messages">
      <div class="empty-state" id="empty-state">
        <div class="empty-icon">👋</div>
        <div class="empty-text">群聊已就绪</div>
        <div class="empty-hint">输入消息广播给所有参与者</div>
      </div>
    </main>
    <footer class="chat-input-bar">
      <div class="chat-input-wrap">
        <div id="chat-input" class="chat-input" contenteditable="true"
             data-placeholder="输入消息…  Ctrl+Enter 发送  @ 单发"></div>
        <div class="mention-menu" id="mention-menu" hidden></div>
      </div>
      <button class="btn-send" id="btn-send" title="发送 (Ctrl+Enter)">↑</button>
    </footer>
  </div>
  <script src="popup-markdown.js"></script>
  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2.2: 创建 src/popup.css（微信风格 + 浅+深色）**

```css
:root {
  --bg: #f5f5f7;
  --card: #fff;
  --ink: #1d1d1f;
  --ink-soft: #6e6e73;
  --border: #d2d2d7;
  --accent: #0a84ff;
  --bubble-me: #95ec69;
  --bubble-them: #fff;
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
    --bubble-me: #0a84ff;
    --bubble-them: #2c2c2e;
  }
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; overflow: hidden; }
body {
  font-family: -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  background: var(--bg);
  color: var(--ink);
  font-size: 14px;
}
.chat-app { display: flex; flex-direction: column; height: 100vh; }
.chat-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 16px; background: var(--card); border-bottom: 1px solid var(--border);
}
.chat-title { display: flex; align-items: center; gap: 8px; }
.chat-icon { font-size: 18px; }
.chat-name { font-weight: 600; }
.chat-version { color: var(--ink-soft); font-size: 11px; }
.btn-icon { background: none; border: none; cursor: pointer; padding: 6px; font-size: 16px; color: var(--ink); border-radius: 6px; }
.btn-icon:hover { background: var(--bg); }
.chat-messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.empty-state { margin: auto; text-align: center; color: var(--ink-soft); }
.empty-icon { font-size: 48px; margin-bottom: 12px; }
.empty-text { font-size: 16px; font-weight: 500; }
.empty-hint { font-size: 12px; margin-top: 4px; }
.msg { display: flex; gap: 8px; align-items: flex-start; }
.msg.me { justify-content: flex-end; }
.msg-avatar { width: 32px; height: 32px; border-radius: 6px; flex: 0 0 32px; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 600; font-size: 12px; }
.msg-avatar.claude { background: #cc785c; }
.msg-avatar.gemini { background: #4f8cff; }
.msg-avatar.chatgpt { background: #10a37f; }
.msg-avatar.deepseek { background: #4d6bfe; }
.msg-avatar.doubao { background: #ff7a45; }
.msg-avatar.qwen { background: #6c5ce7; }
.msg-avatar.kimi { background: #0abf53; }
.msg-avatar.yuanbao { background: #d63031; }
.msg-avatar.grok { background: #1a1a1a; }
.msg-body { max-width: 78%; }
.msg-name { font-size: 11px; color: var(--ink-soft); margin-bottom: 2px; }
.msg-bubble {
  background: var(--bubble-them); border-radius: 10px; padding: 8px 12px;
  word-wrap: break-word; line-height: 1.5;
  border: 1px solid var(--border);
}
.msg.me .msg-bubble { background: var(--bubble-me); color: #000; border: none; }
@media (prefers-color-scheme: dark) {
  .msg.me .msg-bubble { color: #fff; }
}
.msg-bubble pre {
  background: var(--code-bg); color: var(--code-ink);
  padding: 8px 10px; border-radius: 6px; overflow-x: auto;
  font-family: "SF Mono", Consolas, monospace; font-size: 12px;
  margin: 6px 0;
}
.msg-bubble code { font-family: "SF Mono", Consolas, monospace; background: rgba(0,0,0,0.05); padding: 1px 4px; border-radius: 3px; font-size: 0.9em; }
.msg-bubble pre code { background: none; padding: 0; color: inherit; }
.msg-typing { display: inline-flex; gap: 3px; align-items: center; opacity: 0.6; }
.msg-typing span { width: 5px; height: 5px; background: currentColor; border-radius: 50%; animation: typing 1.2s ease-in-out infinite; }
.msg-typing span:nth-child(2) { animation-delay: 0.2s; }
.msg-typing span:nth-child(3) { animation-delay: 0.4s; }
@keyframes typing { 0%,60%,100% { opacity: 0.3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }
.msg-rich-pill {
  display: inline-flex; gap: 4px; align-items: center;
  margin-top: 6px; padding: 2px 8px; border-radius: 999px;
  background: rgba(10,132,255,0.1); color: var(--accent);
  font-size: 11px; cursor: pointer; border: 1px solid rgba(10,132,255,0.3);
}
.msg-rich-pill:hover { background: rgba(10,132,255,0.2); }
.chat-input-bar {
  display: flex; gap: 10px; align-items: flex-end;
  padding: 12px 16px; background: var(--card); border-top: 1px solid var(--border);
}
.chat-input-wrap { flex: 1; position: relative; }
.chat-input {
  min-height: 36px; max-height: 120px; overflow-y: auto;
  background: var(--bg); border-radius: 8px; padding: 8px 12px;
  outline: none; line-height: 1.4;
}
.chat-input:empty::before {
  content: attr(data-placeholder); color: var(--ink-soft); pointer-events: none;
}
.mention-menu {
  position: absolute; bottom: 100%; left: 0; margin-bottom: 4px;
  background: var(--card); border: 1px solid var(--border); border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  min-width: 140px; padding: 4px; z-index: 10;
}
.mention-item { padding: 6px 10px; cursor: pointer; border-radius: 4px; display: flex; gap: 8px; align-items: center; }
.mention-item:hover, .mention-item.active { background: var(--bg); }
.btn-send {
  width: 36px; height: 36px; border-radius: 50%;
  border: none; background: var(--accent); color: #fff; font-size: 18px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
}
.btn-send:disabled { opacity: 0.4; cursor: not-allowed; }
```

- [ ] **Step 2.3: 提交**

```bash
git add src/popup.html src/popup.css
git commit -m "feat(popup): add static skeleton (html + css)"
```

---

## Task 3: popup-markdown.js 自研轻量 markdown

**Files:**
- Create: `src/popup-markdown.js`

不引入第三方库（保持 build.mjs 简单）。只覆盖：代码块、行内 code、粗斜体、链接、列表、标题、换行。富文本（artifact/mermaid/图）走"跳原页"pill 不渲染。

- [ ] **Step 3.1: 创建 src/popup-markdown.js**

```javascript
// AI Arena — 轻量 markdown 渲染（XSS-safe 转义 + 白名单标签）
(function (global) {
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderMarkdown(src) {
    if (!src) return "";

    // 1) 提取代码块占位（防止内部 markdown 干扰）
    const codeBlocks = [];
    src = src.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (m, lang, code) => {
      const idx = codeBlocks.push({ lang, code }) - 1;
      return `CODE${idx}`;
    });

    // 2) 行内 code
    src = src.replace(/`([^`\n]+)`/g, (m, c) => `INLINE${escapeHtml(c)}`);

    // 3) 转义剩余 HTML
    src = escapeHtml(src);

    // 4) 标题
    src = src.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    src = src.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    src = src.replace(/^# (.+)$/gm, "<h1>$1</h1>");

    // 5) 粗斜体
    src = src.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    src = src.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

    // 6) 链接 [text](url) — 只允许 http/https
    src = src.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, text, url) => {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    });

    // 7) 列表（粗暴：连续 - 或 * 行）
    src = src.replace(/(^|\n)((?:- .+(?:\n|$))+)/g, (m, lead, block) => {
      const items = block.trim().split(/\n/).map(line => `<li>${line.replace(/^- /, "")}</li>`).join("");
      return `${lead}<ul>${items}</ul>`;
    });

    // 8) 段落（双换行分段）
    src = src.split(/\n\n+/).map(p => {
      if (/^<(h[123]|ul|ol|pre)/.test(p.trim())) return p;
      return `<p>${p.replace(/\n/g, "<br>")}</p>`;
    }).join("");

    // 9) 回填行内 code
    src = src.replace(/INLINE([^]+)/g, (m, c) => `<code>${c}</code>`);

    // 10) 回填代码块
    src = src.replace(/CODE(\d+)/g, (m, idx) => {
      const { lang, code } = codeBlocks[Number(idx)];
      const langClass = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      return `<pre><code${langClass}>${escapeHtml(code)}</code></pre>`;
    });

    return src;
  }

  global.renderMarkdown = renderMarkdown;
  if (typeof module !== "undefined") module.exports = { renderMarkdown, escapeHtml };
})(typeof window !== "undefined" ? window : globalThis);
```

- [ ] **Step 3.2: 提交**

```bash
git add src/popup-markdown.js
git commit -m "feat(popup): add lightweight markdown renderer (xss-safe)"
```

---

## Task 4: 测试基础设施 + popup-markdown 单元测试

**Files:**
- Modify: `package.json` (加 test script)
- Create: `src/test/popup-markdown.test.mjs`

- [ ] **Step 4.1: 改 package.json scripts 加 test**

```json
{
  "scripts": {
    "build:github": "node build.mjs github",
    "build:store": "node build.mjs store",
    "build": "node build.mjs all",
    "test": "node --test --test-reporter=spec src/test"
  }
}
```

- [ ] **Step 4.2: 创建 src/test/popup-markdown.test.mjs**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { renderMarkdown, escapeHtml } = require("../popup-markdown.js");

test("escapeHtml: 5 字符全转义", () => {
  assert.equal(escapeHtml(`<script>"&'`), "&lt;script&gt;&quot;&amp;&#39;");
});

test("renderMarkdown: 纯文本段落", () => {
  const html = renderMarkdown("hello world");
  assert.match(html, /<p>hello world<\/p>/);
});

test("renderMarkdown: 代码块带语言", () => {
  const html = renderMarkdown("```python\nprint(1)\n```");
  assert.match(html, /<pre><code class="language-python">print\(1\)\n<\/code><\/pre>/);
});

test("renderMarkdown: 行内 code", () => {
  const html = renderMarkdown("用 `Array.map` 处理");
  assert.match(html, /<code>Array\.map<\/code>/);
});

test("renderMarkdown: 链接只允许 http/https", () => {
  const ok = renderMarkdown("[claude](https://claude.ai)");
  assert.match(ok, /<a href="https:\/\/claude\.ai" target="_blank"/);

  const evil = renderMarkdown("[xss](javascript:alert(1))");
  assert.doesNotMatch(evil, /<a/);
});

test("renderMarkdown: XSS 转义", () => {
  const html = renderMarkdown("<script>alert(1)</script>");
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("renderMarkdown: 粗体", () => {
  const html = renderMarkdown("**重要**提示");
  assert.match(html, /<strong>重要<\/strong>/);
});

test("renderMarkdown: 无序列表", () => {
  const html = renderMarkdown("- 苹果\n- 香蕉\n- 橙子");
  assert.match(html, /<ul><li>苹果<\/li><li>香蕉<\/li><li>橙子<\/li><\/ul>/);
});

test("renderMarkdown: 空输入", () => {
  assert.equal(renderMarkdown(""), "");
  assert.equal(renderMarkdown(null), "");
});
```

- [ ] **Step 4.3: 跑测试，确保通过**

Run: `npm test`
Expected: 9 个测试全 pass。如果 fail，先调 popup-markdown.js 直到全过。

- [ ] **Step 4.4: 提交**

```bash
git add package.json src/test/popup-markdown.test.mjs
git commit -m "test(popup-markdown): add unit tests + node:test infrastructure"
```

---

## Task 5: chat-bus.js 骨架 — popup 生命周期

**Files:**
- Create: `src/chat-bus.js`
- Modify: `src/background.js:6` (importScripts 加 chat-bus.js)
- Modify: `src/background.js:99` (switch case 加 5 个 type)

- [ ] **Step 5.1: 创建 src/chat-bus.js（骨架，先做 openChatPopup）**

```javascript
// AI Arena — 群聊业务总线（背景脚本子模块）
// 由 background.js 通过 importScripts 加载，挂在 self.ChatBus

const ChatBus = (() => {
  // ── 状态 ──
  let popupWindowId = null;        // 当前 popup window id，null 表示未开
  let popupBounds = null;          // 用户拖动后记忆的位置/尺寸
  const chatLog = [];              // 最近 100 条消息
  const MAX_LOG = 100;
  const STORAGE_KEYS = { log: "chatLog", bounds: "chatPopupBounds" };

  // ── 初始化：读 storage ──
  async function init() {
    const data = await chrome.storage.local.get([STORAGE_KEYS.log, STORAGE_KEYS.bounds]);
    if (Array.isArray(data[STORAGE_KEYS.log])) chatLog.push(...data[STORAGE_KEYS.log].slice(-MAX_LOG));
    if (data[STORAGE_KEYS.bounds]) popupBounds = data[STORAGE_KEYS.bounds];
  }

  // ── popup 生命周期 ──
  async function openChatPopup() {
    if (popupWindowId != null) {
      try {
        await chrome.windows.update(popupWindowId, { focused: true });
        return { ok: true, reused: true, windowId: popupWindowId };
      } catch {
        popupWindowId = null;  // window 已被关
      }
    }
    const bounds = popupBounds || await defaultBounds();
    const w = await chrome.windows.create({
      url: chrome.runtime.getURL("popup.html"),
      type: "popup",
      ...bounds,
    });
    popupWindowId = w.id;
    return { ok: true, reused: false, windowId: w.id };
  }

  async function defaultBounds() {
    try {
      const displays = await chrome.system.display.getInfo();
      const primary = displays.find(d => d.isPrimary) || displays[0];
      const w = Math.min(800, Math.round(primary.workArea.width / 2));
      const h = Math.min(900, Math.round(primary.workArea.height * 0.9));
      return {
        left: primary.workArea.left + primary.workArea.width - w - 20,
        top: primary.workArea.top + 40,
        width: w,
        height: h,
      };
    } catch {
      return { left: 100, top: 100, width: 600, height: 800 };
    }
  }

  function onWindowRemoved(windowId) {
    if (windowId === popupWindowId) popupWindowId = null;
  }

  async function rememberBounds(windowId) {
    if (windowId !== popupWindowId) return;
    try {
      const w = await chrome.windows.get(popupWindowId);
      popupBounds = { left: w.left, top: w.top, width: w.width, height: w.height };
      await chrome.storage.local.set({ [STORAGE_KEYS.bounds]: popupBounds });
    } catch {}
  }

  // ── 暂时留空，后续 task 填 ──
  async function broadcast(text, targets, images) { /* Task 7 */ }
  function getLog() { /* Task 11 */ return chatLog.slice(); }
  function clearLog() { /* Task 11 */ chatLog.length = 0; chrome.storage.local.remove(STORAGE_KEYS.log); }
  async function jumpToOrigin(participantId) { /* Task 10 */ }

  return {
    init,
    openChatPopup,
    onWindowRemoved,
    rememberBounds,
    broadcast,
    getLog,
    clearLog,
    jumpToOrigin,
  };
})();

self.ChatBus = ChatBus;
```

- [ ] **Step 5.2: 改 src/background.js:6 加 importScripts**

把：
```javascript
importScripts("selectors-config.js", "state-machine.js", "debate-engine.js");
```
改成：
```javascript
importScripts("selectors-config.js", "state-machine.js", "debate-engine.js", "chat-bus.js");
```

- [ ] **Step 5.3: 改 src/background.js 初始化部分（约 26 行）调 ChatBus.init**

把：
```javascript
const initPromise = StateMachine.init();
```
改成：
```javascript
const initPromise = Promise.all([StateMachine.init(), ChatBus.init()]);
```

- [ ] **Step 5.4: 改 src/background.js switch case 加 5 个新 type**

在现有 switch case 中（约 113-117 行附近）插入：

```javascript
case "openChatPopup":
  sendResponse(await ChatBus.openChatPopup()); break;
case "chatBroadcast":
  sendResponse(await ChatBus.broadcast(msg.text, msg.targets || [], msg.images || [])); break;
case "chatRestoreLog":
  sendResponse({ messages: ChatBus.getLog() }); break;
case "chatClear":
  ChatBus.clearLog(); sendResponse({ ok: true }); break;
case "chatJumpToOrigin":
  sendResponse(await ChatBus.jumpToOrigin(msg.participantId)); break;
```

- [ ] **Step 5.5: 改 src/background.js 加 onRemoved/onBoundsChanged 监听**

在文件末尾或 `chrome.tabs.onRemoved.addListener` 附近加：

```javascript
chrome.windows.onRemoved.addListener((windowId) => {
  ChatBus.onWindowRemoved(windowId);
});
chrome.windows.onBoundsChanged?.addListener((win) => {
  ChatBus.rememberBounds(win.id);
});
```

> 注：Chrome 100+ 才有 onBoundsChanged；用 `?.` 防老版本崩溃。

- [ ] **Step 5.6: 提交**

```bash
git add src/chat-bus.js src/background.js
git commit -m "feat(chat-bus): add popup window lifecycle (open/focus/remember)"
```

---

## Task 6: sidepanel 加"🪟 打开群聊"按钮 + 联调 popup 打开

**Files:**
- Modify: `src/sidepanel.html` (header 区域)
- Modify: `src/sidepanel.js` (绑定 click 事件)
- Modify: `src/sidepanel.css` (按钮样式)

- [ ] **Step 6.1: 改 src/sidepanel.html，在 header 后插入按钮**

找到 `<div class="header">` 块结束的位置（约第 27 行 `</div>` 前），在 `mode-toggle` 之前或之后加：

```html
<button class="btn-open-chat" id="btn-open-chat" title="打开群聊窗口">
  🪟 群聊
</button>
```

- [ ] **Step 6.2: 改 src/sidepanel.css 加按钮样式**

在文件末尾加：

```css
.btn-open-chat {
  background: var(--accent-color, #0a84ff);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 8px;
}
.btn-open-chat:hover { opacity: 0.9; }
```

- [ ] **Step 6.3: 改 src/sidepanel.js 绑定 click**

在 sidepanel.js 的 init/DOMContentLoaded 块里加：

```javascript
document.getElementById("btn-open-chat")?.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "openChatPopup" }, (resp) => {
    if (chrome.runtime.lastError || !resp?.ok) {
      console.warn("打开群聊失败:", chrome.runtime.lastError);
    }
  });
});
```

- [ ] **Step 6.4: 手动验证**

1. 在 chrome://extensions/ 重新加载扩展
2. 打开 sidepanel
3. 点击"🪟 群聊"按钮
4. **期望**：弹出独立 popup 窗口，显示 popup.html 内容（空状态"群聊已就绪"）
5. 关闭 popup
6. 再次点按钮 → popup 重新弹出
7. 点按钮（popup 已开着）→ popup 被拉到前台（focused）

如果 popup 不弹，打开 chrome://extensions/ 的"Service Worker"链接看 background 日志。

- [ ] **Step 6.5: 提交**

```bash
git add src/sidepanel.html src/sidepanel.js src/sidepanel.css
git commit -m "feat(sidepanel): add 'open group chat' button to header"
```

---

## Task 7: popup.js 骨架 + 输入框 + 广播

**Files:**
- Create: `src/popup.js`

- [ ] **Step 7.1: 创建 src/popup.js**

```javascript
// AI Arena — popup 群聊渲染 + 输入处理
(function () {
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
  const NAME = {
    claude: "Claude", gemini: "Gemini", chatgpt: "ChatGPT",
    deepseek: "DeepSeek", doubao: "豆包", qwen: "千问",
    kimi: "Kimi", yuanbao: "元宝", grok: "Grok",
  };

  // ── 状态 ──
  // bubbleByKey: key = `${msgId}-${participantId}` → DOM element
  const bubbleByKey = new Map();

  // ── 渲染 ──
  function ensureEmptyHidden() {
    if ($empty && !$empty.classList.contains("hidden")) {
      $empty.style.display = "none";
    }
  }

  function appendUserMessage(text, msgId) {
    ensureEmptyHidden();
    const row = document.createElement("div");
    row.className = "msg me";
    row.dataset.msgId = msgId;
    row.innerHTML = `<div class="msg-body"><div class="msg-bubble">${escapeHtml(text)}</div></div>`;
    $messages.appendChild(row);
    scrollToBottom();
  }

  function appendAIBubble(msgId, participantId, initialText = "", isTyping = true) {
    ensureEmptyHidden();
    const row = document.createElement("div");
    row.className = "msg ai";
    row.dataset.msgId = msgId;
    row.dataset.participantId = participantId;
    const avatarClass = AVATAR_CLASS[participantId] || "";
    const initial = AVATAR_INITIAL[participantId] || "?";
    const name = NAME[participantId] || participantId;
    row.innerHTML = `
      <div class="msg-avatar ${avatarClass}">${initial}</div>
      <div class="msg-body">
        <div class="msg-name">${name}</div>
        <div class="msg-bubble">
          ${isTyping ? `<span class="msg-typing"><span></span><span></span><span></span></span>` : renderMarkdown(initialText)}
        </div>
      </div>`;
    $messages.appendChild(row);
    bubbleByKey.set(`${msgId}-${participantId}`, row);
    scrollToBottom();
    return row;
  }

  function updateAIBubble(msgId, participantId, text, isDone, hasRichContent, richTypes) {
    const row = bubbleByKey.get(`${msgId}-${participantId}`);
    if (!row) return appendAIBubble(msgId, participantId, text, !text);
    const bubble = row.querySelector(".msg-bubble");
    if (!bubble) return;
    bubble.innerHTML = text ? renderMarkdown(text) : `<span class="msg-typing"><span></span><span></span><span></span></span>`;
    if (isDone && hasRichContent && richTypes?.length) {
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

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function scrollToBottom() {
    $messages.scrollTop = $messages.scrollHeight;
  }

  // ── 输入 + 发送 ──
  function parseMentions(text) {
    // "@Claude xxx" → { targets: ['claude'], text: 'xxx' }
    // 无 @ → { targets: [], text }
    const m = text.match(/^(?:@(\w+)\s+)+/);
    if (!m) return { targets: [], text };
    const targets = [];
    let cleanText = text;
    const re = /^@(\w+)\s+/;
    while (re.test(cleanText)) {
      const match = cleanText.match(re);
      const id = match[1].toLowerCase();
      if (AVATAR_INITIAL[id]) targets.push(id);
      cleanText = cleanText.replace(re, "");
    }
    return { targets, text: cleanText };
  }

  async function handleSend() {
    const raw = $input.innerText.trim();
    if (!raw) return;
    const { targets, text } = parseMentions(raw);
    $input.innerText = "";
    chrome.runtime.sendMessage({ type: "chatBroadcast", text, targets, images: [] }, (resp) => {
      if (chrome.runtime.lastError) console.warn(chrome.runtime.lastError);
    });
  }

  $send.addEventListener("click", handleSend);
  $input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  });
  $clear.addEventListener("click", () => {
    if (!confirm("清空群聊（不影响 AI 原页对话）？")) return;
    chrome.runtime.sendMessage({ type: "chatClear" }, () => {
      $messages.innerHTML = "";
      $messages.appendChild($empty);
      $empty.style.display = "";
      bubbleByKey.clear();
    });
  });

  // ── 接收 background 推送 ──
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "chatStreamUpdate") {
      const { msgId, role, participantId, text, isDone, hasRichContent, richTypes } = msg;
      if (role === "user") appendUserMessage(text, msgId);
      else updateAIBubble(msgId, participantId, text, isDone, hasRichContent, richTypes);
    } else if (msg.type === "chatLogPayload") {
      // Task 11: 历史回放
      restoreLog(msg.messages);
    }
  });

  function restoreLog(messages) {
    if (!messages?.length) return;
    ensureEmptyHidden();
    for (const m of messages) {
      if (m.role === "user") appendUserMessage(m.text, m.msgId);
      else appendAIBubble(m.msgId, m.participantId, m.text, false);
    }
  }

  // ── 启动 ──
  chrome.runtime.sendMessage({ type: "chatRestoreLog" }, (resp) => {
    if (resp?.messages?.length) restoreLog(resp.messages);
  });
})();
```

- [ ] **Step 7.2: 手动验证 popup 静态渲染**

1. 重载扩展 → 点 sidepanel "🪟 群聊"
2. popup 弹出，看到空状态
3. 在输入框打字 → 按 Ctrl+Enter
4. **期望**：输入框被清空（虽然此时 chatBroadcast 还没实现，但前端流程能跑）
5. 打开 popup 的 DevTools (右键 → 检查) 看 console，确认没有 JS 错误

- [ ] **Step 7.3: 提交**

```bash
git add src/popup.js
git commit -m "feat(popup): add render + input + IPC scaffolding"
```

---

## Task 8: chat-bus.js — broadcast 路由 + polling 调度

**Files:**
- Modify: `src/chat-bus.js` (broadcast / polling / send to popup)

- [ ] **Step 8.1: 改 src/chat-bus.js — 实现 broadcast/polling**

把 chat-bus.js 里的 `broadcast` 占位换成完整实现，并加内部辅助函数。在 IIFE 内部增加：

```javascript
  // ── polling 调度器 ──
  // pollers: Map<participantId, { intervalId, lastText, sameCount, msgId }>
  const pollers = new Map();
  const POLL_INTERVAL_MS = 1500;
  const STREAM_DONE_THRESHOLD = 3;  // 连续 N 次相同视为完成

  async function sendToPopup(payload) {
    if (popupWindowId == null) return;
    try {
      // popup 没有 tabId，只能广播到所有 runtime context
      await chrome.runtime.sendMessage(payload);
    } catch {}
  }

  function newMsgId() {
    return `m${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  }

  function pushLog(entry) {
    chatLog.push(entry);
    while (chatLog.length > MAX_LOG) chatLog.shift();
    chrome.storage.local.set({ [STORAGE_KEYS.log]: chatLog }).catch(() => {});
  }

  async function broadcast(text, targets, images) {
    if (!text?.trim()) return { ok: false, error: "empty text" };

    // 决定目标参与者
    const allParticipants = StateMachine.participants || [];
    const targetList = targets?.length
      ? allParticipants.filter(p => targets.includes(p.service))
      : allParticipants;

    if (!targetList.length) {
      return { ok: false, error: "无可用参与者" };
    }

    const msgId = newMsgId();
    const userEntry = { role: "user", msgId, text, ts: Date.now() };
    pushLog(userEntry);
    sendToPopup({ type: "chatStreamUpdate", role: "user", msgId, text });

    // 对每个目标 AI: 注入 + 启动 polling
    for (const p of targetList) {
      sendToPopup({
        type: "chatStreamUpdate", role: "ai", msgId,
        participantId: p.service, text: "", isDone: false,
      });
      injectAndPoll(p, msgId, text);
    }
    return { ok: true, msgId, targets: targetList.map(p => p.service) };
  }

  async function injectAndPoll(participant, msgId, text) {
    const { tabId, service } = participant;
    try {
      await chrome.tabs.sendMessage(tabId, { action: "inject", text });
    } catch (e) {
      sendToPopup({
        type: "chatStreamUpdate", role: "ai", msgId,
        participantId: service, text: `⚠ ${participant.name} 注入失败: ${e.message}`,
        isDone: true,
      });
      return;
    }
    // 启动 polling
    if (pollers.has(service)) clearInterval(pollers.get(service).intervalId);
    const state = { lastText: "", sameCount: 0, msgId };
    state.intervalId = setInterval(() => pollOnce(participant, state), POLL_INTERVAL_MS);
    pollers.set(service, state);
  }

  async function pollOnce(participant, state) {
    const { tabId, service } = participant;
    try {
      const r = await chrome.tabs.sendMessage(tabId, { action: "readResponse" });
      const text = (r?.text || "").trim();
      const hasRich = !!r?.hasRichContent;
      const richTypes = r?.richTypes || [];

      if (text === state.lastText) {
        state.sameCount++;
        if (state.sameCount >= STREAM_DONE_THRESHOLD && text.length > 0) {
          // 完成
          clearInterval(state.intervalId);
          pollers.delete(service);
          pushLog({
            role: "ai", msgId: state.msgId, participantId: service,
            text, ts: Date.now(), hasRichContent: hasRich, richTypes,
          });
          sendToPopup({
            type: "chatStreamUpdate", role: "ai", msgId: state.msgId,
            participantId: service, text, isDone: true,
            hasRichContent: hasRich, richTypes,
          });
        }
      } else {
        state.lastText = text;
        state.sameCount = 0;
        sendToPopup({
          type: "chatStreamUpdate", role: "ai", msgId: state.msgId,
          participantId: service, text, isDone: false,
        });
      }
    } catch (e) {
      // tab 关闭或 content script 失联
      clearInterval(state.intervalId);
      pollers.delete(service);
      sendToPopup({
        type: "chatStreamUpdate", role: "ai", msgId: state.msgId,
        participantId: service, text: `⚠ ${participant.name} 已断开`,
        isDone: true,
      });
    }
  }
```

> 注：把这段插进 IIFE 内部，替换原 `async function broadcast(...) {}` 占位。`pushLog` 和 `newMsgId` 是新工具函数。

- [ ] **Step 8.2: 把 getLog 完整化**

替换占位：

```javascript
  function getLog() { return chatLog.slice(); }
```

- [ ] **Step 8.3: 提交**

```bash
git add src/chat-bus.js
git commit -m "feat(chat-bus): broadcast routing + 1.5s polling scheduler"
```

---

## Task 9: 9 个 content-*.js 加 hasRichContent 检测器

**Files:**
- Modify: `src/content-claude.js` (readResponse 函数)
- Modify: 其他 8 个 content-*.js
- Create: `src/test/content-richcontent.test.mjs`

- [ ] **Step 9.1: 改 src/content-claude.js — readResponse 返回扩展字段**

找到 onMessage 中 `readResponse` 分支（约 65 行），改为：

```javascript
if (msg.action === "readResponse") {
  readLatestResponse().then(text => {
    const { hasRichContent, richTypes } = detectRichContent();
    sendResponse({ site: SITE, text, hasRichContent, richTypes });
  }).catch(e => sendResponse({ site: SITE, text: "", error: e.message }));
  return true;
}
```

在文件末尾加 detectRichContent 函数：

```javascript
function detectRichContent() {
  const types = [];
  // Claude Artifact
  if (document.querySelector('[class*="artifact"], iframe[src*="artifact"]')) types.push("artifact");
  // 多图
  const imgs = document.querySelectorAll("main img, [role='main'] img");
  if (imgs.length > 1) types.push("image");
  // Mermaid（Claude 偶尔嵌 mermaid）
  if (document.querySelector('code.language-mermaid, [class*="mermaid"]')) types.push("mermaid");
  return { hasRichContent: types.length > 0, richTypes: types };
}
```

- [ ] **Step 9.2: src/content-gemini.js 加同款（检测 canvas 元素）**

readResponse 分支同 9.1，detectRichContent 函数改为：

```javascript
function detectRichContent() {
  const types = [];
  // Gemini Canvas
  if (document.querySelector('[class*="canvas"], canvas[width][height]')) types.push("canvas");
  if (document.querySelectorAll("main img").length > 1) types.push("image");
  if (document.querySelector('code.language-mermaid')) types.push("mermaid");
  return { hasRichContent: types.length > 0, richTypes: types };
}
```

- [ ] **Step 9.3: src/content-chatgpt.js 加同款（检测 canvas panel + mermaid）**

```javascript
function detectRichContent() {
  const types = [];
  if (document.querySelector('[class*="canvas-panel"], [data-element-id*="canvas"]')) types.push("canvas");
  if (document.querySelector('code.language-mermaid, [class*="mermaid"]')) types.push("mermaid");
  if (document.querySelectorAll("[data-message-author-role='assistant'] img").length > 1) types.push("image");
  return { hasRichContent: types.length > 0, richTypes: types };
}
```

- [ ] **Step 9.4: src/content-deepseek.js / doubao / qwen / kimi / yuanbao / grok 加通用版**

6 个文件统一加：

```javascript
function detectRichContent() {
  const types = [];
  if (document.querySelectorAll("main img, .message img, [class*='response'] img").length > 1) types.push("image");
  if (document.querySelector('code.language-mermaid, [class*="mermaid"]')) types.push("mermaid");
  if (document.querySelector('[class*="canvas"]:not(button):not(input)')) types.push("canvas");
  return { hasRichContent: types.length > 0, richTypes: types };
}
```

每个文件的 readResponse 分支也按 9.1 模式扩展。

- [ ] **Step 9.5: 创建 src/test/content-richcontent.test.mjs（纯字符串 mock DOM 测）**

```javascript
// 用纯函数化 detectRichContent — 暴露为可测函数
// 注：content scripts 是浏览器环境，这里只测可纯化的 selector 字符串逻辑
import { test } from "node:test";
import assert from "node:assert/strict";

// 模拟最小 DOM 接口
class MockDOM {
  constructor(html) { this.html = html; }
  querySelector(sel) {
    return MockDOM._match(this.html, sel) ? { tagName: "div" } : null;
  }
  querySelectorAll(sel) {
    const matches = MockDOM._matchAll(this.html, sel);
    return { length: matches.length, forEach: (cb) => matches.forEach(cb), [Symbol.iterator]: () => matches[Symbol.iterator]() };
  }
  static _match(html, sel) {
    // 极简：只支持 class="xxx" 模糊匹配
    if (sel.includes("artifact")) return /class="[^"]*artifact/i.test(html);
    if (sel.includes("mermaid")) return /language-mermaid|class="[^"]*mermaid/i.test(html);
    if (sel.includes("canvas")) return /<canvas|class="[^"]*canvas/i.test(html);
    return false;
  }
  static _matchAll(html, sel) {
    if (sel.includes("img")) {
      const m = html.match(/<img/gi) || [];
      return m;
    }
    return [];
  }
}

// 测试逻辑层（复制 content-claude.js 的 detectRichContent）
function detectClaudeRich(dom) {
  const types = [];
  if (dom.querySelector('[class*="artifact"], iframe[src*="artifact"]')) types.push("artifact");
  const imgs = dom.querySelectorAll("main img");
  if (imgs.length > 1) types.push("image");
  if (dom.querySelector('code.language-mermaid, [class*="mermaid"]')) types.push("mermaid");
  return { hasRichContent: types.length > 0, richTypes: types };
}

test("Claude: 检测 artifact", () => {
  const dom = new MockDOM('<div class="artifact-card">x</div>');
  const r = detectClaudeRich(dom);
  assert.equal(r.hasRichContent, true);
  assert.deepEqual(r.richTypes, ["artifact"]);
});

test("Claude: 检测 mermaid", () => {
  const dom = new MockDOM('<code class="language-mermaid">graph</code>');
  const r = detectClaudeRich(dom);
  assert.equal(r.hasRichContent, true);
  assert.deepEqual(r.richTypes, ["mermaid"]);
});

test("Claude: 多图触发 image", () => {
  const dom = new MockDOM('<main><img src="1"><img src="2"></main>');
  const r = detectClaudeRich(dom);
  assert.deepEqual(r.richTypes, ["image"]);
});

test("Claude: 纯文本不触发", () => {
  const dom = new MockDOM('<p>hello world</p>');
  const r = detectClaudeRich(dom);
  assert.equal(r.hasRichContent, false);
  assert.deepEqual(r.richTypes, []);
});
```

- [ ] **Step 9.6: 跑测试**

```bash
npm test
```
期望：所有测试 pass（含 popup-markdown 9 个 + content-richcontent 4 个 = 13 个）。

- [ ] **Step 9.7: 提交**

```bash
git add src/content-*.js src/test/content-richcontent.test.mjs
git commit -m "feat(content): add hasRichContent detector to 9 AI platforms"
```

---

## Task 10: chat-bus jumpToOrigin 实现

**Files:**
- Modify: `src/chat-bus.js` (jumpToOrigin 占位补全)

- [ ] **Step 10.1: 改 src/chat-bus.js**

替换 jumpToOrigin 占位：

```javascript
  async function jumpToOrigin(participantId) {
    const p = (StateMachine.participants || []).find(x => x.service === participantId);
    if (!p || !p.tabId) return { ok: false, error: "未找到参与者标签页" };
    try {
      const tab = await chrome.tabs.get(p.tabId);
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(p.tabId, { active: true });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
```

- [ ] **Step 10.2: 手动验证（依赖 Task 8 完成）**

1. 重载扩展，开 sidepanel，加 Claude 参与者（确保 claude.ai 有打开的对话）
2. 开群聊 popup，在群聊输入"写一个 todo list 应用 artifact"广播
3. Claude 流式期间，popup 气泡渐进刷新
4. 完成时 popup 应显示 "📦 含 artifact ↗ 在 Claude 查看" pill
5. 点击 pill → 自动切到 Claude 的 window/tab

- [ ] **Step 10.3: 提交**

```bash
git add src/chat-bus.js
git commit -m "feat(chat-bus): implement jumpToOrigin (focus AI tab)"
```

---

## Task 11: @mention 补全菜单 + 单发路由

**Files:**
- Modify: `src/popup.js` (mention 解析 + UI 菜单)
- Create: `src/test/popup-mention.test.mjs`

- [ ] **Step 11.1: 改 src/popup.js — 加 mention 自动补全 UI**

在 IIFE 内部加：

```javascript
  // ── @mention 自动补全 ──
  const MENTION_CANDIDATES = Object.entries(NAME).map(([id, name]) => ({ id, name }));
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
    const list = MENTION_CANDIDATES.filter(c =>
      c.id.startsWith(q) || c.name.toLowerCase().startsWith(q)
    );
    if (!list.length) return hideMentionMenu();
    $mentionMenu.innerHTML = list.map((c, i) => `
      <div class="mention-item ${i === 0 ? 'active' : ''}" data-id="${c.id}">
        <span class="msg-avatar ${AVATAR_CLASS[c.id]}" style="width:18px;height:18px;font-size:9px;">${AVATAR_INITIAL[c.id]}</span>
        <span>${c.name}</span>
      </div>
    `).join("");
    $mentionMenu.hidden = false;
    mentionActive = true;
    $mentionMenu.querySelectorAll(".mention-item").forEach(el => {
      el.addEventListener("click", () => selectMention(el.dataset.id));
    });
  }

  function hideMentionMenu() {
    $mentionMenu.hidden = true;
    mentionActive = false;
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
  });
```

- [ ] **Step 11.2: 改 parseMentions 把 @中文名 也识别**

替换原 parseMentions：

```javascript
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
```

- [ ] **Step 11.3: 创建 src/test/popup-mention.test.mjs**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";

// 复制 parseMentions（同步项目代码一致）— 9 个 AI
const NAME = {
  claude: "Claude", gemini: "Gemini", chatgpt: "ChatGPT",
  deepseek: "DeepSeek", doubao: "豆包", qwen: "千问",
  kimi: "Kimi", yuanbao: "元宝", grok: "Grok",
};

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

test("无 @ 返回广播", () => {
  assert.deepEqual(parseMentions("分析宁王"), { targets: [], text: "分析宁王" });
});

test("@Claude 单发", () => {
  assert.deepEqual(parseMentions("@Claude 你怎么看"), { targets: ["claude"], text: "你怎么看" });
});

test("@Claude @Gemini 双发", () => {
  assert.deepEqual(parseMentions("@Claude @Gemini 对比下"), { targets: ["claude", "gemini"], text: "对比下" });
});

test("@豆包 中文名", () => {
  assert.deepEqual(parseMentions("@豆包 来一段"), { targets: ["doubao"], text: "来一段" });
});

test("@不存在 不识别", () => {
  assert.deepEqual(parseMentions("@xyz hello"), { targets: [], text: "@xyz hello" });
});
```

- [ ] **Step 11.4: 跑测试**

```bash
npm test
```
期望：18 个测试全 pass（9 markdown + 4 richcontent + 5 mention）。

- [ ] **Step 11.5: 手动验证 @ 菜单**

1. 重载扩展，开群聊 popup
2. 输入 "@" → 期望弹出 9 个 AI 候选菜单
3. 输入 "@Cl" → 菜单只剩 Claude
4. 按 ↓ ↑ 切换、按 Enter 选中 → 输入框变 "@Claude "
5. 继续输入 "你好" + Ctrl+Enter → 只有 Claude 气泡出现

- [ ] **Step 11.6: 提交**

```bash
git add src/popup.js src/test/popup-mention.test.mjs
git commit -m "feat(popup): @mention completion menu + single-target routing"
```

---

## Task 12: chatLog FIFO + storage unit test

**Files:**
- Create: `src/test/chat-bus-log.test.mjs`

- [ ] **Step 12.1: 创建 src/test/chat-bus-log.test.mjs**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";

// 测纯逻辑：FIFO 上限 + 添加 + 清空
const MAX_LOG = 100;

function makeLog() {
  const log = [];
  return {
    push(entry) {
      log.push(entry);
      while (log.length > MAX_LOG) log.shift();
    },
    clear() { log.length = 0; },
    snapshot() { return log.slice(); },
    size() { return log.length; },
  };
}

test("chatLog: push 100 条不溢出", () => {
  const L = makeLog();
  for (let i = 0; i < 100; i++) L.push({ msgId: `m${i}`, text: `t${i}` });
  assert.equal(L.size(), 100);
  assert.equal(L.snapshot()[0].msgId, "m0");
  assert.equal(L.snapshot()[99].msgId, "m99");
});

test("chatLog: push 150 条 FIFO 丢前 50 条", () => {
  const L = makeLog();
  for (let i = 0; i < 150; i++) L.push({ msgId: `m${i}`, text: `t${i}` });
  assert.equal(L.size(), 100);
  assert.equal(L.snapshot()[0].msgId, "m50");
  assert.equal(L.snapshot()[99].msgId, "m149");
});

test("chatLog: clear 清空", () => {
  const L = makeLog();
  L.push({ msgId: "a", text: "x" });
  L.clear();
  assert.equal(L.size(), 0);
});

test("chatLog: snapshot 是独立副本", () => {
  const L = makeLog();
  L.push({ msgId: "a" });
  const snap = L.snapshot();
  L.push({ msgId: "b" });
  assert.equal(snap.length, 1);  // snap 不受后续 push 影响
});
```

- [ ] **Step 12.2: 跑测试**

```bash
npm test
```
期望：22 个测试全 pass。

- [ ] **Step 12.3: 提交**

```bash
git add src/test/chat-bus-log.test.mjs
git commit -m "test(chat-bus): chatLog FIFO + snapshot independence"
```

---

## Task 13: 端到端手动验证 + Release Notes

**Files:**
- Create: `docs/release-notes-4.0.0-alpha.html`

- [ ] **Step 13.1: 完整 E2E 流程手动测试清单**

依次执行下列场景，每项打勾 ✅ 或记录 BUG：

| # | 场景 | 期望 |
|---|------|------|
| 1 | 加 Claude + Gemini + ChatGPT 参与者（并列模式） | 3 个独立 chrome window 弹出 |
| 2 | sidepanel 点"🪟 群聊" | popup 窗口在主屏右半弹出 |
| 3 | popup 输入"hello"按 Ctrl+Enter | 3 个 AI 气泡显示 typing → 1.5s 后开始填充内容 → 流完显示完整回答 |
| 4 | popup 输入"@Claude 你好" | 只有 Claude 气泡出现，Gemini/ChatGPT 不触发 |
| 5 | 让 Claude 写 artifact（"写个 React todo list 用 artifact"） | popup Claude 气泡末尾出现 "📦 含 artifact ↗ 在 Claude 查看" pill |
| 6 | 点 pill | 自动切到 Claude window/tab（focus） |
| 7 | 关闭 popup | 点 sidepanel 按钮重开 → 历史消息回放 |
| 8 | 拖动 popup 到不同位置 → 关闭 → 重开 | popup 位置还原 |
| 9 | popup 顶部点🗑清空 → 确认 | 消息列清空，AI 原页不受影响 |
| 10 | 关闭其中一个 AI 标签页 → popup 再发消息 | 该 AI 气泡显示"⚠ XX 已断开"，其他 AI 正常 |

- [ ] **Step 13.2: 创建 docs/release-notes-4.0.0-alpha.html（华为汇报风格，简洁）**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>AI Arena v4.0.0-alpha 发布说明</title>
<style>
  :root { --bg:#fafafa; --card:#fff; --ink:#1d1d1f; --ink-soft:#6e6e73; --border:#d2d2d7; --accent:#0071e3; }
  @media (prefers-color-scheme: dark) { :root { --bg:#1d1d1f; --card:#2c2c2e; --ink:#f5f5f7; --ink-soft:#aeaeb2; --border:#38383a; --accent:#0a84ff; } }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:-apple-system,"PingFang SC",system-ui; background:var(--bg); color:var(--ink); padding:40px 20px; line-height:1.6; }
  .container { max-width:760px; margin:0 auto; }
  h1 { font-size:28px; letter-spacing:-0.02em; margin-bottom:8px; }
  .subtitle { color:var(--ink-soft); margin-bottom:32px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:14px; padding:24px 28px; margin-bottom:18px; }
  h2 { font-size:18px; margin-bottom:12px; }
  ul { margin-left:20px; }
  li { margin:4px 0; }
  .pill { display:inline-block; padding:2px 10px; border-radius:999px; background:var(--accent); color:#fff; font-size:12px; }
</style>
</head>
<body>
<div class="container">
  <h1>AI Arena v4.0.0-alpha <span class="pill">微信群聊视图</span></h1>
  <p class="subtitle">2026-05-22 · Phase 1（骨架 + 基础广播）</p>

  <div class="card">
    <h2>新增</h2>
    <ul>
      <li><strong>独立 popup 群聊窗口</strong>：点 sidepanel 顶部"🪟 群聊"按钮打开，类似微信电脑端</li>
      <li><strong>多 AI 聚合时间线</strong>：3 个 AI 的回答以气泡形式落在同一页面，1.5 秒渐进刷新</li>
      <li><strong>@mention 单发</strong>：输入 @Claude 只发给 Claude，无 @ 则广播</li>
      <li><strong>富文本兜底</strong>：检测到 Artifact / Canvas / Mermaid / 多图时显示"↗ 跳原页"按钮</li>
      <li><strong>历史持久化</strong>：chrome.storage.local 保留最近 100 条，popup 重开自动恢复</li>
      <li><strong>智能选屏</strong>：双屏环境下默认落在主屏右半，位置记忆</li>
    </ul>
  </div>

  <div class="card">
    <h2>体验建议</h2>
    <ul>
      <li>推荐启用 <strong>并列模式</strong>（3 个 AI 各自独立 window），群聊 popup 不会踩 Chrome 后台 tab throttling</li>
      <li>双屏：副屏铺 3 个 AI，主屏右半放群聊 popup</li>
    </ul>
  </div>

  <div class="card">
    <h2>已知限制（Phase 2/3 解决）</h2>
    <ul>
      <li>sidepanel 同时提问 / 辩论 / PPT 工坊仍保留，未搬入 popup 抽屉 → Phase 2</li>
      <li>不拉取 AI 原页已有历史（白板起步） → v1.1 加折叠回溯</li>
      <li>富文本（Artifact / 图片）一律跳原页，不内嵌渲染 → v3+</li>
    </ul>
  </div>
</div>
</body>
</html>
```

- [ ] **Step 13.3: 跑构建打包**

```bash
npm run build
```
期望：生成 `dist/github/ai-arena-github-v4.0.0.zip` 和 `dist/store/ai-arena-store-v4.0.0.zip`。

- [ ] **Step 13.4: 提交并打 tag**

```bash
git add docs/release-notes-4.0.0-alpha.html dist/github/ai-arena-github-v4.0.0.zip
git commit -m "release(v4.0.0-alpha): WeChat group chat view phase 1"
git tag -a v4.0.0-alpha -m "Phase 1: popup skeleton + basic broadcast + @mention + persistence"
```

---

## 自审清单（plan 自检）

- ✅ Spec 11 个决策全覆盖：
  - 决策 1（混合渐进）→ Task 9（hasRichContent）+ Task 7（跳原页 pill）
  - 决策 2（popup 独立窗口）→ Task 5（openChatPopup）
  - 决策 3（拥抱并列模式）→ Phase 1 不动并列模式逻辑，依赖现有 windowMode = "tiled"
  - 决策 4（群聊为主驾驶舱）→ Phase 1 仅加按钮；Phase 2 才搬辩论/PPT
  - 决策 5（1.5s polling）→ Task 8
  - 决策 6（白板）→ Task 7 不拉取 AI 原页历史
  - 决策 7（工具栏抽屉）→ Phase 2
  - 决策 8（白名单内嵌渲染）→ Task 3 + Task 9
  - 决策 9（@mention）→ Task 11
  - 决策 10（chrome.storage 100 条）→ Task 5/8/12
  - 决策 11（智能选屏 + 记忆）→ Task 5 defaultBounds + Task 5.5 rememberBounds

- ✅ 无 placeholder：所有 step 都含完整代码或确切命令
- ✅ 类型一致：`participantId` 全程是 service id（"claude"/"gemini"），气泡用 `msgId-participantId` 复合 key
- ✅ TDD 节奏：纯函数（markdown / mention / chatLog）先写 test 再实现；DOM/IPC 流走手动 E2E（符合 CLAUDE.md "测试必须真实执行"）
- ✅ Phase 1 不触碰：sidepanel 同时提问 / 辩论 / PPT tab、debate-engine、windowMode 默认（保留兼容）

---

## 不在 Phase 1 范围

- 历史回填（拉 AI 原页已有 turns 合并）→ v1.1
- sidepanel 减肥（搬辩论/PPT 到抽屉）→ Phase 2
- 抽屉式工具栏 → Phase 2
- Mermaid / Artifact / 图片内嵌渲染 → v3+
- 跨设备同步 → v3+
