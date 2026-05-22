# AI Arena 微信群聊视图 设计稿

> Spec date: 2026-05-22
> Project: ai-arena-extension v3.0.0 → v4.0.0
> Status: Design (待 writing-plans)

## 1. 背景与目标

### 现状痛点
AI Arena v3.0.0 已支持 9 个 AI 平台（Claude / Gemini / ChatGPT / DeepSeek / 豆包 / 千问 / Kimi / 元宝 / Grok），但用户必须在多个 AI 网页之间来回切换才能看到各家回答。即使有"并列模式"3 窗口铺开，**视线焦点仍要在 3 个独立窗口之间扫**，缺少"一处看全部"的对话感。

### v4.0 目标
新增一个**独立的微信群聊风格 popup 窗口**，把多个 AI 的回答聚合到统一时间线里呈现，让用户在一个窗口内完成日常多 AI 协作的核心动作（提问、广播、追问、@单发、辩论、PPT 工坊）。

### 非目标（v1 不做）
- 历史回填（拉取 AI 原页已有历史并合并到群聊）→ v1.1
- 真流式打字机渲染（逐字推送）→ v2
- chrome.debugger CDP 注入兜底 → v2
- 跨设备群聊同步
- Artifact / Mermaid / 图片等富媒体内嵌渲染（v1 一律跳原页）

## 2. 用户场景

### 主场景：双屏办公
> 用户 = 立花道雪 + 华为同事，办公环境多为双屏。

- **副屏**：AI 并列模式铺 3 个独立 chrome window（Claude / Gemini / ChatGPT 等）
- **主屏右半**：群聊 popup 窗口（800×900 默认，可拖动、可置顶、记忆位置）
- **主屏左半**：用户本职工作的应用（投研工具、IDE、文档）

### 兼容场景：单屏
- 同样的窗口布局降级到单屏内：popup 居中或贴右，AI 窗口被 popup 部分覆盖（不影响发送，因为 AI 是独立 window 不踩 throttling）

## 3. 已锁定的设计决策

| # | 决策点 | 选择 | 核心理由 |
|---|--------|------|---------|
| 1 | 核心定位 | **混合渐进**：基本内嵌渲染 + 复杂富文本跳原页 | 90% 场景在群聊内闭环，10% 富媒体优雅退化 |
| 2 | 承载形态 | **独立 popup 窗口**（chrome.windows.create type='popup'） | 类似微信电脑端；天然 top-level window 不踩 throttling |
| 3 | Throttling 解法 | **拥抱并列模式**：3 AI 各独立 window + 群聊也是独立 popup | 全部窗口 top-level，background throttling 根本无机会发生 |
| 4 | sidepanel 关系 | **群聊为主驾驶舱**：辩论/PPT/同时提问搬进 popup 底部工具栏；sidepanel 减肥为"参与者管理+统计+日志" | 单一控制中心，输入框只有一份，体验完整 |
| 5 | 消息推送 | **周期 polling 渐进刷新**（1.5s） | 沿用现有 v3.0 polling 检测机制；IPC 可控；有"长出来"感 |
| 6 | 历史回填 | **白板**（v1 从零开始）；v1.1 加折叠回溯 | 核心场景是同时提问，不是回溯；对齐算法复杂 |
| 7 | 工具栏布局 | **底部抽屉**（💬同时提问/⚔️辩论/📊PPT/📋总结/⚙️设置 5 个图标） | 日常聊天看不到，调出时不挤压聊天区 |
| 8 | 富文本分级 | **白名单内嵌**：markdown / 代码块 / 简单表格 / 行内公式；**跳原页**：Artifact / Mermaid / 图片 / Canvas / 多模态 | 内容侦测一个 flag 即可 |
| 9 | @mention | **支持单发**：输入 `@Claude xxx` 只发给 Claude；无 @ 则广播 | 沿用 Hub 圆桌已验证的路由价值 |
| 10 | 持久化 | **chrome.storage.local 最近 100 条**，提供清空按钮 | 不爆 storage；导出 markdown 可保留更久 |
| 11 | 初始窗口位置 | **智能选屏**（chrome.system.display 探测）+ 记忆 | 默认主屏右半 800×900；用户拖动后下次还原 |

## 4. 架构

### 4.1 组件拓扑

