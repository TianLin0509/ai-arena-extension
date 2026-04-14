# AI Arena Android MVP 设计文档

> 日期：2026-04-13
> 目标：将 Chrome 扩展核心功能移植为 Android 原生 App，在手机上独立运行
> 原则：最大化复用现有扩展逻辑；MVP 优先打通核心链路，延后锦上添花功能

## 1. 目标与定位

把 `ai-arena-extension`（Chrome 扩展）的核心能力——**多 AI 同时提问 + 多轮辩论 + 裁判总结**——移植成一个独立的 Android App，方便用户在手机上使用。不依赖 PC、不依赖云端服务、零后端。

## 2. 关键技术决策（已确认）

| 决策点 | 选择 | 理由 |
|---|---|---|
| 目标平台 | Android（兼容 HarmonyOS 4） | 非纯鸿蒙 5（不用 ArkTS） |
| 接入方式 | 手机原生 WebView + 脚本注入 | 不依赖 PC，不用 API 付费 |
| 开发框架 | React Native + react-native-webview | 最大化复用现有 JS 扩展代码 |
| 支持的 AI | 全 6 家（Claude/Gemini/ChatGPT/DeepSeek/豆包/千问） | 默认三家常驻：DeepSeek + Gemini + GPT |
| 功能范围 | MVP 精简版 | 只做核心，砍掉图片/文件/统计/导出 |
| 登录态 | WebView 持久化 Cookie | 首次打开某 AI 时在其 WebView 内登录一次 |
| 代理 | 用户自装 Clash for Android（全局 TUN） | App 不处理代理 |
| 注入方式 | `injectedJavaScript` + `postMessage` 桥 | RN 最成熟、最标准的模式 |
| User-Agent | 全部桌面 Chrome | 最大化复用扩展的选择器和注入脚本 |

## 3. 架构概览

```
┌────────────────────────────────────────┐
│  AI Arena Android App (React Native)    │
│                                         │
│  ┌──────────────┐  ┌──────────────┐    │
│  │ Dashboard    │  │ Detail       │    │
│  │ (默认)       │  │ (全屏详情)    │    │
│  └──────┬───────┘  └──────┬───────┘    │
│         └─────┬────────────┘            │
│               ↓                         │
│  ┌─────────────────────────────────┐   │
│  │ 全局状态（Zustand）               │   │
│  │ • participants[] + pollStatus    │   │
│  │ • debateSession                  │   │
│  │ • flowState                      │   │
│  └──────────────┬──────────────────┘   │
│                 ↓                       │
│  ┌─────────────────────────────────┐   │
│  │ WebView Pool（常驻，display控制） │   │
│  │ [DeepSeek WV] [Gemini WV] [GPT WV]│  │
│  │  ↑            ↑           ↑      │  │
│  │  injectedJS   injectedJS  injectedJS│ │
│  │   ↓postMessage桥 → Zustand state  │  │
│  └─────────────────────────────────┘   │
└────────────────────────────────────────┘
          ↕ Clash for Android（用户自配）
   AI 平台网页（全部桌面 UA）
```

**关键机制**：

1. **WebView 常驻**：3 个 WebView 在 App 启动时一次性创建，之后 `display:'none'` 隐藏。切到详情视图时改为 `display:'flex'` + 全屏层级。WebView 永不卸载，状态（cookie、加载内容、流式回复）一直在内存中。

2. **消息桥取代 chrome.runtime**：扩展里 `chrome.runtime.sendMessage` → 在 App 里改为 `window.ReactNativeWebView.postMessage(JSON.stringify({...}))`。RN 层的 `onMessage` 处理器解析消息，更新 Zustand store。

3. **状态管理**：Zustand 替代扩展的 StateMachine。所有 UI 订阅 store，状态变化自动重渲染。

4. **桌面 UA**：WebView 创建时设置 `userAgent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"`。

## 4. 文件结构

