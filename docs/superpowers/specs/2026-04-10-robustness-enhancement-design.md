# AI Arena 鲁棒性增强设计

> 日期：2026-04-10
> 状态：已批准，待实施
> 范围：一次性重构，状态机驱动

## 1. 背景与问题

AI Arena v5.0 支持 6 个 AI 平台的多轮辩论，但在实际使用中存在以下鲁棒性问题：

1. **消息注入偶发失败**：3 个 AI 中有 1 个没收到消息（尤其图片上传），但流程不允许用户手动补救后继续
2. **流式检测误判**：AI 还在写就被判定完成，或写完了迟迟不进入下一步，误判会污染下游辩论流程
3. **选择器脆弱**：平台 DOM 一变就读不到内容，缺乏优雅降级
4. **状态管理松散**：依赖分散的 flag 和 Promise，边界情况容易出错

## 2. 设计决策总结

| 决策点 | 选择 |
|--------|------|
| 架构方案 | 状态机驱动（非事件补丁） |
| 手动介入模式 | 半自动——关键节点设确认门控，正常时自动通过，异常时用户介入 |
| 回复确认方式 | 汇总确认面板——自动检测完成后展示回复预览，用户一次性确认 |
| 选择器策略 | 四层防线：精确选择器 → GitHub JSON 热更新 → 启发式兜底 → 手动粘贴 |
| 改造节奏 | 一次性重构 + 统一测试 |

## 3. 状态机模型

### 3.1 整体流程状态机（FlowState）

```
IDLE ──广播──→ BROADCASTING ──全部注入完成──→ AWAITING_RESPONSES
                                                    │
                                          用户点"全部就绪"
                                                    ↓
SUMMARY ←──用户请求总结── DEBATING ←──确认通过── CONFIRMING
                                                    ↑
                                          用户点"未完成，继续等"
                                                    │
                                              AWAITING_RESPONSES
```

### 3.2 参与者状态机（ParticipantState）

```
IDLE ──注入──→ INJECTING ──成功──→ INJECT_OK ──检测到流式──→ STREAMING ──完成──→ RESPONSE_READY
                  │                                                                    ↑
                  失败                                                          用户手动粘贴
                  ↓                                                                    │
             INJECT_FAILED ──用户点"已手动发送"──→ INJECT_OK              RESPONSE_FAILED
```

### 3.3 状态转换规则

- 进入 `CONFIRMING`：所有非 INJECT_FAILED 的参与者都到达 RESPONSE_READY 或 RESPONSE_FAILED
- 进入 `DEBATING`：至少 2 个参与者有有效回复
- 任何门控都不会自动超时跳过，必须用户确认

## 4. 汇总确认面板（Confirming Gate）

当流程进入 CONFIRMING 状态时，侧边栏展示确认面板。

### 4.1 面板内容

每个 AI 一行卡片：
- AI 名称 + 图标
- 状态标识：✅ 回复就绪 / ❌ 读取失败 / ⚠️ 回复疑似不完整
- 回复预览（前 80-100 字）
- 操作按钮：「继续等待」「手动粘贴」「跳过此 AI」

底部操作栏：
- 「全部就绪，开始辩论」（至少 2 个有效回复时可点）
- 「全部继续等待」（回退到 AWAITING_RESPONSES）

### 4.2 "疑似不完整"判定规则

- 回复长度 < 50 字
- 回复以明显未完成标记结尾（"..."、半句话）
- 检测耗时 < 3 秒（大概率误判）

### 4.3 手动粘贴流程

点击「手动粘贴」→ 展开文本框 → 用户粘贴 AI 回复 → 状态变为 RESPONSE_READY

## 5. 选择器四层防线

### 5.1 架构

```
SelectorManager (新模块)
├── loadRemoteSelectors()    — 启动时拉 GitHub JSON，缓存到 chrome.storage
├── getSelector(platform, action) — 按优先级返回：热更新 > 内置 > 启发式
├── reportFailure(platform, action) — 记录失败，触发降级
└── selectors-config.js      — 内置默认选择器
```

### 5.2 第一层：精确选择器（代码内置）

每个平台维护当前已知的精确选择器，作为默认值。从各 content script 抽出到 `selectors-config.js` 统一管理。

### 5.3 第二层：GitHub JSON 热更新

插件启动时从 GitHub 仓库拉取 `selectors.json`，格式：

```json
{
  "version": 2,
  "claude": {
    "input": [".ProseMirror[contenteditable]"],
    "response": ["[data-testid='chat-message-text']", ".font-claude-message"],
    "streaming": ["[data-is-streaming='true']", "button[aria-label='Stop']"]
  },
  "gemini": { ... },
  "chatgpt": { ... },
  "deepseek": { ... },
  "doubao": { ... },
  "qwen": { ... }
}
```