```
┌─────────────────────────────────────────────────────────────────┐
│                     chrome.runtime (Service Worker)             │
│                                                                 │
│   ┌─────────────────────────────────────────────────────┐      │
│   │            background.js  (Message Bus)             │      │
│   │  - 维护 popup window 句柄                          │      │
│   │  - 维护 polling 调度器（1.5s × N AI）              │      │
│   │  - 路由用户消息 → content scripts                  │      │
│   │  - 路由 AI 回复 → popup                            │      │
│   │  - chrome.storage.local 持久化 chat log（100 条）  │      │
│   └─────────────────────────────────────────────────────┘      │
│         ↕ runtime.sendMessage              ↕ runtime.sendMessage │
└────┬───────────────────────┬─────────────────────────────┬─────┘
     │                       │                             │
┌────▼──────┐         ┌──────▼───────────┐         ┌──────▼───────┐
│  popup    │         │  content-*.js    │         │  sidepanel   │
│  window   │         │  (9 个平台)      │         │              │
│           │         │                  │         │  减肥后:     │
│  - 消息列 │         │  v3.0 现有:      │         │  - 参与者    │
│  - 输入框 │         │  - injectAndSend │         │  - 统计      │
│  - 工具栏 │         │  - readResponse  │         │  - 日志      │
│    抽屉   │         │  - checkComplete │         │  - 🪟开群聊 │
│  - @补全  │         │  v4.0 新增:      │         │              │
│  - markdown│        │  - hasRichContent│         │              │
│    渲染器 │         │    检测器        │         │              │
└───────────┘         └──────────────────┘         └──────────────┘
```

### 4.2 关键文件

#### 新建
- `src/popup.html` — 群聊窗口结构（消息列 + 输入框 + 工具栏抽屉）
- `src/popup.js` — popup 主逻辑：消息渲染、输入处理、@mention 补全、抽屉切换、持久化恢复
- `src/popup.css` — 群聊风格样式（微信电脑端配色 + 暗色模式 + 苹果极简白主题适配）
- `src/popup-markdown.js` — 轻量 markdown 渲染（marked.js 或自研，含代码块高亮、表格、行内公式）
- `src/popup-richcontent-detector.js` — 富文本检测器（接收 content script 的 hasRichContent flag，决定渲染策略）

#### 修改
- `src/manifest.json` — version 3.0.0 → 4.0.0；新增 `popup.html` 到 web_accessible_resources；可选加 `system.display` 权限（已有）
- `src/background.js` — 新增:
  - `openChatPopup()`: 用 chrome.windows.create({type:'popup'}) 打开 popup，记忆位置
  - `dispatchMessage(text, targets[])`: 把消息广播或 @单发到 content scripts
  - `pollAIResponse(participantId)`: 1.5s 周期调 readResponse，把累积文本推到 popup
  - `chatLog` 数据结构 + chrome.storage.local 读写
  - `chrome.system.display.getInfo()` 选屏 + 位置记忆
- `src/content-*.js`（9 个文件）— 新增 `hasRichContent()` 检测：
  - Claude: 检查 `[class*="artifact"]` 或 `iframe[src*="artifact"]`
  - Gemini: 检查 `[class*="canvas"]` 或 `<canvas>`
  - ChatGPT: 检查 `[class*="canvas-panel"]` 或 `code[class*="language-mermaid"]`
  - 通用: 检查 `<img>` 数量 > 1、`<svg>` 等
  - 返回 `{ text, hasRichContent, richTypes: ['artifact'|'mermaid'|'image'|'canvas'] }`
- `src/sidepanel.html` / `.js` / `.css` — 减肥:
  - 移除"同时提问"tab 整块（搬到 popup）
  - 移除"辩论"tab 整块（搬到 popup 抽屉）
  - 移除"PPT 工坊"tab 整块（搬到 popup 抽屉）
  - 保留：参与者管理（含 + 添加按钮）、统计、日志
  - 顶部新增 **"🪟 打开群聊"** 主按钮（蓝色 primary，最显眼）
- `src/state-machine.js` — 扩展 StateMachine，新增 `chatLog`、`popupWindowId`、`popupBounds` 字段
- `src/debate-engine.js` — 不动，被 popup 调用而已

### 4.3 通信协议（chrome.runtime.sendMessage）

新增消息类型：

| type | 方向 | payload | 用途 |
|------|------|---------|------|
| `openChatPopup` | sidepanel → background | — | 用户点开群聊按钮 |
| `chatBroadcast` | popup → background | `{text, targets[], images[]}` | popup 输入框发送（targets 为空则广播） |
| `chatStreamUpdate` | background → popup | `{participantId, text, isDone, hasRichContent, richTypes[]}` | 1.5s polling 推送（含完成状态） |
| `chatRestoreLog` | popup → background | — | popup 启动请求历史 |
| `chatLogPayload` | background → popup | `{messages: [{role, participantId, text, ts, hasRichContent}]}` | 回放最近 100 条 |
| `chatClear` | popup → background | — | 清空群聊（不影响 AI 原页） |
| `chatJumpToOrigin` | popup → background | `{participantId}` | "↗ 跳原页"按钮 → chrome.tabs.update active |

### 4.4 数据流（典型流程：广播提问）

