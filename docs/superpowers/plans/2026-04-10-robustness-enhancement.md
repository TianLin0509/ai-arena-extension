# AI Arena 鲁棒性增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 AI Arena 从松散的 flag 管理重构为状态机驱动架构，增加确认门控、选择器四层防线和手动介入能力，全面提升鲁棒性。

**Architecture:** 核心改造是引入 FlowState/ParticipantState 状态机，所有操作通过状态转换驱动。background.js 拆分为 state-machine.js（状态逻辑）、selector-manager.js（选择器管理）、debate-engine.js（辩论编排）三个模块，通过 importScripts() 加载。Content script 启动时从 background 获取选择器配置。侧边栏增加实时状态卡片和汇总确认面板。

**Tech Stack:** Chrome Extension MV3, vanilla JS, importScripts(), chrome.storage.local, chrome.tabs API

**Spec:** `docs/superpowers/specs/2026-04-10-robustness-enhancement-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `state-machine.js` | Create | FlowState + ParticipantState 定义、转换、持久化 |
| `selector-manager.js` | Create | 四层选择器管理：内置→热更新→启发式→手动粘贴 |
| `selectors-config.js` | Create | 所有平台内置默认选择器配置 |
| `debate-engine.js` | Create | 辩论轮次编排、prompt 组装（从 background.js 抽出） |
| `selectors.json` | Create | GitHub 热更新选择器配置 |
| `background.js` | Modify | 精简为入口+消息路由，委托给各模块 |
| `sidepanel.js` | Modify | 增加状态卡片、确认面板、手动介入 UI |
| `sidepanel.html` | Modify | 增加确认面板 DOM 结构 |
| `sidepanel.css` | Modify | 增加确认面板和状态卡片样式 |
| `content-claude.js` | Modify | 选择器从 SelectorManager 获取 + 启发式兜底 |
| `content-chatgpt.js` | Modify | 同上 |
| `content-gemini.js` | Modify | 同上 |
| `content-deepseek.js` | Modify | 同上 |
| `content-doubao.js` | Modify | 同上 |
| `content-qwen.js` | Modify | 同上 |
| `manifest.json` | Modify | background.js 的 importScripts 不需要改 manifest |

---

### Task 1: 创建 selectors-config.js — 内置默认选择器配置

**Files:**
- Create: `selectors-config.js`

从 6 个 content script 中提取所有硬编码的选择器，统一管理。

- [ ] **Step 1: 创建 selectors-config.js**

```js
// selectors-config.js — 内置默认选择器配置
// 每个平台的每个 action 是一个选择器数组，按优先级排列

const DEFAULT_SELECTORS = {
  claude: {
    input: [
      "div.ProseMirror[contenteditable='true']",
      ".ProseMirror[contenteditable]",
      "[contenteditable='true']"
    ],
    response: [
      "[data-testid='chat-message-content']",
      ".font-claude-message",
      "[data-is-streaming]",
      ".prose, .markdown",
      '[class*="message"], [class*="response"], [class*="assistant"]'
    ],
    streaming: [
      '[data-is-streaming="true"]',
      '.font-claude-message [data-is-streaming="true"]',
      ".is-streaming",
      'button[aria-label="Stop Response"]',
      'button[aria-label="Stop response"]',
      '[data-is-thinking="true"]',
      ".font-claude-message .thinking-indicator",
      '.font-claude-message [class*="thinking"]',
      'button[aria-label="Cancel"]',
      ".font-claude-message .animate-spin",
      "[data-is-streaming] .animate-spin"
    ],
    sendButton: [
      'button[aria-label="Send Message"]',
      'button[aria-label="Send message"]',
      'button[data-testid="send-button"]'
    ],
    userMessage: [
      '[data-testid="human-turn"]'
    ],
    conversation: [
      '[data-testid="human-turn"], .font-claude-message, [data-is-streaming]'
    ]
  },
  chatgpt: {
    input: [
      "#prompt-textarea",
      "textarea",
      "[contenteditable='true']"
    ],
    response: [
      '[data-message-author-role="assistant"]',
      ".markdown.prose"
    ],
    streaming: [
      'button[aria-label="Stop generating"]',
      'button[aria-label="Stop streaming"]',
      '[data-testid="stop-button"]'
    ],
    sendButton: [
      '[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send"]'
    ],
    conversation: [
      "[data-message-author-role]"
    ]
  },
  gemini: {
    input: [
      ".ql-editor[contenteditable='true']",
      "rich-textarea .ql-editor",
      ".text-input-field textarea",
      "[contenteditable='true']"
    ],
    response: [
      ".model-response-text .markdown",
      ".response-container .markdown",
      "[data-content-type='model']"
    ],
    streaming: [
      "model-response .loading-indicator",
      "button[aria-label='Stop response']",
      "button[aria-label='Stop generating']",
      "button[aria-label*='Stop']",
      ".thinking-indicator",
      "thinking-tag",
      "model-response .thinking",
      "model-response [class*='thinking']",
      "model-response .animate-spin",
      "model-response mat-spinner"
    ],
    sendButton: [
      'button[aria-label="Send message"]',
      'button[aria-label*="发送"]',
      "button.send-button"
    ],
    conversation: [
      "user-query, model-response",
      "[data-content-type]"
    ]
  },
  deepseek: {
    input: [
      "#chat-input",
      "textarea[placeholder]",
      "textarea",
      '[contenteditable="true"]'
    ],
    response: [
      ".ds-markdown",
      '[class*="assistant-message"]',
      '[class*="bot-message"]',
      ".markdown-body",
      ".prose"
    ],
    streaming: [
      ".ds-loading",
      'button[aria-label="Stop generating"]',
      'button[aria-label="Stop"]'
    ],
    sendButton: [
      '[data-testid="send-button"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="发送"]'
    ],
    userMessage: [
      '[class*="user-message"]',
      '[class*="human"]',
      ".fbb737a4"
    ]
  },
  doubao: {
    input: [
      '[contenteditable="true"]',
      "textarea",
      '[class*="input"][class*="editor"]'
    ],
    response: [
      '[class*="assistant"] [class*="content"]',
      '[class*="bot-message"]',
      '[class*="markdown"]'
    ],
    streaming: [
      'button[class*="stop"]',
      '[class*="generating"]'
    ],
    sendButton: [
      'button[class*="send"]',
      '[class*="send-btn"]'
    ],
    userMessage: [
      '[class*="user-message"]',
      '[class*="human-message"]',
      '[class*="user_message"]'
    ]
  },
  qwen: {
    input: [
      '[contenteditable="true"]',
      "textarea",
      "#chat-input"
    ],
    response: [
      '[class*="assistant"] [class*="content"]',
      '[class*="answer-content"]',
      '[class*="markdown"]'
    ],
    streaming: [
      'button[class*="stop"]',
      '[class*="generating"]'
    ],
    sendButton: [
      'button[class*="send"]',
      'button[class*="submit"]'
    ],
    userMessage: [
      '[class*="user"] [class*="content"]',
      '[class*="human"] [class*="text"]',
      '[class*="question"]'
    ]
  }
};
```

- [ ] **Step 2: 验证文件加载**

在浏览器 DevTools console 中，打开 `chrome://extensions/` 的 service worker inspector，确认 `DEFAULT_SELECTORS` 对象可访问（后续 Task 3 中 background.js 会 importScripts 它）。

- [ ] **Step 3: Commit**

```bash
git add selectors-config.js
git commit -m "feat: extract platform selectors to selectors-config.js"
```

---

### Task 2: 创建 selector-manager.js — 四层选择器管理

**Files:**
- Create: `selector-manager.js`
- Create: `selectors.json`

- [ ] **Step 1: 创建 selector-manager.js**

```js
// selector-manager.js — 四层选择器管理
// 优先级：GitHub 热更新 > 内置默认 > 启发式兜底

const GITHUB_SELECTORS_URL = "https://raw.githubusercontent.com/lintian233/ai-arena-extension/master/selectors.json";
const SELECTORS_CACHE_KEY = "selectorsRemoteCache";
const SELECTORS_FETCH_TIMEOUT = 3000; // 3秒超时，静默失败
const SELECTOR_FAILURE_LOG_KEY = "selectorFailureLog";

const SelectorManager = {
  _remoteSelectors: null,  // GitHub 热更新的选择器
  _failureLog: {},         // { platform: { action: count } }

  // 初始化：从 cache 加载 + 异步拉取远程
  async init() {
    // 从本地缓存恢复
    try {
      const data = await chrome.storage.local.get([SELECTORS_CACHE_KEY, SELECTOR_FAILURE_LOG_KEY]);
      if (data[SELECTORS_CACHE_KEY]) this._remoteSelectors = data[SELECTORS_CACHE_KEY];
      if (data[SELECTOR_FAILURE_LOG_KEY]) this._failureLog = data[SELECTOR_FAILURE_LOG_KEY];
    } catch {}

    // 异步拉取远程（不阻塞启动）
    this._fetchRemote();
  },

  async _fetchRemote() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SELECTORS_FETCH_TIMEOUT);
      const resp = await fetch(GITHUB_SELECTORS_URL, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (resp.ok) {
        const data = await resp.json();
        this._remoteSelectors = data;
        chrome.storage.local.set({ [SELECTORS_CACHE_KEY]: data });
      }
    } catch {
      // 网络不可用（公司内网等），静默失败，用缓存或内置
    }
  },

  // 获取某平台某操作的选择器数组（已按优先级合并）
  getSelectors(platform, action) {
    const remote = this._remoteSelectors?.[platform]?.[action] || [];
    const builtin = DEFAULT_SELECTORS[platform]?.[action] || [];
    // 去重合并：远程优先，然后内置
    const seen = new Set();
    const merged = [];
    for (const sel of [...remote, ...builtin]) {
      if (!seen.has(sel)) { seen.add(sel); merged.push(sel); }
    }
    return merged;
  },

  // 获取所有平台的完整选择器配置（供 content script 请求）
  getAllForPlatform(platform) {
    const result = {};
    const actions = new Set([
      ...Object.keys(DEFAULT_SELECTORS[platform] || {}),
      ...Object.keys(this._remoteSelectors?.[platform] || {})
    ]);
    for (const action of actions) {
      result[action] = this.getSelectors(platform, action);
    }
    return result;
  },

  // 上报选择器失败
  reportFailure(platform, action) {
    if (!this._failureLog[platform]) this._failureLog[platform] = {};
    this._failureLog[platform][action] = (this._failureLog[platform][action] || 0) + 1;
    chrome.storage.local.set({ [SELECTOR_FAILURE_LOG_KEY]: this._failureLog });
    // 通知侧边栏
    chrome.runtime.sendMessage({
      type: "selectorWarning",
      platform,
      action,
      message: `${platform} 的 ${action} 选择器可能已失效（已降级到启发式模式）`
    }).catch(() => {});
  },

  getFailureLog() {
    return this._failureLog;
  }
};
```

- [ ] **Step 2: 创建 selectors.json（GitHub 热更新配置）**

