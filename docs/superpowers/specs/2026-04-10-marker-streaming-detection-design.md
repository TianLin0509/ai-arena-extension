# 标记驱动的流式检测设计

> 日期：2026-04-10
> 状态：已批准，待实施
> 范围：替换现有 streaming 轮询检测机制

## 1. 背景

当前 streaming 检测完全依赖 CSS 选择器（查找 Stop 按钮等 UI 元素），各平台随时可能改 DOM 结构导致检测失效。已出现多次"AI 明显回答完了但插件检测不到"的问题。

## 2. 方案：标记协议 + 字符数监控

在每次发送给 AI 的 prompt 中注入隐藏指令，要求 AI 在回复开头和末尾输出约定标记。通过检测标记是否出现 + 文本长度是否变化来判定生成状态。

**注入指令**：
```
（请在回答的最开头输出 ⚡ARENA_START⚡，最末尾输出 ⚡ARENA_DONE⚡ 作为标记，不要解释这些标记）
```

**标记常量**：
```js
const MARKER_START = "⚡ARENA_START⚡";
const MARKER_DONE = "⚡ARENA_DONE⚡";
```

## 3. 三态检测模型

| 条件 | 状态 | UI 显示 |
|------|------|---------|
| START 未出现 AND 字符数=0 | 等待中 | 🤔 等待中 |
| START 已出现 AND DONE 未出现 | 生成中 | ⏳ 生成中 |
| DONE 已出现 AND 字符数稳定 | 已完成 | ✅ 已完成 |
| 60秒无任何标记 | 降级检测 | ⚠️ 降级中 |

**判定规则（不对称安全原则）**：
- "正在生成"判定宽松：字符数在增长 → 一定还在生成（一票否决"完成"）
- "已完成"判定严格：DONE 标记出现 AND 字符数连续 2 次稳定（3 秒）

## 4. 检测架构

```
主力层：标记检测 + 字符数变化（新增）
├─ content script 新增 checkCompletion action
├─ 返回 { hasStart: bool, hasDone: bool, textLength: number }
├─ 轮询间隔 1.5 秒
│
兜底层：选择器 + 文本稳定性（现有，降级使用）
├─ 触发条件：60 秒内未检测到任何标记
├─ 已完成 = 选择器没匹配到 AND 文本长度稳定 5 秒
│
逃生口：手动确认按钮（始终可用）
```

## 5. 改动范围

### 5.1 content script（6 个文件）

新增 `checkCompletion` 消息处理：
```js
if (msg.action === "checkCompletion") {
  const text = getLastResponseText(); // 轻量读取最后回复文本
  sendResponse({
    hasStart: text.includes(MARKER_START),
    hasDone: text.includes(MARKER_DONE),
    textLength: text.length
  });
}
```

新增 `getLastResponseText()` 函数：用 response 选择器快速读取最后一条 AI 回复的 innerText（不走 readLatestResponse 的重逻辑）。

`readLatestResponse()` 修改：读取后自动剥离标记。

### 5.2 background.js

新增 `checkAllCompletion()` 函数（替代 `checkAllStreaming()` 在轮询中的角色）：
- 向每个参与者发送 `checkCompletion`
- 返回各参与者的 { hasStart, hasDone, textLength, prevLength }

`handleBroadcast()` 修改：在用户 prompt 末尾追加标记指令。

`handleDebateRound()` 修改：在辩论 prompt 末尾追加标记指令。

`readOneResponse()` 修改：读取文本后剥离 MARKER_START 和 MARKER_DONE。

### 5.3 sidepanel.js

`startStreamingPoll()` 改为调用 `checkAllCompletion` 而非 `checkAllStreaming`。

轮询逻辑改为：
```
每 1.5 秒：
  results = checkAllCompletion()
  for each participant:
    if (!hasStart && textLength === 0): status = "waiting"
    else if (hasStart && !hasDone): status = "streaming"
    else if (hasDone && textLength === prevLength): status = "ready"
    else if (textLength !== prevLength): status = "streaming" // 一票否决
  
  if all non-offline are "ready" for 2 consecutive polls:
    readAllResponses() → showConfirmPanel()
  
  if 60秒无任何 hasStart:
    降级到 checkAllStreaming（现有选择器逻辑）
```

UI 渲染增加"等待中"状态显示。

### 5.4 debate-engine.js

`buildDebatePrompt()` 和 `buildSummaryPrompt()` 末尾追加标记指令。

新增 `MARKER_INSTRUCTION` 常量和 `stripMarkers()` 函数。

### 5.5 state-machine.js

ParticipantState 新增 `WAITING` 状态（START 未出现时）。

## 6. 标记剥离

读取回复后自动剥离标记，用户看到的文本不包含标记：
```js
function stripMarkers(text) {
  return text.replace(/⚡ARENA_START⚡/g, '').replace(/⚡ARENA_DONE⚡/g, '').trim();
}
```