```
ai-arena-android/
├── App.tsx                          RN 入口
├── src/
│   ├── store/
│   │   └── arenaStore.ts            Zustand store
│   │
│   ├── screens/
│   │   ├── DashboardScreen.tsx      状态卡片 + 提问框 + 辩论/总结
│   │   └── DetailScreen.tsx         全屏单个 WebView
│   │
│   ├── components/
│   │   ├── ParticipantCard.tsx
│   │   ├── ParticipantPool.tsx      常驻 WebView 容器
│   │   ├── ParticipantWebView.tsx
│   │   ├── BroadcastInput.tsx
│   │   └── DebateControls.tsx
│   │
│   ├── inject/                      注入脚本（字符串形式）
│   │   ├── build-inject.ts          base + platform 拼接
│   │   ├── base.js                  公共逻辑
│   │   ├── claude.js
│   │   ├── gemini.js
│   │   ├── chatgpt.js
│   │   ├── deepseek.js
│   │   ├── doubao.js
│   │   └── qwen.js
│   │
│   ├── engine/
│   │   ├── DebateEngine.ts
│   │   ├── MarkerProtocol.ts
│   │   └── MessageBus.ts
│   │
│   └── config/
│       ├── services.ts
│       └── selectors.ts
│
├── android/                         RN 原生壳（自动生成）
└── package.json
```

### 代码复用矩阵

| 扩展原文件 | App 里对应 | 复用度 |
|---|---|---|
| `content-*.js` × 6 | `src/inject/*.js` | 80%（替换 `chrome.runtime.sendMessage` 为 `window.ReactNativeWebView.postMessage`） |
| `selectors-config.js` | `src/config/selectors.ts` | 100% |
| `debate-engine.js` | `src/engine/DebateEngine.ts` | 95%（加 TS 类型） |
| `state-machine.js` | `src/store/arenaStore.ts` | 重写（Zustand API） |
| `background.js` | 散入 store + MessageBus + Pool | 60% |
| `sidepanel.{js,html,css}` | `screens/` + `components/` | 重写（RN 组件） |

## 5. 数据流

### 5.1 广播提问

```
用户在 Dashboard 点"发送给全部"
  → arenaStore.broadcast(text)
  → ParticipantPool 遍历每个 WebView 调
    webViewRef.injectJavaScript(`window.__arena_injectAndSend(${JSON.stringify(text+markerInstruction)})`)
  → WebView 常驻脚本执行：找输入框 → 注入 → 点发送 → 启动 MutationObserver
  → postMessage({type:"injectDone", pid, ok:true})
  → RN MessageBus → arenaStore.setPollStatus(pid, "waiting")
  → UI 刷新
```

### 5.2 回复完成检测

```
WebView 内的 MutationObserver
  → 每次 DOM 变化检查 ARENA_DONE_R{n}
  → 找到 → postMessage({type:"markerDetected", pid, textLength, text})
  → arenaStore.setParticipantResponse(pid, text) + setPollStatus("ready")
  → UI 卡片显示 ✓ 已完成
```

### 5.3 辩论轮

```
用户点"开始辩论"
  → DebateEngine.buildDebatePrompt() 为每个 AI 构建包含"其他回答"的 prompt
  → 对每个 WebView 重复广播流程
  → 回复完成后 arenaStore.rounds 追加一轮
  → UI 显示"第 N 轮"
```

### 5.4 消息桥协议

**WebView → RN**（`postMessage` payload）：

| type | 何时发 | payload |
|---|---|---|
| `ready` | 注入脚本加载完 | `{pid}` |
| `injectDone` | 注入+发送完成 | `{pid, ok, error?}` |
| `streaming` | 检测到文字变化 | `{pid, textLength}` |
| `markerDetected` | 检测到 ARENA_DONE | `{pid, textLength, text}` |
| `selectorFailure` | 某选择器全失效 | `{pid, action}` |

**RN → WebView**（`injectJavaScript`）：