```json
{
  "version": 1,
  "claude": {
    "input": ["div.ProseMirror[contenteditable='true']"],
    "response": ["[data-testid='chat-message-content']", ".font-claude-message"],
    "streaming": ["[data-is-streaming='true']", "button[aria-label='Stop Response']"]
  },
  "chatgpt": {
    "input": ["#prompt-textarea"],
    "response": ["[data-message-author-role='assistant']"],
    "streaming": ["button[aria-label='Stop generating']", "[data-testid='stop-button']"]
  },
  "gemini": {
    "input": [".ql-editor[contenteditable='true']"],
    "response": [".model-response-text .markdown"],
    "streaming": ["button[aria-label='Stop response']", "model-response .loading-indicator"]
  },
  "deepseek": {
    "input": ["#chat-input", "textarea"],
    "response": [".ds-markdown"],
    "streaming": [".ds-loading", "button[aria-label='Stop generating']"]
  },
  "doubao": {
    "input": ["[contenteditable='true']"],
    "response": ["[class*='assistant'] [class*='content']"],
    "streaming": ["button[class*='stop']", "[class*='generating']"]
  },
  "qwen": {
    "input": ["[contenteditable='true']"],
    "response": ["[class*='assistant'] [class*='content']", "[class*='answer-content']"],
    "streaming": ["button[class*='stop']", "[class*='generating']"]
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add selector-manager.js selectors.json
git commit -m "feat: add SelectorManager with 4-layer selector resilience"
```

---

### Task 3: 创建 state-machine.js — 状态机核心

**Files:**
- Create: `state-machine.js`

- [ ] **Step 1: 创建 state-machine.js**

```js
// state-machine.js — FlowState + ParticipantState 状态机

// ── 状态枚举 ──
const FlowState = {
  IDLE: "idle",
  BROADCASTING: "broadcasting",
  AWAITING_RESPONSES: "awaiting_responses",
  CONFIRMING: "confirming",
  DEBATING: "debating",
  SUMMARY: "summary"
};

const ParticipantState = {
  IDLE: "idle",
  INJECTING: "injecting",
  INJECT_OK: "inject_ok",
  INJECT_FAILED: "inject_failed",
  STREAMING: "streaming",
  RESPONSE_READY: "response_ready",
  RESPONSE_FAILED: "response_failed"
};

// ── 状态管理器 ──
const StateMachine = {
  flowState: FlowState.IDLE,
  participants: [],     // { id, service, tabId, name, state, response, responsePreview, manualResponse }
  nextId: 1,
  debateSession: { originalQuestion: "", rounds: [], summaryText: "" },

  // ── 初始化（从 storage 恢复） ──
  async init() {
    const data = await chrome.storage.local.get(["sm_flowState", "sm_participants", "sm_nextId", "sm_debateSession"]);
    if (data.sm_flowState) this.flowState = data.sm_flowState;
    if (data.sm_participants) this.participants = data.sm_participants;
    if (data.sm_nextId) this.nextId = data.sm_nextId;
    if (data.sm_debateSession) this.debateSession = data.sm_debateSession;
  },

  save() {
    chrome.storage.local.set({
      sm_flowState: this.flowState,
      sm_participants: this.participants,
      sm_nextId: this.nextId,
      sm_debateSession: this.debateSession
    });
  },

  // ── Flow 状态转换 ──
  setFlowState(newState) {
    this.flowState = newState;
    this.save();
    this._broadcastStateUpdate();
  },

  // ── 参与者管理 ──
  addParticipant(id, service, tabId, name) {
    this.participants.push({
      id, service, tabId, name,
      state: ParticipantState.IDLE,
      response: null,
      responsePreview: null,
      manualResponse: null
    });
    this.save();
  },

  removeParticipant(id) {
    this.participants = this.participants.filter(p => p.id !== id);
    this.save();
  },

  getParticipant(id) {
    return this.participants.find(p => p.id === id);
  },

  // ── 参与者状态转换 ──
  setParticipantState(id, newState) {
    const p = this.getParticipant(id);
    if (p) {
      p.state = newState;
      this.save();
      this._broadcastStateUpdate();
    }
  },

  setParticipantResponse(id, text) {
    const p = this.getParticipant(id);
    if (p) {
      p.response = text;
      p.responsePreview = text ? text.slice(0, 100) : null;
      p.state = ParticipantState.RESPONSE_READY;
      this.save();
      this._broadcastStateUpdate();
    }
  },

  setParticipantManualResponse(id, text) {
    const p = this.getParticipant(id);
    if (p) {
      p.manualResponse = text;
      p.response = text;
      p.responsePreview = text ? text.slice(0, 100) : null;
      p.state = ParticipantState.RESPONSE_READY;
      this.save();
      this._broadcastStateUpdate();
    }
  },

  // ── 确认门控检查 ──

  // 是否所有需要关注的参与者都已有结果（就绪/失败）
  allResponsesSettled() {
    return this.participants
      .filter(p => p.state !== ParticipantState.INJECT_FAILED)
      .every(p =>
        p.state === ParticipantState.RESPONSE_READY ||
        p.state === ParticipantState.RESPONSE_FAILED
      );
  },

  // 有效回复数
  validResponseCount() {
    return this.participants.filter(p => p.state === ParticipantState.RESPONSE_READY && p.response).length;
  },

  // 是否可以进入辩论
  canStartDebate() {
    return this.validResponseCount() >= 2;
  },

  // "疑似不完整"判定
  isSuspiciousResponse(id) {
    const p = this.getParticipant(id);
    if (!p || p.state !== ParticipantState.RESPONSE_READY || !p.response) return false;
    const text = p.response.trim();
    if (text.length < 50) return true;
    if (text.endsWith("...") || text.endsWith("…")) return true;
    return false;
  },

  // ── 会话管理 ──
  resetSession() {
    this.debateSession = { originalQuestion: "", rounds: [], summaryText: "" };
    this.flowState = FlowState.IDLE;
    this.participants.forEach(p => {
      p.state = ParticipantState.IDLE;
      p.response = null;
      p.responsePreview = null;
      p.manualResponse = null;
    });
    this.save();
  },

  hardReset() {
    this.participants = [];
    this.nextId = 1;
    this.debateSession = { originalQuestion: "", rounds: [], summaryText: "" };
    this.flowState = FlowState.IDLE;
    this.save();
  },

  // ── 状态广播到 sidepanel ──
  _broadcastStateUpdate() {
    chrome.runtime.sendMessage({
      type: "stateUpdate",
      flowState: this.flowState,
      participants: this.participants.map(p => ({
        id: p.id, service: p.service, tabId: p.tabId, name: p.name,
        state: p.state, responsePreview: p.responsePreview,
        suspicious: this.isSuspiciousResponse(p.id)
      })),
      debateSession: this.debateSession
    }).catch(() => {});
  },

  // ── 序列化完整状态给 getState 请求 ──
  getFullState() {
    return {
      flowState: this.flowState,
      participants: this.participants.map(p => ({
        id: p.id, service: p.service, tabId: p.tabId, name: p.name,
        state: p.state, responsePreview: p.responsePreview,
        suspicious: this.isSuspiciousResponse(p.id)
      })),
      debateSession: this.debateSession
    };
  }
};
```

- [ ] **Step 2: Commit**

```bash
git add state-machine.js
git commit -m "feat: add state machine with FlowState and ParticipantState"
```

---

### Task 4: 创建 debate-engine.js — 辩论编排

**Files:**
- Create: `debate-engine.js`

从 background.js 中提取辩论相关逻辑。

- [ ] **Step 1: 创建 debate-engine.js**

```js
// debate-engine.js — 辩论轮次编排、prompt 组装

const DEBATE_STYLES = {
  free: { name: "自由辩论", prompt: "以下是其他 AI 对同一问题的回答，请分析他们的观点，指出你认同和不认同的地方，并给出你的改进回答。" },
  collab: { name: "群策群力", prompt: "以下是你的队友们对同一问题的回答。你们是协作关系，目标是共同得出最优方案。请：1) 吸收队友回答中的亮点和你没想到的角度；2) 补充你认为队友遗漏的重要内容；3) 整合所有人的优势，给出一个更完善的综合回答。不要攻击或否定队友，而是取长补短。" },
};

const DebateEngine = {
  // 构建辩论 prompt
  buildDebatePrompt(participantId, responses, style, roundNum, guidance, concise) {
    const styleConfig = DEBATE_STYLES[style] || DEBATE_STYLES.free;
    const isCollab = style === "collab";

    const roundHints = isCollab ? {
      1: "这是第1轮协作。请仔细阅读队友们的回答，找出各自的亮点和你没想到的角度。",
      2: "这是第2轮协作。队友们已经互相补充了一轮，请在此基础上进一步整合，查漏补缺。",
      3: "这是第3轮协作。方案已趋于成熟，请做最终打磨——精简冗余，强化核心结论，形成一份完整方案。",
    } : {
      1: "这是第1轮辩论。请仔细阅读其他参与者的初始回答，找出核心分歧和共识。",
      2: "这是第2轮辩论。经过上一轮交锋，请聚焦于仍存在分歧的关键点，深化你的论证或修正你的观点。",
      3: "这是第3轮辩论。辩论已进入深水区，请避免重复已达成共识的内容，集中攻克剩余分歧点，给出最终立场。",
    };

    const defaultHint = isCollab
      ? `这是第${roundNum}轮协作。请只补充新的见解，不要重复已有内容。`
      : `这是第${roundNum}轮辩论。请只针对仍有分歧的核心问题发表精炼观点。`;
    const roundHint = roundHints[roundNum] || defaultHint;

    const conciseRule = concise
      ? "\n\n⚠️ 简洁模式：请控制回答在 1000 字以内，用要点列表呈现核心观点，避免长篇大论。每个论点简明扼要。"
      : "";

    // 只包含其他参与者的回复（跳过无效回复）
    const othersText = Object.entries(responses)
      .filter(([id, r]) => id !== participantId && r.text)
      .map(([, r]) => `【${r.name} 的回答】:\n${r.text}`)
      .join("\n\n");

    let prompt = `${roundHint}\n\n${styleConfig.prompt}\n\n${othersText}${conciseRule}`;
    if (guidance) prompt = `用户补充要求：${guidance}\n\n${prompt}`;
    return prompt;
  },

  // 构建总结 prompt
  buildSummaryPrompt(originalQuestion, rounds, responses, customInstruction) {
    let historySection = "";
    if (rounds.length > 0) {
      historySection = "\n\n## 辩论历史摘要\n";
      for (const round of rounds) {
        historySection += `\n### 第${round.roundNum}轮（${DEBATE_STYLES[round.style]?.name || round.style}）\n`;
        if (round.guidance) historySection += `用户引导：${round.guidance}\n`;
      }
      historySection += "\n（以上为辩论过程，以下为各方最终观点）\n";
    }

    const allText = Object.values(responses)
      .filter(r => r.text)
      .map(r => `【${r.name} 的观点】:\n${r.text}`)
      .join("\n\n");

    let prompt = `你是一场多 AI 辩论的最终裁判。${originalQuestion ? `原始问题是：「${originalQuestion}」\n` : ""}以下是各 AI 的讨论记录（经过 ${rounds.length} 轮辩论）。
${historySection}
${allText}

请你作为裁判，给出结构化的最终总结：

## 共识结论
各方一致认同的核心观点

## 分歧焦点
仍存在争议的地方，列出各方立场

## 最终裁定
综合各方观点后，你认为最准确、最完整的结论是什么

## 实操建议
基于以上讨论，给出可落地的建议

## 标注规则
请对每个结论标注共识度：
- 🟢 全员共识：所有参与者都明确支持此观点
- 🟡 多数认同：多数参与者支持，少数持保留意见
- 🔴 存在争议：参与者之间有明确分歧，列出各方立场
- 💡 独家洞察：仅一方提出但有价值的独特视角

要求：客观公正，不偏袒任何一方，重点是综合各家之长得出最优答案。`;

    if (customInstruction?.trim()) prompt += `\n\n## 额外要求\n${customInstruction.trim()}`;
    return prompt;
  },

  // 构建上下文提炼 prompt
  buildContextForkPrompt(history) {
    return `请将以下对话历史压缩成一段简洁的"上下文接力摘要"，供我粘贴到新的对话窗口继续讨论。

要求：
1. 保留所有关键结论、决策、代码片段、专有名词
2. 去掉寒暄、重复、废话
3. 输出格式：先一句话说明"我们在讨论什么"，再用要点列出关键信息，最后一句"请在此基础上继续"
4. 总长度控制在 500 字以内
5. 只输出摘要本身，不要加任何解释

对话历史如下：

${history.trim()}`;
  },

  // 构建 prompt 优化请求
  buildOptimizePrompt(text) {
    return `请优化以下 prompt，使其更清晰、更具体、更能引导出高质量回答。只输出优化后的 prompt，不需要解释：

原始 prompt：
${text}`;
  }
};
```

- [ ] **Step 2: Commit**

```bash
git add debate-engine.js
git commit -m "feat: extract debate orchestration to debate-engine.js"
```

---

### Task 5: 重写 background.js — 精简为入口+消息路由

**Files:**
- Modify: `background.js`

background.js 变为入口和消息路由层，核心逻辑委托给各模块。

- [ ] **Step 1: 重写 background.js**

将 background.js 完整替换为以下内容：

```js
// AI Arena — Background Service Worker v6.0 (状态机驱动)
importScripts("selectors-config.js", "selector-manager.js", "state-machine.js", "debate-engine.js");