- 热更新选择器优先于代码内置
- 本地缓存到 `chrome.storage`，拉取失败时用缓存或回退到内置
- **GitHub 拉取是增强而非依赖**：公司内网等无法访问 GitHub 的环境下，插件完全依靠内置默认选择器 + 本地缓存正常工作。GitHub 热更新只是"锦上添花"
- 拉取超时设为 3 秒，超时静默失败，不阻塞插件启动
- `selectors.json` 存放于 `ai-arena-extension` 仓库根目录

### 5.4 第三层：启发式兜底

精确选择器全部失败时，用通用规则探测：
- 输入框：找页面中最大的 `contenteditable` 或 `textarea`
- 回复：找最后一个包含大段文本（>100字）且在对话区域内的块级元素
- 流式：检测页面是否有 stop/cancel 按钮，或 DOM 是否在持续变化（MutationObserver）

### 5.5 第四层：手动粘贴

上面全失败时，在确认面板提示"XX平台读取失败"，用户手动复制回复粘贴进来。

### 5.6 Content Script 选择器获取方式

Content script 不直接引用 SelectorManager（运行在网页上下文），改为启动时向 background 请求：

```js
// content script
chrome.runtime.sendMessage({ type: 'getSelectors', platform: 'claude' })
// → 返回合并后的选择器数组
```

## 6. 半自动流程与门控

### 6.1 四个确认门控

| 门控 | 触发时机 | 正常流程 | 异常流程 |
|------|----------|----------|----------|
| 门控 1 | 广播发送后 | 全部成功，自动进入等待 | 失败的 AI 显示「重试」「已手动发送」「跳过」 |
| 门控 2 | 回复汇总确认 | 弹出确认面板，用户点"全部就绪" | 用户标记"继续等"或手动粘贴 |
| 门控 3 | 辩论轮次发送后 | 同门控 1 | 同门控 1 |
| 门控 4 | 辩论轮次回复确认 | 同门控 2 | 同门控 2 |

### 6.2 UI 状态卡片

侧边栏的参与者列表从静态展示改为实时状态卡片：

```
┌─────────────────────────────────────────┐
│ 🟢 Claude        ✅ 回复就绪        [预览] │
│ 🟡 Gemini        ⏳ 生成中...              │
│ 🔴 ChatGPT       ❌ 发送失败   [重试] [已手动发送] [跳过] │
└─────────────────────────────────────────┘
              [ 全部就绪，开始辩论 ]
```

### 6.3 设计原则

- 正常流程下用户只需在门控 2/4 点一次"全部就绪"
- 只有出问题时才需要额外操作
- 任何门控都不会自动超时跳过

## 7. 错误处理与容错

### 7.1 Service Worker 休眠恢复

- 保留 `initPromise` + `chrome.storage` 机制，增强为恢复完整状态机（FlowState + 所有 ParticipantState）
- 恢复到 AWAITING_RESPONSES → 重新开始轮询流式状态
- 恢复到 CONFIRMING → 重新弹出确认面板

### 7.2 标签页关闭

- 监听 `chrome.tabs.onRemoved`，直接移除对应参与者（不做恢复）

### 7.3 Content Script 通信失败

- `sendMessage` 超时（默认 10s）→ 自动重试 1 次
- 重试仍失败 → 参与者状态设为失败态，触发门控让用户介入
- 不静默吞错误

### 7.4 选择器失败上报

- content script 选择器全部失败时，上报 `{ type: 'selectorFailure', platform, action }`
- 侧边栏显示 ⚠️ 提示
- 失败日志记录到 `chrome.storage`

### 7.5 辩论流程保护

- 进入辩论前校验至少 2 个有效回复
- 辩论 prompt 组装时跳过无有效回复的参与者
- 单个参与者辩论轮次失败不中断整个辩论

## 8. 文件架构

```
ai-arena-extension/
├── background.js              — 入口，消息路由（精简为 ~100 行）
├── state-machine.js           — FlowState + ParticipantState 定义与转换逻辑
├── selector-manager.js        — 四层选择器管理（热更新、降级、缓存）
├── selectors-config.js        — 内置默认选择器配置
├── debate-engine.js           — 辩论轮次编排、prompt 组装
├── sidepanel.js               — UI 逻辑（增加状态卡片和确认面板）
├── sidepanel.html / .css      — UI（增加确认面板样式）
├── content-{platform}.js      — 各平台 content script（从 SelectorManager 获取选择器）
├── inject-images.js           — 图片注入（现有）
├── selectors.json             — GitHub 热更新选择器配置
├── manifest.json
└── icons/
```

MV3 模块化通过 `importScripts()` 实现：
```js
// background.js
importScripts('state-machine.js', 'selector-manager.js', 'debate-engine.js', 'selectors-config.js');
```
