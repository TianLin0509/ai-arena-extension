# E2E Tests

Playwright `launchPersistentContext` 加载 unpacked 扩展跑真实 chromium。

## 运行

```bash
npm install            # 装 playwright（首次）
npx playwright install chromium   # 下载 chromium 二进制（首次，~110MB）
npm run test:e2e       # smoke 测试（24 项，UI 加载 / DOM 结构 / 版本号）
npm run test:e2e:stress # stress 测试（23 项，业务逻辑 / 屏定位 / IPC）
npm run test:e2e:all   # 两个连跑
```

## 文件

- `smoke.mjs` — 基础冒烟：加载扩展、拿 extension ID、检查 sidepanel/popup DOM、版本号 4 处一致、纯函数（renderMarkdown / labelOf）、handler 可访问
- `stress.mjs` — 深度压测：
  - **A**: `getAiTargetLayout` 真实调用 + `overlapsDisplay` 边界判定
  - **B**: `ChatBus.notifyRoundStart` mock fake participant 验证 polling 启动
  - **C**: popup ↔ background 各 handler 往返
  - **D**: 版本号 4 处同步（manifest version_name / popup chat-version / sidepanel 两处）
  - **E**: `[Arena/layout]` 诊断日志格式

## 验证 phantom 检测

stress 测试在 chromium 默认环境中**复现了"虚拟副屏"现象**——chromium 报告 2 个 displays 但其中一个不重叠主屏且无用户 window。日志显示：

```
[Arena/layout] other display 522831 notOverlap: true hasUserWindow: false
[Arena/layout] no real secondary, using current screen
```

这验证 `hasUserWindow` 过滤正确拦截 phantom，AI 窗口会落在 current screen（≠ phantom display）。

## 不依赖真实 AI 网页

测试用 `about:blank` 作为 fake AI tab，注入 `StateMachine.participants` 验证 polling 调度链路，**不需要登录 Claude/Gemini/ChatGPT**。

## 已知限制

- Service Worker 中 `chrome.runtime.sendMessage` 不触发自己的 onMessage listener，所以 sw 端 sendMessage 测试要在 popup page 上下文执行
- 真实 AI 网页交互（注入文本 / 流式读取 / DOM selector 命中）当前未自动化——这部分仍依赖手动 E2E