const SERVICES = {
  claude:   { url: "https://claude.ai/new",              name: "Claude" },
  gemini:   { url: "https://gemini.google.com/app",      name: "Gemini" },
  chatgpt:  { url: "https://chatgpt.com",                name: "ChatGPT" },
  deepseek: { url: "https://chat.deepseek.com",          name: "DeepSeek" },
  doubao:   { url: "https://www.doubao.com/chat",        name: "豆包" },
  qwen:     { url: "https://tongyi.aliyun.com/qianwen",  name: "通义千问" },
};

const PRESETS = {
  trio:     { name: "三巨头", services: ["claude", "gemini", "chatgpt"] },
  global:   { name: "中外对决", services: ["claude", "deepseek", "qwen"] },
  deep:     { name: "深度对抗", services: ["claude", "claude", "chatgpt"] },
};

const MAX_PARTICIPANTS = 3;

// ── 初始化 ──
const initPromise = Promise.all([StateMachine.init(), SelectorManager.init()]);

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// ── 右键菜单 ──
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "ai-arena-ask", title: "用 AI Arena 提问", contexts: ["selection"] });
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "ai-arena-ask" && info.selectionText) {
    chrome.runtime.sendMessage({ type: "contextMenuText", text: info.selectionText }).catch(() => {});
    if (tab?.windowId) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
});

// ── 标签页关闭 → 直接移除参与者 ──
chrome.tabs.onRemoved.addListener((closedId) => {
  const p = StateMachine.participants.find(p => p.tabId === closedId);
  if (p) {
    StateMachine.removeParticipant(p.id);
    notifyStatus(`${p.name} 标签页已关闭，已移除`);
    StateMachine._broadcastStateUpdate();
  }
});

// ── 消息处理 ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  initPromise.then(async () => {
    try {
      switch (msg.type) {
        case "addParticipant":    sendResponse(await addParticipant(msg.service)); break;
        case "removeParticipant": sendResponse(await removeParticipant(msg.id)); break;
        case "loadPreset":        sendResponse(await loadPreset(msg.presetId)); break;
        case "openAll":           sendResponse(await handleOpenAll()); break;
        case "broadcast":         sendResponse(await handleBroadcast(msg.text, msg.images)); break;
        case "debateRound":       sendResponse(await handleDebateRound(msg.style, msg.guidance, msg.concise)); break;
        case "summary":           sendResponse(await handleSummary(msg.judgeId, msg.customInstruction)); break;
        case "checkAllStreaming":  sendResponse(await checkAllStreaming()); break;
        case "focusTab":          sendResponse(await handleFocusTab(msg.id)); break;
        case "readOneResponse":   sendResponse(await readOneResponse(msg.participantId)); break;
        case "optimizePrompt":    sendResponse(await handleOptimizePrompt(msg.text, msg.judgeId)); break;
        case "contextForkActive": sendResponse(await handleContextForkActive()); break;
        case "exportSession":     sendResponse(exportSession()); break;
        case "getState":          sendResponse(StateMachine.getFullState()); break;
        case "getSelectors":      sendResponse(SelectorManager.getAllForPlatform(msg.platform)); break;
        case "selectorFailure":   SelectorManager.reportFailure(msg.platform, msg.action); sendResponse({ ok: true }); break;

        // ── 半自动门控操作 ──
        case "confirmManualSend":
          StateMachine.setParticipantState(msg.id, ParticipantState.INJECT_OK);
          sendResponse({ ok: true });
          break;
        case "retryInject":
          sendResponse(await retryInjectParticipant(msg.id));
          break;
        case "skipParticipant":
          StateMachine.setParticipantState(msg.id, ParticipantState.RESPONSE_FAILED);
          sendResponse({ ok: true });
          break;
        case "manualPaste":
          StateMachine.setParticipantManualResponse(msg.id, msg.text);
          sendResponse({ ok: true });
          break;
        case "confirmAllReady":
          StateMachine.setFlowState(FlowState.DEBATING);
          sendResponse({ ok: true });
          break;
        case "continueWaiting":
          if (msg.id) {
            StateMachine.setParticipantState(msg.id, ParticipantState.STREAMING);
          }
          StateMachine.setFlowState(FlowState.AWAITING_RESPONSES);
          sendResponse({ ok: true });
          break;

        case "resetSession":
          StateMachine.resetSession();
          notifyStatus("会话已重置");
          sendResponse({ ok: true });
          break;
        case "hardReset":
          // 关闭标签页由 sidepanel 处理
          StateMachine.hardReset();
          notifyStatus("已彻底重置");
          sendResponse({ ok: true });
          break;

        default: sendResponse({ ok: false, error: "Unknown message type" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  });
  return true;
});

// ── 参与者管理 ──

async function addParticipant(service) {
  if (StateMachine.participants.length >= MAX_PARTICIPANTS) {
    notifyStatus(`最多 ${MAX_PARTICIPANTS} 个参与者`);
    return { ok: false, error: `最多 ${MAX_PARTICIPANTS} 个参与者` };
  }
  const info = SERVICES[service];
  if (!info) return { ok: false };
  const count = StateMachine.participants.filter(p => p.service === service).length + 1;
  const id = `p${StateMachine.nextId++}`;
  const currentWindow = await chrome.windows.getCurrent();
  const tab = await chrome.tabs.create({ url: info.url, windowId: currentWindow.id, active: false });
  StateMachine.addParticipant(id, service, tab.id, `${info.name}-${count}`);
  notifyStatus(`已添加 ${info.name}-${count}`);
  StateMachine._broadcastStateUpdate();
  return { ok: true, participants: StateMachine.getFullState().participants };
}

async function removeParticipant(id) {
  const p = StateMachine.getParticipant(id);
  if (!p) return { ok: false };
  if (p.tabId) { try { await chrome.tabs.remove(p.tabId); } catch {} }
  StateMachine.removeParticipant(id);
  notifyStatus(`已移除 ${p.name}`);
  StateMachine._broadcastStateUpdate();
  return { ok: true, participants: StateMachine.getFullState().participants };
}

async function loadPreset(presetId) {
  const preset = PRESETS[presetId];
  if (!preset) return { ok: false };
  for (const p of [...StateMachine.participants]) {
    if (p.tabId) { try { await chrome.tabs.remove(p.tabId); } catch {} }
  }
  StateMachine.participants = [];
  StateMachine.save();
  for (const service of preset.services) await addParticipant(service);
  notifyStatus(`已加载预设「${preset.name}」`);
  await handleOpenAll();
  return { ok: true, participants: StateMachine.getFullState().participants };
}

async function handleOpenAll() {
  if (StateMachine.participants.length === 0) { notifyStatus("请先添加参与者"); return { ok: false }; }
  const currentWindow = await chrome.windows.getCurrent();
  for (const p of StateMachine.participants) {
    if (p.tabId) { try { await chrome.tabs.get(p.tabId); continue; } catch { p.tabId = null; } }
    const tab = await chrome.tabs.create({ url: SERVICES[p.service].url, windowId: currentWindow.id, active: false });
    p.tabId = tab.id;
  }
  StateMachine.save();
  notifyStatus(`${StateMachine.participants.length} 个标签页已就绪`);
  StateMachine._broadcastStateUpdate();
  return { ok: true, participants: StateMachine.getFullState().participants };
}

// ── 广播（状态机驱动） ──

async function handleBroadcast(text, images) {
  StateMachine.debateSession.originalQuestion = text;
  StateMachine.debateSession.rounds = [];
  StateMachine.debateSession.summaryText = "";
  StateMachine.setFlowState(FlowState.BROADCASTING);

  // 所有参与者进入 INJECTING
  StateMachine.participants.forEach(p => {
    p.state = ParticipantState.INJECTING;
    p.response = null;
    p.responsePreview = null;
    p.manualResponse = null;
  });
  StateMachine.save();
  StateMachine._broadcastStateUpdate();

  const results = {};
  await Promise.all(StateMachine.participants.map(async (p) => {
    if (!p.tabId) {
      p.state = ParticipantState.INJECT_FAILED;
      results[p.id] = { name: p.name, status: "error", error: "未打开" };
      return;
    }
    try {
      const ready = await waitForContentScript(p.tabId);
      if (!ready) {
        p.state = ParticipantState.INJECT_FAILED;
        results[p.id] = { name: p.name, status: "error", error: "页面未就绪" };
        return;
      }
      if (images && images.length > 0) {
        await chrome.tabs.sendMessage(p.tabId, { action: "injectImages", images });
      }
      const result = await chrome.tabs.sendMessage(p.tabId, { action: "inject", text });
      if (result.status === "error") {
        p.state = ParticipantState.INJECT_FAILED;
      } else {
        p.state = ParticipantState.INJECT_OK;
      }
      results[p.id] = { name: p.name, ...result };
    } catch (e) {
      p.state = ParticipantState.INJECT_FAILED;
      results[p.id] = { name: p.name, status: "error", error: e.message };
    }
  }));

  StateMachine.save();
  StateMachine._broadcastStateUpdate();

  // 检查是否有失败的参与者 — 如果有，门控 1 由 sidepanel 处理
  // 如果全部成功，自动进入 AWAITING_RESPONSES
  const allOk = StateMachine.participants.every(p => p.state === ParticipantState.INJECT_OK);
  if (allOk) {
    StateMachine.setFlowState(FlowState.AWAITING_RESPONSES);
    notifyStatus("广播完成，等待回复...");
  } else {
    // 保持 BROADCASTING，由 sidepanel 显示门控 1
    notifyStatus("部分发送失败，请处理后继续");
  }

  return results;
}

async function retryInjectParticipant(id) {
  const p = StateMachine.getParticipant(id);
  if (!p || !p.tabId) return { ok: false, error: "参与者无效" };
  p.state = ParticipantState.INJECTING;
  StateMachine.save();
  StateMachine._broadcastStateUpdate();
  try {
    const ready = await waitForContentScript(p.tabId);
    if (!ready) {
      p.state = ParticipantState.INJECT_FAILED;
      StateMachine.save();
      return { ok: false, error: "页面未就绪" };
    }
    const text = StateMachine.debateSession.originalQuestion;
    const result = await chrome.tabs.sendMessage(p.tabId, { action: "inject", text });
    p.state = result.status === "error" ? ParticipantState.INJECT_FAILED : ParticipantState.INJECT_OK;
    StateMachine.save();
    StateMachine._broadcastStateUpdate();
    return { ok: p.state === ParticipantState.INJECT_OK };
  } catch (e) {
    p.state = ParticipantState.INJECT_FAILED;
    StateMachine.save();
    return { ok: false, error: e.message };
  }
}