```
[1] 用户在 popup 输入框敲 "分析下宁德时代" + 按 Ctrl+Enter
       │
[2] popup.js sendMessage({type:'chatBroadcast', text, targets:[], images:[]})
       │
[3] background.js 收到:
       a. 在内存 chatLog 加一条 {role:'user', text, ts}
       b. 写 chrome.storage.local
       c. 立即回推 {type:'chatStreamUpdate', text, role:'user'} 让 popup 渲染用户气泡
       d. 对每个 participant: chrome.tabs.sendMessage(tabId, {action:'inject', text})
       e. 启动 3 路 polling: setInterval(pollAIResponse, 1500) per participantId
       │
[4] content-*.js 收到 inject:
       robustInject(el, text) → 按 Enter → AI 开始流式
       │
[5] background.js 每 1.5s 调:
       chrome.tabs.sendMessage(tabId, {action:'readResponse'}) →
       content script 返回 {text, hasRichContent, richTypes}
       background 比对上次累积文本，若有变化:
           sendMessage(popupId, {type:'chatStreamUpdate', participantId, text, isDone:false, hasRichContent, richTypes})
       │
[6] popup.js 收到 chatStreamUpdate:
       找到该 participantId 的气泡（不存在则新建），整段替换内容（markdown 渲染）
       若 hasRichContent: 气泡尾部加 "📦 含 Artifact ↗ 跳原页" pill
       │
[7] background.js 调 checkCompletion 检测 isStreaming=false 连续 3 次:
       sendMessage(popupId, {type:'chatStreamUpdate', isDone:true})
       clearInterval(polling)
       把完整 AI 回复写入 chatLog + storage
```

### 4.5 @mention 路由（单发流程）

```
用户输入 "@Cl" → popup.js 弹补全菜单 [Claude] → 用户选中 → 输入框显示 "@Claude " + 光标
用户继续输入 "你怎么看" → 发送时 popup.js 解析:
    text.startsWith('@') → 提取 participantId → targets=['claude'] → 只发给 Claude
其他 AI 气泡不出现 typing。
```

## 5. 边界与降级

### 5.1 popup 窗口生命周期
- **打开**：sidepanel 点"🪟 打开群聊" → background `openChatPopup()` → chrome.windows.create + 记忆位置
- **重复打开**：检测 popupWindowId 仍存在 → chrome.windows.update({focused:true}) 拉到前台，不重开
- **关闭**：用户关 popup → chrome.windows.onRemoved 触发 → background 清 popupWindowId 但保留 chatLog
- **重开恢复**：再次点"🪟 打开群聊" → popup.js 启动时 sendMessage('chatRestoreLog') → background 回 chatLogPayload → popup 渲染历史

### 5.2 AI 原页未打开
- 用户发消息时 background 发现某 participant 的 tabId 无效（tab 已关）→ popup 该 AI 气泡显示"⚠ Claude 标签页已关闭，点击重新打开" → 点击 → chrome.tabs.create({url:'https://claude.ai'}) + 待加载完成自动重发

### 5.3 polling 失败兜底
- readResponse 连续 5 次（7.5s）返回相同文本 → 视为流式结束
- readResponse 抛错（如 content script 未加载）→ popup 气泡显示"⚠ 同步失败"+ 手动重试按钮
- 单 AI 失败不影响其他 AI（每路 polling 独立）

### 5.4 storage 上限
- chatLog 超过 100 条 → 删最早 1 条（FIFO）
- 估算单条平均 500 字节 → 100 条约 50KB，远低于 chrome.storage.local 5MB 上限
- 用户主动清空：popup 工具栏抽屉里的"⚙️设置"→"清空群聊"按钮

### 5.5 单屏布局降级
- chrome.system.display.getInfo() 返回 1 个 display → popup 居中 600×800（避免覆盖 AI 窗口太多）
- 用户拖动后记忆，下次还原

### 5.6 富文本检测假阴/假阳
- 假阴（漏判富文本）：用户看气泡里少了某部分 → 已有"↗ 在 Claude 查看完整回答"链接兜底
- 假阳（误判纯文本为富文本）：气泡尾部多个 pill 而已，不影响主内容显示

## 6. 测试策略

### 6.1 单元测试（Node + jest 风格）
- 富文本检测器 `hasRichContent()`：mock DOM 测各种 artifact / canvas / image 模式
- @mention 解析：测 `@Claude xxx` / `@Gemini @GPT xxx` / 普通广播
- chatLog FIFO：测 100 条上限
- 位置记忆：测 chrome.system.display 1 屏 / 2 屏 / 用户拖动后记忆