| 函数 | 作用 |
|---|---|
| `__arena_injectAndSend(text)` | 注入文字并发送 |
| `__arena_readLatestResponse()` | 读取最新回复 |
| `__arena_setupMarkerWatcher(doneMarker)` | 启动哨兵 |

## 6. 关键难点与应对

| 难点 | 应对 |
|---|---|
| WebView 首次加载完成时机 | `onLoadEnd` + ping 重试（同扩展 `waitForContentScript`） |
| 桌面 UA 在手机小屏排版紧凑 | `scalesPageToFit={true}` + viewport meta 注入缩放到 `width=1024` |
| Cookie 持久化 | `sharedCookiesEnabled={true}`（默认已开） |
| 登录跳转 | `onNavigationStateChange` 监听 URL，登录成功后自动导回主页 |
| AI 平台检测到非真机环境 | UA + `navigator.maxTouchPoints` + viewport 一起伪装 |

## 7. MVP 范围

### ✅ 做

- 默认三家常驻：DeepSeek + Gemini + GPT（不可增减）
- 每家 WebView 独立登录
- 仪表盘：3 张状态卡片（名字 + 状态徽章 + 实时字数）
- 点卡片 → 全屏详情视图
- 提问框 → 发送给全部
- 自动检测回复完成（ARENA 暗号协议）
- 自动提取回复文本
- 辩论：一个按钮"开始辩论"（只做自由辩论）
- 辩论最多 3 轮
- 总结：固定用第一个参与者（DeepSeek）作为裁判
- 重置按钮（清空 session，WebView 保留）

### ❌ 不做

- 图片上传、文件上传
- 统计（对话数/辩论轮/token 计数）
- 导出对话
- 自定义参与者组合
- 裁判选择
- 群策群力模式
- 简洁模式开关
- 辩论 guidance 文本
- 彻底重置
- Tab / 并列模式（手机上无意义）
- session 持久化到 AsyncStorage（重启清空）

### 🛡️ 延后（MVP 之后）

- 动态增减参与者 + 切换 AI 组合
- 文件/图片上传
- 选择裁判
- 辩论引导 / 简洁模式
- 导出为文本分享
- session 历史持久化

## 8. 测试策略

- **单元测试**（Jest）：`DebateEngine`、`MarkerProtocol`、selector 配置
- **Android 模拟器**：对每家 AI 跑完整链路（广播→回复→辩论→总结）
- **真机冒烟**：APK 复制到手机走一遍

## 9. 交付方式

1. 本地安装：Android Studio + JDK 17 + Node.js
2. 脚手架：`npx react-native init ai-arena-android --template react-native-template-typescript`
3. 开发完构建：`npx react-native run-android --variant=release`
4. APK 发到手机安装（USB ADB 或邮件发 APK）

## 10. 风险评估

| 风险 | 可能性 | 应对 |
|---|---|---|
| AI 平台 UA 检测不一致强制跳手机版 | 中 | UA + maxTouchPoints + viewport 伪装 |
| Android WebView 版本落后 | 中 | 要求 WebView ≥ Chrome 100 |
| 手机 WebView 环境下 DOM 结构差异 | 中 | 先验证 DeepSeek（最稳）再扩展 |
| MutationObserver 节流 | 低 | App 内 WebView 都可见，不节流 |
| `injectedJavaScript` 在某些页面不触发 | 低 | `onLoadEnd` + 手动 inject 双保险 |
| 不同厂商 WebView 差异 | 低 | 先 Pixel 模拟器验证 |

## 11. 开发环境清单

- [ ] Node.js ≥ 18
- [ ] Java JDK 17
- [ ] Android Studio + SDK Platform 34 + Build Tools
- [ ] Pixel 6 API 34 模拟器
- [ ] 手机开启开发者选项 + USB 调试（真机测试用）
- [ ] `react-native-cli` / `yarn`
- [ ] 配置 Gradle / NPM 国内镜像