// ── 辩论（状态机驱动） ──

async function handleDebateRound(style = "free", guidance = "", concise = false) {
  if (StateMachine.participants.length < 2) {
    notifyStatus("至少需要 2 个参与者");
    return { ok: false, error: "参与者不足" };
  }

  // 收集有效回复
  const responses = {};
  for (const p of StateMachine.participants) {
    if (p.state === ParticipantState.RESPONSE_READY && p.response) {
      responses[p.id] = { name: p.name, text: p.response };
    }
  }

  if (Object.keys(responses).length < 2) {
    notifyStatus("至少需要 2 个有效回答");
    return { ok: false, error: "回答不足" };
  }

  const roundNum = StateMachine.debateSession.rounds.length + 1;
  StateMachine.debateSession.rounds.push({
    roundNum, style, guidance,
    responses: Object.fromEntries(Object.entries(responses).map(([id, r]) => [id, { name: r.name, text: r.text }]))
  });

  // 重置参与者状态为 INJECTING
  StateMachine.participants.forEach(p => {
    if (responses[p.id]) {
      p.state = ParticipantState.INJECTING;
      p.response = null;
      p.responsePreview = null;
      p.manualResponse = null;
    }
  });
  StateMachine.setFlowState(FlowState.BROADCASTING);
  notifyStatus(`第${roundNum}轮：以「${DEBATE_STYLES[style]?.name || style}」风格交叉发送...`);

  // 发送辩论 prompt
  await Promise.all(Object.keys(responses).map(async (id) => {
    const p = StateMachine.getParticipant(id);
    if (!p?.tabId) return;
    const prompt = DebateEngine.buildDebatePrompt(id, responses, style, roundNum, guidance, concise);
    try {
      const result = await chrome.tabs.sendMessage(p.tabId, { action: "inject", text: prompt });
      p.state = result.status === "error" ? ParticipantState.INJECT_FAILED : ParticipantState.INJECT_OK;
    } catch (e) {
      p.state = ParticipantState.INJECT_FAILED;
      notifyStatus(`注入 ${p.name} 失败: ${e.message}`);
    }
  }));

  StateMachine.save();
  const allOk = StateMachine.participants
    .filter(p => responses[p.id])
    .every(p => p.state === ParticipantState.INJECT_OK);
  if (allOk) {
    StateMachine.setFlowState(FlowState.AWAITING_RESPONSES);
    notifyStatus(`第${roundNum}轮辩论已发送`);
  } else {
    notifyStatus("部分发送失败，请处理后继续");
  }

  return { ok: true, roundNum };
}

// ── 辩论总结 ──