### 6.2 E2E 测试（Playwright + 真实扩展加载）
按用户铁律"测试必须真实执行"，下列必须真跑：
- 打开 popup → 输入"hello" 广播 → 观察 3 个 AI 气泡逐步填充 → 完成态
- @Claude 单发 → 只有 Claude 气泡出现 typing
- popup 关闭 → 重开 → 历史恢复
- Claude 输出 Artifact → popup 显示"📦 含 Artifact ↗ 跳原页"pill → 点击 → tab 切到 claude.ai
- 双屏环境（mock display info）→ popup 落在主屏右半
- 拖动 popup → 关闭 → 重开 → 位置还原

### 6.3 兼容性测试
- 9 个 AI 平台各跑一次广播测试，确认 hasRichContent 检测器在每个平台都不漏不误

## 7. 版本号变更

按用户铁律"版本号可见化"：
- `src/manifest.json` version: `3.0.0` → `4.0.0`
- `src/package.json` version: `3.0.0` → `4.0.0`
- `src/sidepanel.html` 顶部 `<span class="version">v3.0.0</span>` → `v4.0.0`
- `src/sidepanel.html` 底部 `AI Arena v3.0.0` → `v4.0.0`
- `src/popup.html` 标题栏 `AI Arena 群聊 · v4.0.0`
- `build.mjs` 跑构建，生成 `dist/github/ai-arena-github-v4.0.0.zip`
- Release notes: `docs/release-notes-4.0.0.html`

## 8. 分阶段交付

按用户铁律"大改动分段交付"，本设计拆 3 个 PR（每个 PR 独立可工作、可测试）：

### Phase 1：popup 骨架 + 基础广播（v4.0.0-alpha）
- 新建 popup.html / popup.js / popup.css（无工具栏抽屉，只输入框+消息列）
- background.js 加 openChatPopup + chatBroadcast + 1.5s polling
- content scripts 加 hasRichContent 检测器
- sidepanel 加"🪟 打开群聊"主按钮（保留原"同时提问"避免回退）
- E2E：广播流程跑通

### Phase 2：辩论 / PPT 搬进抽屉 + sidepanel 减肥（v4.0.0-beta）
- popup 底部工具栏抽屉（5 个图标）
- 辩论模式、PPT 工坊从 sidepanel 移到抽屉
- sidepanel 删除"同时提问 / 辩论 / PPT" 三个 tab
- @mention 补全菜单
- chatLog 持久化 + 重开恢复
- E2E：辩论流程在 popup 内跑通

### Phase 3：智能选屏 + 富文本兜底 + 抛光（v4.0.0）
- chrome.system.display 选屏 + 位置记忆
- 富文本"↗ 跳原页" pill
- AI tab 未打开兜底
- 单屏降级
- 9 平台兼容性 E2E
- Release notes + zip 打包

## 9. 与 Hub 圆桌的差异化

| 维度 | Hub 圆桌（mr-gc-*） | AI Arena 群聊（v4） |
|------|---------------------|---------------------|
| 数据源 | 本地 CLI transcript JSONL（Claude/Codex/Gemini） | 各 AI 网页 DOM（readResponse polling） |
| 实时性 | TranscriptTap fs.watch 真实时 | 1.5s polling 准实时 |
| 富文本 | Markdown + 代码 + tool_use checkpoint | Markdown + 代码 + 富媒体跳原页 |
| 持久化 | SQLite | chrome.storage.local |
| 多模态 | 文本为主 | 含图片、Artifact、Canvas 等 web 富媒体 |
| 部署 | Electron 本地应用 | Chrome 扩展 |

不抄 Hub 的 SQLite/Transcript Tap 架构（适合 CLI），AI Arena 选 chrome.storage + polling（适合扩展沙盒）。

## 10. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| AI 厂商改 DOM 结构导致 readResponse 失效 | 高 | 中 | v3.0 已有的 selectors-config.js 多层 fallback 机制继续生效；selectorFailure 上报 |
| popup 窗口被用户误关 → 状态丢 | 中 | 低 | chrome.storage.local 持久化；重开 0 损失 |
| 9 个平台的 hasRichContent 检测覆盖不全 | 中 | 低 | v1 只检测最常见的 Artifact/Canvas/Image；漏判用户能跳原页兜底 |
| markdown 渲染器 XSS | 低 | 高 | 用 marked.js + DOMPurify，或自研严格白名单 |
| chrome.system.display 在某些 OS 行为不一致 | 低 | 低 | 失败时降级到固定 800×900 居中 |

## 11. 不在范围内（v1 YAGNI）

- 历史回填（拉取并合并 AI 原页历史）→ v1.1
- 真流式打字机（逐字推送）→ v2
- chrome.debugger CDP 注入 → v2
- 跨设备同步、云端 chatLog → v3+
- Artifact / Mermaid / 图片内嵌渲染 → v3+
- popup 内的多群聊切换（多个会话室） → v2
- 自定义 AI 头像 / 昵称 → v2