async function handleSummary(judgeId, customInstruction = "") {
  if (StateMachine.participants.length < 2) { notifyStatus("至少需要 2 个参与者"); return { ok: false }; }
  const judge = StateMachine.getParticipant(judgeId);
  if (!judge?.tabId) { notifyStatus("裁判未打开"); return { ok: false }; }

  const responses = {};
  for (const p of StateMachine.participants) {
    if (p.state === ParticipantState.RESPONSE_READY && p.response) {
      responses[p.id] = { name: p.name, text: p.response };
    }
  }
  if (Object.keys(responses).length < 2) { notifyStatus("回答不足"); return { ok: false }; }

  const prompt = DebateEngine.buildSummaryPrompt(
    StateMachine.debateSession.originalQuestion,
    StateMachine.debateSession.rounds,
    responses,
    customInstruction
  );

  StateMachine.setFlowState(FlowState.SUMMARY);
  notifyStatus(`正在由 ${judge.name} 总结...`);
  try {
    await chrome.tabs.sendMessage(judge.tabId, { action: "inject", text: prompt });
    const tab = await chrome.tabs.get(judge.tabId);
    await chrome.tabs.update(judge.tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    notifyStatus(`总结已发送给 ${judge.name}`);
    return { ok: true };
  } catch (e) { notifyStatus(`总结失败: ${e.message}`); return { ok: false }; }
}

// ── 上下文提炼 ──

async function handleContextForkActive() {
  const SUPPORTED = ["claude.ai", "gemini.google.com", "chatgpt.com", "chat.deepseek.com", "www.doubao.com", "tongyi.aliyun.com"];
  const allActive = await chrome.tabs.query({ active: true });
  let activeTab = allActive.find(t => SUPPORTED.some(s => (t.url || "").includes(s)));
  if (!activeTab) {
    const allTabs = await chrome.tabs.query({});
    activeTab = allTabs.find(t => SUPPORTED.some(s => (t.url || "").includes(s)));
  }
  if (!activeTab) return { ok: false, error: "未找到已打开的 AI 站点标签页" };
  const siteName = SUPPORTED.find(s => (activeTab.url || "").includes(s));

  let turns = [];
  try {
    const r = await chrome.tabs.sendMessage(activeTab.id, { action: "readFullConversation" });
    turns = r?.turns || [];
  } catch (e) { return { ok: false, error: "读取对话失败: " + e.message }; }
  if (!turns.length) return { ok: false, error: "未读取到对话内容" };

  const MAX_AI_LEN = 800;
  let history = "";
  let roundCount = 0;
  for (const t of turns) {
    if (t.role === "user") { history += `【用户】: ${t.text}\n\n`; roundCount++; }
    else {
      const text = t.text.length > MAX_AI_LEN ? t.text.slice(0, MAX_AI_LEN) + "...（截断）" : t.text;
      history += `【AI】: ${text}\n\n`;
    }
  }

  notifyStatus("正在注入总结请求...");
  const prompt = DebateEngine.buildContextForkPrompt(history);
  try { await chrome.tabs.sendMessage(activeTab.id, { action: "inject", text: prompt }); }
  catch (e) { return { ok: false, error: "注入失败: " + e.message }; }

  notifyStatus("等待 AI 生成摘要...");
  await new Promise(r => setTimeout(r, 3000));
  for (let i = 0; i < 60; i++) {
    try {
      const s = await chrome.tabs.sendMessage(activeTab.id, { action: "checkStreaming" });
      if (!s.streaming) break;
    } catch {}
    await new Promise(r => setTimeout(r, 1500));
  }
  await new Promise(r => setTimeout(r, 500));

  let summary = "";
  try {
    const r = await chrome.tabs.sendMessage(activeTab.id, { action: "readResponse" });
    summary = r?.text?.trim() || "";
  } catch (e) { return { ok: false, error: "读取摘要失败: " + e.message }; }
  if (!summary) return { ok: false, error: "AI 未返回摘要内容" };
  return { ok: true, prompt: summary, turns: roundCount, site: siteName };
}

// ── Prompt 优化 ──

async function handleOptimizePrompt(text, judgeId) {
  const judge = StateMachine.getParticipant(judgeId);
  if (!judge?.tabId) return { ok: false, error: "请选择优化器" };
  const prompt = DebateEngine.buildOptimizePrompt(text);
  try {
    await chrome.tabs.sendMessage(judge.tabId, { action: "inject", text: prompt });
    notifyStatus(`已发送 Prompt 优化请求给 ${judge.name}`);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ── 流式状态检查 ──

async function checkAllStreaming() {
  const statuses = {};
  await Promise.all(StateMachine.participants.map(async (p) => {
    if (!p.tabId) { statuses[p.id] = { name: p.name, status: "offline", state: p.state }; return; }
    try {
      const r = await chrome.tabs.sendMessage(p.tabId, { action: "checkStreaming" });
      const status = r.streaming ? "streaming" : "ready";
      statuses[p.id] = { name: p.name, status, state: p.state };
      // 自动更新参与者状态
      if (r.streaming && p.state === ParticipantState.INJECT_OK) {
        p.state = ParticipantState.STREAMING;
        StateMachine.save();
      }
    } catch { statuses[p.id] = { name: p.name, status: "offline", state: p.state }; }
  }));
  return statuses;
}

// ── 读取单个回答 ──

async function readOneResponse(participantId) {
  const p = StateMachine.getParticipant(participantId);
  if (!p?.tabId) return { ok: false, text: "" };
  try {
    const r = await sendMessageWithTimeout(p.tabId, { action: "readResponse" }, 30000);
    const text = r?.text || "";
    if (text) {
      StateMachine.setParticipantResponse(p.id, text);
    }
    return { ok: true, text };
  } catch (e) {
    p.state = ParticipantState.RESPONSE_FAILED;
    StateMachine.save();
    return { ok: false, text: "", error: e.message };
  }
}

// ── Tab 切换 ──

async function handleFocusTab(id) {
  const p = StateMachine.getParticipant(id);
  if (!p?.tabId) return { ok: false };
  try {
    const tab = await chrome.tabs.get(p.tabId);
    await chrome.tabs.update(p.tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return { ok: true };
  } catch { p.tabId = null; StateMachine.save(); return { ok: false }; }
}

// ── 导出 ──

function exportSession() {
  let md = `# AI Arena 辩论记录\n\n`;
  md += `**时间**: ${new Date().toLocaleString("zh-CN")}\n`;
  md += `**参与者**: ${StateMachine.participants.map(p => p.name).join(", ")}\n\n`;
  if (StateMachine.debateSession.originalQuestion) {
    md += `## 原始问题\n\n${StateMachine.debateSession.originalQuestion}\n\n`;
  }
  for (const round of StateMachine.debateSession.rounds) {
    const styleName = DEBATE_STYLES[round.style]?.name || round.style;
    md += `## 第${round.roundNum}轮 (${styleName})\n\n`;
    if (round.guidance) md += `> 用户引导：${round.guidance}\n\n`;
    for (const [pId, data] of Object.entries(round.responses)) {
      const name = data.name || (StateMachine.getParticipant(pId)?.name || pId);
      md += `### ${name}\n\n${data.text}\n\n`;
    }
    md += `---\n\n`;
  }
  return { ok: true, markdown: md };
}

// ── 工具函数 ──

async function waitForContentScript(tabId, maxRetries = 12) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await chrome.tabs.sendMessage(tabId, { action: "ping" });
      return true;
    } catch (e) {
      if (e.message && (e.message.includes("No tab") || e.message.includes("removed"))) return false;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return false;
}

async function sendMessageWithTimeout(tabId, msg, timeoutMs = 90000) {
  return Promise.race([
    chrome.tabs.sendMessage(tabId, msg),
    new Promise((_, reject) => setTimeout(() => reject(new Error("消息超时")), timeoutMs))
  ]);
}

function notifyStatus(message) { chrome.runtime.sendMessage({ type: "status", message }).catch(() => {}); }
```

- [ ] **Step 2: Commit**

```bash
git add background.js
git commit -m "refactor: rewrite background.js as thin router with state machine"
```

---

### Task 6: 重写 sidepanel — 状态卡片 + 确认面板 + 手动介入

**Files:**
- Modify: `sidepanel.html`
- Modify: `sidepanel.css`
- Modify: `sidepanel.js`

这是最大的 UI 改造任务。需要：
1. 参与者列表从静态改为实时状态卡片
2. 增加汇总确认面板
3. 增加手动粘贴弹框
4. 流式轮询结束后自动进入确认面板
5. 门控按钮交互

- [ ] **Step 1: 修改 sidepanel.html — 增加确认面板 DOM**

在 `<!-- 辩论 -->` section 的 `debate-wizard` div 之后、`details` 之前，插入确认面板：

```html
    <!-- 确认面板（门控2/4） -->
    <div id="confirm-panel" class="confirm-panel" style="display:none">
      <div class="confirm-header">回复确认</div>
      <div id="confirm-cards"></div>
      <div class="confirm-actions">
        <button class="btn btn-primary" id="btn-confirm-ready" disabled>全部就绪，开始辩论</button>
        <button class="btn btn-secondary" id="btn-confirm-wait">全部继续等待</button>
      </div>
    </div>
    <!-- 手动粘贴弹框 -->
    <div id="paste-modal" class="paste-modal" style="display:none">
      <div class="paste-modal-content">
        <div class="paste-modal-header">
          <span id="paste-modal-title">手动粘贴回复</span>
          <button id="paste-modal-close" class="p-btn">✕</button>
        </div>
        <textarea id="paste-textarea" class="paste-textarea" placeholder="从 AI 页面复制回复，粘贴到这里..."></textarea>
        <button class="btn btn-primary" id="btn-paste-confirm" style="margin-top:8px;width:100%">确认</button>
      </div>
    </div>
```

- [ ] **Step 2: 修改 sidepanel.css — 增加样式**

在 CSS 末尾追加：

```css
/* ── 确认面板 ── */
.confirm-panel {
  margin-top: 10px; background: #f0f4ff; border: 1.5px solid #c7d2fe;
  border-radius: 10px; padding: 10px; animation: slideIn 0.2s ease;
}
@keyframes slideIn { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:translateY(0); } }
.confirm-header { font-size: 12px; font-weight: 700; color: #4f46e5; margin-bottom: 8px; }
.confirm-card {
  display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px;
  background: #fff; border-radius: 8px; border: 1px solid #e5e7eb;
  margin-bottom: 6px; font-size: 12px;
}
.confirm-card .cc-status { font-size: 14px; flex-shrink: 0; margin-top: 2px; }
.confirm-card .cc-info { flex: 1; min-width: 0; }
.confirm-card .cc-name { font-weight: 600; color: #333; }
.confirm-card .cc-preview { color: #888; font-size: 11px; margin-top: 2px; line-height: 1.4; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.confirm-card .cc-suspicious { color: #f59e0b; font-size: 10px; font-weight: 600; }
.confirm-card .cc-actions { display: flex; gap: 4px; flex-shrink: 0; }
.confirm-card .cc-btn { padding: 3px 8px; font-size: 10px; border-radius: 4px; border: 1px solid #d1d5db; background: #f9fafb; color: #555; cursor: pointer; white-space: nowrap; }
.confirm-card .cc-btn:hover { background: #e8e9ed; }
.confirm-card .cc-btn.cc-btn-paste { border-color: #6366f1; color: #6366f1; }
.confirm-actions { display: flex; gap: 6px; margin-top: 8px; }
.confirm-actions .btn { flex: 1; font-size: 12px; padding: 8px; }

/* ── 手动粘贴弹框 ── */
.paste-modal {
  position: fixed; top: 0; left: 0; width: 100%; height: 100%;
  background: rgba(0,0,0,0.3); display: flex; align-items: center;
  justify-content: center; z-index: 100;
}
.paste-modal-content {
  background: #fff; border-radius: 12px; padding: 16px; width: 90%;
  max-width: 400px; box-shadow: 0 8px 24px rgba(0,0,0,0.15);
}
.paste-modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; font-weight: 600; color: #333; }
.paste-textarea {
  width: 100%; min-height: 120px; padding: 10px; border: 1.5px solid #e5e7eb;
  border-radius: 8px; font-size: 12px; resize: vertical; outline: none;
  font-family: inherit;
}
.paste-textarea:focus { border-color: #6366f1; }

/* ── 状态卡片增强 ── */
.participant-item .p-state-badge {
  font-size: 9px; padding: 1px 6px; border-radius: 4px; font-weight: 600;
}
.p-state-badge.injecting { background: #fef3c7; color: #92400e; }
.p-state-badge.inject-ok { background: #d1fae5; color: #065f46; }
.p-state-badge.inject-failed { background: #fee2e2; color: #991b1b; }
.p-state-badge.streaming { background: #fef3c7; color: #92400e; }
.p-state-badge.response-ready { background: #d1fae5; color: #065f46; }
.p-state-badge.response-failed { background: #fee2e2; color: #991b1b; }

/* 门控1 操作按钮 */
.p-gate-actions { display: flex; gap: 3px; }
.p-gate-btn { padding: 2px 6px; font-size: 9px; border-radius: 4px; border: 1px solid #d1d5db; background: #f9fafb; color: #555; cursor: pointer; }
.p-gate-btn:hover { background: #e8e9ed; }
```

- [ ] **Step 3: 重写 sidepanel.js — 集成状态机 UI**

完整替换 sidepanel.js。关键改动点：
- `renderParticipants()` 改为根据 `p.state` 渲染状态卡片和门控按钮
- 新增 `showConfirmPanel()` / `hideConfirmPanel()` 管理确认面板
- 新增 `openPasteModal(participantId)` 管理手动粘贴
- 流式轮询结束后自动读取回复并触发确认面板
- `updateWizard()` 根据 FlowState 更新向导文字

由于 sidepanel.js 改动量大（585 行全面改造），以下列出完整代码：

```js
// AI Arena — Side Panel v6.0 (状态机驱动)

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const logEl = $("#log"), listEl = $("#participant-list"), countEl = $("#participant-count");
const judgeSelect = $("#judge-select");
const broadcastInput = $("#broadcast-input"), btnSend = $("#btn-send");
const btnDebate = $("#btn-debate"), btnSummary = $("#btn-summary"), btnDebateRetry = $("#btn-debate-retry");
const customInstruction = $("#custom-instruction"), presetSelect = $("#preset-select");
const guidanceInput = $("#guidance-input"), roundBadge = $("#round-badge");
const confirmPanel = $("#confirm-panel"), confirmCards = $("#confirm-cards");
const btnConfirmReady = $("#btn-confirm-ready"), btnConfirmWait = $("#btn-confirm-wait");
const pasteModal = $("#paste-modal"), pasteTextarea = $("#paste-textarea");

let participants = [], debateSession = {}, flowState = "idle", streamingPollTimer = null;
let currentPasteParticipantId = null;

// ── 状态标签映射 ──
const STATE_LABELS = {
  idle: "", injecting: "注入中", inject_ok: "已发送", inject_failed: "发送失败",
  streaming: "生成中", response_ready: "回复就绪", response_failed: "读取失败"
};
const STATE_ICONS = {
  idle: "", injecting: "⏳", inject_ok: "✅", inject_failed: "❌",
  streaming: "⏳", response_ready: "✅", response_failed: "❌"
};

function setEditorText(text) {
  broadcastInput.innerText = text;
  const range = document.createRange();
  range.selectNodeContents(broadcastInput);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  broadcastInput.focus();
}
function getDebateRound() { return debateSession?.rounds?.length || 0; }

const BUILTIN_PRESETS = { table: "请用表格对比各方观点，列出各自的优缺点", tech: "重点分析技术可行性和具体实现方案", invest: "从投资角度分析，关注风险、收益和仓位建议", academic: "以学术标准评价各方论证的严谨性", action: "只输出可直接执行的行动清单" };

// ── 日志 ──
function addLog(msg, type = "info") {
  const e = document.createElement("div");
  e.className = `entry ${type}`;
  e.textContent = `[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${msg}`;
  logEl.prepend(e);
  while (logEl.children.length > 50) logEl.lastChild.remove();
}

// ── 渲染参与者（状态卡片） ──
function renderParticipants() {
  countEl.textContent = participants.length;
  const rounds = debateSession?.rounds?.length || 0;
  if (rounds > 0) { roundBadge.style.display = ""; roundBadge.textContent = `第${rounds}轮`; }
  else { roundBadge.style.display = "none"; }

  if (!participants.length) {
    listEl.innerHTML = '<div class="empty-hint">选择预设或手动添加参与者</div>';
  } else {
    listEl.innerHTML = participants.map(p => {
      const pState = p.state || "idle";
      const sc = pState === "streaming" ? "streaming" : (p.tabId ? (pState === "response_ready" ? "ready" : "ready") : "offline");
      const stateLabel = STATE_LABELS[pState] || "";
      const stateIcon = STATE_ICONS[pState] || "";

      // 门控1：发送失败时显示操作按钮
      let gateActions = "";
      if (pState === "inject_failed" && (flowState === "broadcasting")) {
        gateActions = `<div class="p-gate-actions">
          <button class="p-gate-btn" data-action="retry" data-id="${p.id}">重试</button>
          <button class="p-gate-btn" data-action="manual-send" data-id="${p.id}">已手动发送</button>
          <button class="p-gate-btn" data-action="skip" data-id="${p.id}">跳过</button>
        </div>`;
      }

      return `<div class="participant-item ${p.service}">
        <span class="p-status ${sc}"></span>
        <span class="p-name">${p.name}</span>
        ${stateLabel ? `<span class="p-state-badge ${pState.replace(/_/g, '-')}">${stateIcon} ${stateLabel}</span>` : `<span class="p-status-text">${sc === "offline" ? "离线" : ""}</span>`}
        ${gateActions}
        ${!gateActions ? (sc === "offline" ? '' : `<button class="p-btn p-focus" data-id="${p.id}">👁</button>`) : ''}
        <button class="p-btn p-remove" data-id="${p.id}">✕</button>
      </div>`;
    }).join("");

    // 事件绑定
    listEl.querySelectorAll(".p-focus").forEach(b => b.addEventListener("click", () => chrome.runtime.sendMessage({ type: "focusTab", id: b.dataset.id })));
    listEl.querySelectorAll(".p-remove").forEach(b => b.addEventListener("click", () => chrome.runtime.sendMessage({ type: "removeParticipant", id: b.dataset.id })));

    // 门控1 按钮
    listEl.querySelectorAll(".p-gate-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const { action, id } = btn.dataset;
        if (action === "retry") {
          addLog("重试注入...", "info");
          await chrome.runtime.sendMessage({ type: "retryInject", id });
        } else if (action === "manual-send") {
          await chrome.runtime.sendMessage({ type: "confirmManualSend", id });
          addLog("已标记为手动发送", "info");
        } else if (action === "skip") {
          await chrome.runtime.sendMessage({ type: "skipParticipant", id });
          addLog("已跳过", "info");
        }
        // 检查是否所有门控1都已处理
        checkGate1Complete();
      });
    });
  }

  // 更新裁判下拉
  [judgeSelect].forEach(sel => {
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">选择裁判...</option>' + participants.map(p => `<option value="${p.id}">${p.name}</option>`).join("");
    if (cur && participants.find(p => p.id === cur)) sel.value = cur;
  });
}

// 门控1完成检查：所有参与者都不再是 INJECT_FAILED → 自动进入 AWAITING_RESPONSES
function checkGate1Complete() {
  if (flowState !== "broadcasting") return;
  const hasFailure = participants.some(p => p.state === "inject_failed");
  if (!hasFailure) {
    chrome.runtime.sendMessage({ type: "continueWaiting" });
    addLog("所有参与者已就绪，开始等待回复...", "success");
  }
}

// ── 确认面板（门控2/4） ──
function showConfirmPanel() {
  confirmPanel.style.display = "";
  confirmCards.innerHTML = participants.map(p => {
    const isReady = p.state === "response_ready";
    const isFailed = p.state === "response_failed";
    const suspicious = p.suspicious;
    const statusIcon = isReady ? (suspicious ? "⚠️" : "✅") : (isFailed ? "❌" : "⏳");
    const statusText = isReady ? (suspicious ? "疑似不完整" : "回复就绪") : (isFailed ? "读取失败" : "等待中");

    return `<div class="confirm-card">
      <span class="cc-status">${statusIcon}</span>
      <div class="cc-info">
        <div class="cc-name">${p.name}</div>
        ${isReady && p.responsePreview ? `<div class="cc-preview">${p.responsePreview}${p.responsePreview.length >= 100 ? '...' : ''}</div>` : ''}
        ${suspicious ? `<div class="cc-suspicious">回复较短，请确认是否完整</div>` : ''}
      </div>
      <div class="cc-actions">
        ${isReady || isFailed ? `<button class="cc-btn" data-action="continue-wait" data-id="${p.id}">继续等</button>` : ''}
        ${isFailed || suspicious ? `<button class="cc-btn cc-btn-paste" data-action="paste" data-id="${p.id}">手动粘贴</button>` : ''}
        ${isFailed ? `<button class="cc-btn" data-action="skip-confirm" data-id="${p.id}">跳过</button>` : ''}
      </div>
    </div>`;
  }).join("");

  // 更新确认按钮状态
  const validCount = participants.filter(p => p.state === "response_ready").length;
  btnConfirmReady.disabled = validCount < 2;
  btnConfirmReady.textContent = validCount >= 2 ? `全部就绪，开始辩论 (${validCount}个有效)` : "至少需要 2 个有效回复";

  // 确认面板按钮事件
  confirmCards.querySelectorAll(".cc-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const { action, id } = btn.dataset;
      if (action === "continue-wait") {
        await chrome.runtime.sendMessage({ type: "continueWaiting", id });
        hideConfirmPanel();
        startStreamingPoll();
        addLog(`${participants.find(p => p.id === id)?.name || id} 继续等待`, "info");
      } else if (action === "paste") {
        openPasteModal(id);
      } else if (action === "skip-confirm") {
        await chrome.runtime.sendMessage({ type: "skipParticipant", id });
        // 刷新确认面板
        const state = await chrome.runtime.sendMessage({ type: "getState" });
        if (state) { participants = state.participants; debateSession = state.debateSession; flowState = state.flowState; }
        showConfirmPanel();
      }
    });
  });
}

function hideConfirmPanel() {
  confirmPanel.style.display = "none";
}

// ── 手动粘贴弹框 ──
function openPasteModal(participantId) {
  currentPasteParticipantId = participantId;
  const p = participants.find(p => p.id === participantId);
  $("#paste-modal-title").textContent = `手动粘贴 ${p?.name || ''} 的回复`;
  pasteTextarea.value = "";
  pasteModal.style.display = "flex";
  pasteTextarea.focus();
}

function closePasteModal() {
  pasteModal.style.display = "none";
  currentPasteParticipantId = null;
}

$("#paste-modal-close").addEventListener("click", closePasteModal);
pasteModal.addEventListener("click", (e) => { if (e.target === pasteModal) closePasteModal(); });

$("#btn-paste-confirm").addEventListener("click", async () => {
  const text = pasteTextarea.value.trim();
  if (!text) { addLog("请粘贴回复内容", "error"); return; }
  await chrome.runtime.sendMessage({ type: "manualPaste", id: currentPasteParticipantId, text });
  addLog(`已手动粘贴 ${participants.find(p => p.id === currentPasteParticipantId)?.name || ''} 的回复`, "success");
  closePasteModal();
  // 刷新确认面板
  const state = await chrome.runtime.sendMessage({ type: "getState" });
  if (state) { participants = state.participants; debateSession = state.debateSession; flowState = state.flowState; }
  showConfirmPanel();
});

// ── 确认面板按钮 ──
btnConfirmReady.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "confirmAllReady" });
  hideConfirmPanel();
  addLog("确认就绪，进入辩论", "success");
  updateWizard("ready");
});

btnConfirmWait.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "continueWaiting" });
  hideConfirmPanel();
  startStreamingPoll();
  addLog("继续等待所有 AI 回复...", "info");
});

// ── 流式轮询（带确认门控） ──
let pollStartTime = 0, pollErrorCount = 0, pollReadyCount = 0, pollEverStreaming = false;
const POLL_MAX_DURATION = 10 * 60 * 1000;
const POLL_MAX_ERRORS = 10;
const POLL_READY_THRESHOLD = 4;
const POLL_INITIAL_DELAY = 4000;

function startStreamingPoll() {
  stopStreamingPoll();
  pollStartTime = Date.now();
  pollErrorCount = 0;
  pollReadyCount = 0;
  pollEverStreaming = false;
  setTimeout(() => {
    if (!streamingPollTimer) return;
    streamingPollTimer = setInterval(async () => {
      if (Date.now() - pollStartTime > POLL_MAX_DURATION) {
        addLog("轮询超时（10分钟），已自动停止", "error");
        stopStreamingPoll();
        return;
      }
      try {
        const s = await chrome.runtime.sendMessage({ type: "checkAllStreaming" });
        pollErrorCount = 0;
        renderParticipants();
        const hasOnline = Object.values(s).some(v => v.status !== "offline");
        const isStreaming = Object.values(s).some(v => v.status === "streaming");
        if (isStreaming) pollEverStreaming = true;
        const gracePeriodPassed = Date.now() - pollStartTime > 19000;
        if (!isStreaming && hasOnline && (pollEverStreaming || gracePeriodPassed)) {
          pollReadyCount++;
          if (pollReadyCount >= POLL_READY_THRESHOLD) {
            addLog("所有 AI 已回答完毕，读取回复...", "success");
            stopStreamingPoll();
            // 读取所有回复
            await readAllResponses();
            // 弹出确认面板（门控2/4）
            showConfirmPanel();
            if (Notification.permission === "granted") {
              try { new Notification("AI Arena", { body: "所有 AI 已回答完毕，请确认", icon: "icons/icon128.png" }); } catch {}
            }
          }
        } else { pollReadyCount = 0; }
      } catch (e) {
        pollErrorCount++;
        if (pollErrorCount >= POLL_MAX_ERRORS) {
          addLog(`轮询连续失败 ${POLL_MAX_ERRORS} 次，已停止`, "error");
          stopStreamingPoll();
        }
      }
    }, 2500);
  }, POLL_INITIAL_DELAY);
  streamingPollTimer = -1;
}
function stopStreamingPoll() {
  if (streamingPollTimer && streamingPollTimer !== -1) clearInterval(streamingPollTimer);
  streamingPollTimer = null;
}

// 读取所有参与者的回复
async function readAllResponses() {
  for (const p of participants) {
    if (p.state === "inject_ok" || p.state === "streaming") {
      try {
        await chrome.runtime.sendMessage({ type: "readOneResponse", participantId: p.id });
      } catch (e) {
        addLog(`读取 ${p.name} 失败: ${e.message}`, "error");
      }
    }
  }
  // 刷新状态
  const state = await chrome.runtime.sendMessage({ type: "getState" });
  if (state) { participants = state.participants; debateSession = state.debateSession; flowState = state.flowState; }
  renderParticipants();
}

// ── 消息监听 ──
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "status") addLog(msg.message);
  if (msg.type === "stateUpdate") {
    participants = msg.participants;
    debateSession = msg.debateSession || {};
    flowState = msg.flowState || "idle";
    renderParticipants();
    updateWizard(flowState);
  }
  if (msg.type === "selectorWarning") {
    addLog(`⚠️ ${msg.message}`, "error");
  }
  if (msg.type === "contextMenuText") {
    const text = msg.text || "";
    if (text) { setEditorText(text); addLog("已从网页获取选中文本 (" + text.length + " 字)", "info"); }
  }
});

// 初始化
(async () => {
  try {
    const r = await chrome.runtime.sendMessage({ type: "getState" });
    if (r) { participants = r.participants; debateSession = r.debateSession || {}; flowState = r.flowState || "idle"; renderParticipants(); updateWizard(flowState); }
  } catch {}
  try {
    const s = await chrome.storage.local.get(["customPresets", "lastCustomInstruction"]);
    if (s.lastCustomInstruction && customInstruction) customInstruction.value = s.lastCustomInstruction;
    if (s.customPresets) renderCustomPresets(s.customPresets);
  } catch {}
})();

// 定期刷新
setInterval(async () => {
  try {
    const r = await chrome.runtime.sendMessage({ type: "getState" });
    if (r) {
      participants = r.participants; debateSession = r.debateSession || {};
      flowState = r.flowState || "idle";
      if (!streamingPollTimer) renderParticipants();
    }
  } catch {}
}, 5000);

// ── 预设 ──
$$(".btn-preset").forEach(b => b.addEventListener("click", async () => {
  addLog(`加载预设: ${b.textContent}...`);
  await chrome.runtime.sendMessage({ type: "loadPreset", presetId: b.dataset.preset });
}));

// ── 添加参与者 ──
$$(".btn-add").forEach(b => b.addEventListener("click", async () => {
  if (participants.length >= 3) { addLog("最多 3 个参与者", "error"); return; }
  addLog(`添加 ${b.dataset.service}...`);
  await chrome.runtime.sendMessage({ type: "addParticipant", service: b.dataset.service });
}));

// ── 打开全部 ──
$("#btn-open-all").addEventListener("click", async () => { addLog("打开全部..."); await chrome.runtime.sendMessage({ type: "openAll" }); });

// ── 文件管理 ──
let pendingImages = [], pendingFiles = [];
const imagePreviews = $("#image-previews");
const fileInput = $("#file-input");

function addImage(dataUrl) { pendingImages.push(dataUrl); renderFilePreviews(); }
function addTextFile(name, content) { pendingFiles.push({ name, content }); renderFilePreviews(); }
function removeAttachment(type, index) {
  if (type === "img") pendingImages.splice(index, 1);
  else pendingFiles.splice(index, 1);
  renderFilePreviews();
}

function renderFilePreviews() {
  let html = "";
  pendingImages.forEach((dataUrl, i) => { html += `<div class="img-preview"><img src="${dataUrl}"><button class="img-remove" data-type="img" data-idx="${i}">✕</button></div>`; });
  pendingFiles.forEach((f, i) => { html += `<div class="img-preview file-preview"><span class="file-icon">📄</span><span class="file-name">${f.name.length > 12 ? f.name.slice(0, 10) + '...' : f.name}</span><button class="img-remove" data-type="file" data-idx="${i}">✕</button></div>`; });
  imagePreviews.innerHTML = html;
  imagePreviews.querySelectorAll(".img-remove").forEach(btn => { btn.addEventListener("click", () => removeAttachment(btn.dataset.type, parseInt(btn.dataset.idx))); });
}

function fileToDataUrl(file) { return new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsDataURL(file); }); }
function fileToText(file) { return new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsText(file); }); }
function isImageFile(file) { return file.type.startsWith("image/"); }

broadcastInput.addEventListener("paste", async (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) { addImage(await fileToDataUrl(file)); addLog("已粘贴图片", "info"); }
    }
  }
});

fileInput.addEventListener("change", async () => {
  for (const file of fileInput.files) {
    if (isImageFile(file)) { addImage(await fileToDataUrl(file)); }
    else {
      try {
        const content = await fileToText(file);
        addTextFile(file.name, content);
        addLog(`已添加文件: ${file.name} (${(content.length / 1024).toFixed(1)}KB)`, "info");
      } catch { addLog(`无法读取文件: ${file.name}`, "error"); }
    }
  }
  fileInput.value = "";
});

broadcastInput.addEventListener("input", () => {
  broadcastInput.querySelectorAll("img").forEach(img => { if (img.src.startsWith("data:")) { addImage(img.src); img.remove(); } });
});

// ── 广播 ──
async function doBroadcast() {
  let text = broadcastInput.innerText.trim();
  const hasImages = pendingImages.length > 0;
  const hasFiles = pendingFiles.length > 0;
  if (!text && !hasImages && !hasFiles) return;
  if (!participants.length) { addLog("请先添加参与者", "error"); return; }
  if (hasFiles) {
    text += pendingFiles.map(f => `\n\n---\n📄 文件: ${f.name}\n\`\`\`\n${f.content}\n\`\`\``).join("");
  }
  btnSend.disabled = true; btnSend.textContent = "发送中...";
  hideConfirmPanel();
  const attachInfo = [];
  if (hasImages) attachInfo.push(`${pendingImages.length}张图`);
  if (hasFiles) attachInfo.push(`${pendingFiles.length}个文件`);
  addLog("广播: " + text.slice(0, 50) + (text.length > 50 ? "..." : "") + (attachInfo.length ? ` (+${attachInfo.join(", ")})` : ""));

  try {
    const r = await chrome.runtime.sendMessage({ type: "broadcast", text, images: hasImages ? pendingImages : undefined });
    if (r) for (const [, v] of Object.entries(r)) addLog(`${v.name}: ${v.status}${v.error ? " - " + v.error : ""}`, v.status === "sent" ? "success" : "error");
    broadcastInput.innerHTML = "";
    pendingImages = [];
    pendingFiles = [];
    renderFilePreviews();
    // 刷新状态
    const state = await chrome.runtime.sendMessage({ type: "getState" });
    if (state) { participants = state.participants; flowState = state.flowState; }
    renderParticipants();
    // 如果自动进入了 awaiting，开始轮询
    if (flowState === "awaiting_responses") {
      startStreamingPoll();
    }
  } catch (e) { addLog("失败: " + e.message, "error"); }
  btnSend.disabled = false; btnSend.textContent = "发送给全部";
}
btnSend.addEventListener("click", doBroadcast);
broadcastInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); doBroadcast(); } });

// ── 辩论模式切换 ──
let debateMode = "free";
$$(".mode-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    $$(".mode-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    debateMode = btn.dataset.mode;
  });
});

// ── 辩论 ──
btnDebate.addEventListener("click", async () => {
  if (participants.length < 2) { addLog("至少需要 2 个参与者", "error"); return; }
  const nextRound = getDebateRound() + 1;
  btnDebate.disabled = true; btnDebate.textContent = `第${nextRound}轮...`;
  hideConfirmPanel();
  const guidance = guidanceInput?.value?.trim() || "";
  addLog(`第${nextRound}轮辩论${guidance ? " (引导: " + guidance.slice(0, 30) + ")" : ""}`, "info");
  try {
    const concise = $("#concise-mode")?.checked || false;
    const r = await chrome.runtime.sendMessage({ type: "debateRound", style: debateMode, guidance, concise });
    if (r?.ok) {
      addLog(`第${nextRound}轮已发送`, "success");
      // 刷新状态
      const state = await chrome.runtime.sendMessage({ type: "getState" });
      if (state) { participants = state.participants; flowState = state.flowState; }
      renderParticipants();
      if (flowState === "awaiting_responses") startStreamingPoll();
      if (guidance && guidanceInput) guidanceInput.value = "";
    } else addLog(`失败: ${r?.error}`, "error");
  } catch (e) { addLog("失败: " + e.message, "error"); }
  btnDebate.disabled = false; btnDebate.textContent = `开始辩论（第${getDebateRound() + 1}轮）`;
});

// ── 辩论重试 ──
btnDebateRetry.addEventListener("click", async () => {
  stopStreamingPoll();
  hideConfirmPanel();
  btnDebate.disabled = false;
  btnDebate.textContent = `开始辩论（第${getDebateRound() + 1}轮）`;
  btnSend.disabled = false;
  btnSend.textContent = "发送给全部";
  await chrome.runtime.sendMessage({ type: "resetSession" });
  updateWizard("idle");
  addLog("已重置辩论状态，可以重试", "info");
});

// ── 上下文提炼 ──
$("#btn-ctx-fork").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true; btn.textContent = "⏳ AI 提炼中...";
  const preview = $("#ctx-fork-preview");
  preview.style.display = "none";
  addLog("正在读取对话并请求 AI 提炼摘要...", "info");
  const r = await chrome.runtime.sendMessage({ type: "contextForkActive" });
  if (r?.ok) {
    await navigator.clipboard.writeText(r.prompt);
    addLog(`已提炼 ${r.turns} 轮对话，摘要已复制到剪贴板 ✓`, "success");
    preview.style.display = "block";
    preview.textContent = r.prompt.slice(0, 300) + (r.prompt.length > 300 ? "..." : "");
  } else { addLog(`提炼失败: ${r?.error}`, "error"); }
  btn.disabled = false; btn.textContent = "📋 提炼当前页面并复制";
});

// ── 辩论总结 ──
btnSummary.addEventListener("click", async () => {
  const judgeId = judgeSelect.value;
  if (!judgeId) { addLog("请先选择裁判", "error"); return; }
  const ci = customInstruction?.value?.trim() || "";
  if (ci) chrome.storage.local.set({ lastCustomInstruction: ci });
  btnSummary.disabled = true; btnSummary.textContent = "总结中...";
  addLog("生成总结..." + (ci ? " (含自定义指令)" : ""), "info");
  try {
    const r = await chrome.runtime.sendMessage({ type: "summary", judgeId, customInstruction: ci });
    if (r?.ok) { addLog("总结已发送", "success"); startStreamingPoll(); }
    else addLog(`失败: ${r?.error}`, "error");
  } catch (e) { addLog("失败: " + e.message, "error"); }
  btnSummary.disabled = false; btnSummary.textContent = "输出总结";
});

// ── 常用指令 ──
presetSelect.addEventListener("change", () => {
  const v = presetSelect.value;
  if (BUILTIN_PRESETS[v]) customInstruction.value = BUILTIN_PRESETS[v];
  else if (v.startsWith("custom_")) chrome.storage.local.get("customPresets", d => { if (d.customPresets?.[v]) customInstruction.value = d.customPresets[v]; });
  presetSelect.value = "";
});

$("#btn-save-preset").addEventListener("click", async () => {
  const text = customInstruction.value.trim();
  if (!text) { addLog("请先输入指令", "error"); return; }
  const key = "custom_" + Date.now();
  const d = await chrome.storage.local.get("customPresets");
  const p = d.customPresets || {};
  p[key] = text;
  await chrome.storage.local.set({ customPresets: p });
  renderCustomPresets(p);
  addLog("已保存常用指令", "success");
});

function renderCustomPresets(presets) {
  presetSelect.querySelectorAll('option[value^="custom_"]').forEach(o => o.remove());
  for (const [k, t] of Object.entries(presets)) {
    const o = document.createElement("option");
    o.value = k; o.textContent = "📌 " + t.slice(0, 20) + (t.length > 20 ? "..." : "");
    presetSelect.appendChild(o);
  }
}

// ── 重置 ──
$("#btn-reset").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "resetSession" });
  stopStreamingPoll();
  hideConfirmPanel();
  addLog("会话已重置", "info");
  btnDebate.textContent = "开始辩论";
  updateWizard("idle");
  renderParticipants();
});

// ── 彻底重置 ──
$("#btn-hard-reset").addEventListener("click", async () => {
  for (const p of participants) {
    if (p.tabId) { try { await chrome.tabs.remove(p.tabId); } catch {} }
  }
  await chrome.runtime.sendMessage({ type: "hardReset" });
  stopStreamingPoll();
  hideConfirmPanel();
  participants = [];
  debateSession = {};
  flowState = "idle";
  pendingImages = [];
  pendingFiles = [];
  renderFilePreviews();
  broadcastInput.innerHTML = "";
  btnDebate.textContent = "开始辩论";
  btnSend.disabled = false;
  btnSend.textContent = "发送给全部";
  btnSummary.disabled = false;
  btnSummary.textContent = "输出总结";
  updateWizard("idle");
  renderParticipants();
  addLog("已彻底重置，所有状态已清除", "success");
});

// ── Prompt 模板库 ──
const BUILTIN_TEMPLATES = [
  { id: "t_code_review", name: "代码审查", icon: "🔍", content: "请审查以下代码，关注：1) 潜在 bug 2) 性能问题 3) 安全隐患 4) 代码风格\n\n{{问题}}" },
  { id: "t_solution", name: "方案评估", icon: "⚖️", content: "请从技术可行性、成本、风险、可维护性等角度评估以下方案：\n\n{{问题}}" },
  { id: "t_translate", name: "翻译润色", icon: "🌐", content: "请将以下内容翻译为流畅地道的中文/英文，保持专业术语准确：\n\n{{问题}}" },
  { id: "t_brainstorm", name: "头脑风暴", icon: "💡", content: "请围绕以下主题进行发散思考，给出至少5个不同角度的创意或方案：\n\n{{问题}}" },
  { id: "t_swot", name: "SWOT分析", icon: "📊", content: "请对以下内容进行 SWOT 分析（优势、劣势、机会、威胁），用表格呈现：\n\n{{问题}}" },
  { id: "t_explain", name: "深入讲解", icon: "📖", content: "请用通俗易懂的方式深入解释以下概念，使用类比和具体例子：\n\n{{问题}}" },
  { id: "t_debug", name: "问题诊断", icon: "🐛", content: "以下代码/系统出现了问题，请分析可能的原因并给出修复方案：\n\n{{问题}}" },
  { id: "t_summary", name: "内容总结", icon: "📝", content: "请总结以下内容的核心要点，用结构化的方式呈现（要点不超过5条）：\n\n{{问题}}" },
];

const templateList = $("#template-list");

async function loadTemplates() {
  const data = await chrome.storage.local.get("userTemplates");
  const userTpls = data.userTemplates || [];
  const allTpls = [...BUILTIN_TEMPLATES, ...userTpls];
  templateList.innerHTML = allTpls.map(t => `
    <div class="tpl-item" data-id="${t.id}">
      <span class="tpl-icon">${t.icon || '📄'}</span>
      <span class="tpl-name">${t.name}</span>
      ${t.id.startsWith("t_user_") ? `<button class="tpl-del" data-id="${t.id}">✕</button>` : ''}
    </div>
  `).join("");
  templateList.querySelectorAll(".tpl-item").forEach(item => {
    item.addEventListener("click", (e) => {
      if (e.target.classList.contains("tpl-del")) return;
      const tpl = allTpls.find(t => t.id === item.dataset.id);
      if (!tpl) return;
      const currentText = broadcastInput.innerText.trim();
      setEditorText(tpl.content.replace("{{问题}}", currentText || "[在此输入具体内容]"));
      addLog(`已加载模板: ${tpl.name}`, "info");
    });
  });
  templateList.querySelectorAll(".tpl-del").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const data = await chrome.storage.local.get("userTemplates");
      const tpls = (data.userTemplates || []).filter(t => t.id !== btn.dataset.id);
      await chrome.storage.local.set({ userTemplates: tpls });
      loadTemplates();
      addLog("已删除模板", "info");
    });
  });
}

$("#btn-save-tpl").addEventListener("click", async () => {
  const name = $("#tpl-name").value.trim();
  const content = $("#tpl-content").value.trim();
  if (!name || !content) { addLog("请填写模板名称和内容", "error"); return; }
  const data = await chrome.storage.local.get("userTemplates");
  const tpls = data.userTemplates || [];
  tpls.push({ id: "t_user_" + Date.now(), name, icon: "📌", content });
  await chrome.storage.local.set({ userTemplates: tpls });
  $("#tpl-name").value = "";
  $("#tpl-content").value = "";
  loadTemplates();
  addLog(`已保存模板: ${name}`, "success");
});

loadTemplates();

// ── Prompt 优化 ──
const btnOptimize = $("#btn-optimize");
btnOptimize.addEventListener("click", async () => {
  const text = broadcastInput.innerText.trim();
  if (!text) { addLog("请先输入 Prompt", "error"); return; }
  if (!participants.length) { addLog("请先添加参与者", "error"); return; }
  const judge = participants.find(p => p.tabId);
  if (!judge) { addLog("没有在线参与者", "error"); return; }
  btnOptimize.disabled = true; btnOptimize.textContent = "⏳";
  addLog(`正在由 ${judge.name} 优化 Prompt...`, "info");
  const r = await chrome.runtime.sendMessage({ type: "optimizePrompt", text, judgeId: judge.id });
  if (!r?.ok) { addLog(`失败: ${r?.error}`, "error"); btnOptimize.disabled = false; btnOptimize.textContent = "✨ 优化"; return; }
  addLog("等待优化结果...", "info");
  await new Promise(resolve => setTimeout(resolve, 3000));
  for (let i = 0; i < 60; i++) {
    try {
      const s = await chrome.runtime.sendMessage({ type: "checkAllStreaming" });
      const judgeStatus = s[judge.id];
      if (judgeStatus && judgeStatus.status !== "streaming") break;
    } catch {}
    await new Promise(r => setTimeout(r, 2000));
  }
  const resp = await chrome.runtime.sendMessage({ type: "readOneResponse", participantId: judge.id });
  if (resp?.ok && resp.text) { setEditorText(resp.text.trim()); addLog("Prompt 已优化并填回输入框", "success"); }
  else { addLog("未读取到结果，请手动查看 AI 页面", "error"); }
  btnOptimize.disabled = false; btnOptimize.textContent = "✨ 优化";
});

// ── 辩论向导（FlowState 驱动） ──
const wizardEl = $("#debate-wizard");
function updateWizard(state) {
  if (!wizardEl) return;
  const steps = {
    idle: "① 先发送问题 → ② 等待回答完成 → ③ 点击辩论",
    broadcasting: "① ⏳ 发送中... → ② 等待回答 → ③ 辩论",
    awaiting_responses: "① ✅ 已发送 → ② ⏳ 等待回答中... → ③ 辩论",
    confirming: "① ✅ → ② ✅ 回答已收集 → <b>③ 请确认后开始辩论</b>",
    debating: "① ✅ → ② ✅ → ③ ⏳ 辩论进行中...",
    ready: "① ✅ 问题已发送 → ② ✅ 回答已完成 → <b>③ 现在可以辩论了！</b>",
    summary: "① ✅ → ② ✅ → ③ ✅ → 📝 总结中...",
  };
  wizardEl.innerHTML = steps[state] || steps.idle;
}

// ── 通知权限 ──
if ("Notification" in window) Notification.requestPermission();

// ── 快捷键 ──
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === "D") { e.preventDefault(); btnDebate.click(); }
});
```

- [ ] **Step 4: Commit**

```bash
git add sidepanel.html sidepanel.css sidepanel.js
git commit -m "feat: add confirmation panel, status cards, and manual intervention UI"
```

---

### Task 7: 改造 Content Scripts — 从 SelectorManager 获取选择器 + 启发式兜底

**Files:**
- Modify: `content-claude.js`
- Modify: `content-chatgpt.js`
- Modify: `content-gemini.js`
- Modify: `content-deepseek.js`
- Modify: `content-doubao.js`
- Modify: `content-qwen.js`

所有 content script 的改造模式相同：
1. 启动时向 background 请求选择器配置
2. 使用配置中的选择器数组而非硬编码
3. 所有选择器失败时使用启发式兜底
4. 启发式也失败时上报 selectorFailure

- [ ] **Step 1: 为每个 content script 添加选择器加载和启发式兜底**

在每个 content script 的顶部，`chrome.runtime.onMessage.addListener` 之前，添加选择器加载逻辑：

```js
// 选择器配置（启动时从 background 获取）
let selectors = null;

// 请求选择器配置
chrome.runtime.sendMessage({ type: "getSelectors", platform: SITE }, (resp) => {
  if (resp) selectors = resp;
});

// 按优先级尝试选择器数组，返回第一个匹配的元素
function queryBySelectors(action, options = {}) {
  const sels = selectors?.[action] || [];
  for (const sel of sels) {
    const el = options.all ? document.querySelectorAll(sel) : document.querySelector(sel);
    if (options.all ? el.length > 0 : el) return el;
  }
  // 启发式兜底
  const heuristic = getHeuristicElement(action, options);
  if (heuristic) return heuristic;
  // 全部失败，上报
  chrome.runtime.sendMessage({ type: "selectorFailure", platform: SITE, action }).catch(() => {});
  return options.all ? [] : null;
}

// 启发式兜底
function getHeuristicElement(action, options = {}) {
  if (action === "input") {
    // 找最大的可编辑区域
    const editables = [...document.querySelectorAll('[contenteditable="true"], textarea')];
    if (editables.length > 0) {
      return editables.reduce((best, el) => {
        const rect = el.getBoundingClientRect();
        const bestRect = best.getBoundingClientRect();
        return (rect.width * rect.height > bestRect.width * bestRect.height) ? el : best;
      });
    }
    return null;
  }
  if (action === "response") {
    // 找最后一个包含大段文本的块
    const blocks = document.querySelectorAll('div, article, section');
    for (let i = blocks.length - 1; i >= 0; i--) {
      const text = blocks[i].innerText?.trim();
      if (text && text.length > 100 && blocks[i].getBoundingClientRect().height > 50) {
        return options.all ? [blocks[i]] : blocks[i];
      }
    }
    return options.all ? [] : null;
  }
  if (action === "streaming") {
    // 检测 stop/cancel 按钮
    const stopBtn = document.querySelector('button[aria-label*="Stop"], button[aria-label*="stop"], button[aria-label*="Cancel"]');
    if (stopBtn) return stopBtn;
    return null;
  }
  if (action === "sendButton") {
    const btns = [...document.querySelectorAll("button")];
    return btns.filter(b => b.getBoundingClientRect().bottom > window.innerHeight - 150 && b.querySelector("svg")).pop() || null;
  }
  return options.all ? [] : null;
}
```

然后将每个 content script 中的硬编码选择器替换为 `queryBySelectors()` 调用。

**content-claude.js 改造示例**：

`isStreaming()` 改为：
```js
function isStreaming() {
  return !!queryBySelectors("streaming");
}
```

`injectAndSend()` 中输入框查找改为：
```js
const el = queryBySelectors("input");
```

`getLastAssistantText()` 改为使用 `queryBySelectors("response", { all: true })` 获取回复元素列表，取最后一个。

`findSendButton()` 改为：
```js
function findSendButton() {
  return queryBySelectors("sendButton");
}
```

对 content-chatgpt.js、content-gemini.js、content-deepseek.js、content-doubao.js、content-qwen.js 做同样模式的改造。

- [ ] **Step 2: 逐个改造 6 个 content script**

每个 content script 的改造要点：
1. 文件顶部添加 `selectors` 变量和 `queryBySelectors` + `getHeuristicElement` 函数
2. `isStreaming()` / `isThinkingOrStreaming()` 改为 `!!queryBySelectors("streaming")`
3. `injectAndSend()` 中输入框查找改为 `queryBySelectors("input")`
4. `readLatestResponse()` 中回复读取改为 `queryBySelectors("response", { all: true })`
5. `findSendButton()` 改为 `queryBySelectors("sendButton")`
6. 保留 `robustInject()` 不变（注入逻辑与选择器无关）
7. 保留 `readFullConversation()` 使用 `queryBySelectors("conversation", { all: true })` 或平台特定逻辑

**注意**：content-gemini.js 的 `isThinkingOrStreaming()` 有额外的 `model-response` 内部检查逻辑，需要保留启发式部分：
```js
function isThinkingOrStreaming() {
  if (queryBySelectors("streaming")) return true;
  // 额外检查：最后一个 model-response 内部的动画元素
  const responses = document.querySelectorAll("model-response");
  if (responses.length > 0) {
    const last = responses[responses.length - 1];
    if (last.querySelector('[class*="animat"], [class*="spin"], [class*="loading"], [class*="progress"]')) return true;
    const thinkEl = last.querySelector("thinking-tag, [class*='thinking'], [class*='Thinking'], [class*='Analyzing']");
    const markdown = last.querySelector(".markdown");
    if (thinkEl && (!markdown || markdown.innerText.trim().length < 10)) return true;
  }
  return false;
}
```

- [ ] **Step 3: Commit**

```bash
git add content-claude.js content-chatgpt.js content-gemini.js content-deepseek.js content-doubao.js content-qwen.js
git commit -m "refactor: content scripts use SelectorManager with heuristic fallback"
```

---

### Task 8: 端到端集成测试

**Files:** 无新文件

手动加载插件，验证核心流程。

- [ ] **Step 1: 加载插件**

1. 打开 `chrome://extensions/`
2. 开启"开发者模式"
3. 点击"加载已解压的扩展程序"，选择 `ai-arena-extension` 目录
4. 确认插件加载成功，无报错

- [ ] **Step 2: 验证基本流程**

1. 点击插件图标打开侧边栏
2. 选择"三巨头"预设，确认 3 个标签页打开
3. 输入问题，点击"发送给全部"
4. 观察：
   - 参与者状态卡片应显示 "✅ 已发送" 或 "❌ 发送失败"
   - 如有失败，确认"重试"/"已手动发送"/"跳过"按钮可用
5. 等待 AI 回复完成
6. 观察确认面板弹出，显示各 AI 回复预览
7. 点击"全部就绪，开始辩论"
8. 点击"开始辩论"按钮
9. 观察辩论发送后再次进入确认面板
10. 确认后辩论完成

- [ ] **Step 3: 验证手动粘贴**

1. 在确认面板中对某个 AI 点击"手动粘贴"
2. 弹出粘贴框，输入文本，点击确认
3. 确认该 AI 状态变为"回复就绪"

- [ ] **Step 4: 验证选择器降级**

1. 打开 service worker console
2. 确认 `SelectorManager` 已初始化
3. 如果能访问 GitHub，确认远程选择器已拉取并缓存

- [ ] **Step 5: 验证状态持久化**

1. 在有参与者和进行中的状态下，关闭侧边栏再重新打开
2. 确认参与者列表和状态恢复正确

- [ ] **Step 6: 验证标签页关闭**

1. 手动关闭某个 AI 标签页
2. 确认该参与者从列表中直接移除

- [ ] **Step 7: Commit 最终状态**

```bash
git add -A
git commit -m "chore: final integration adjustments after testing"
```

---

### Task 9: 清理和 .gitignore

**Files:**
- Modify: `.gitignore`（如不存在则创建）

- [ ] **Step 1: 确保 .superpowers 被忽略**

```bash
echo ".superpowers/" >> .gitignore
git add .gitignore
git commit -m "chore: add .superpowers to .gitignore"
```
