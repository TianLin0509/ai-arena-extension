# 辩论流程解耦 + 千问问题 实施计划

> 下个清爽 session 直接执行。基于 2026-05-29 MCP 登录态实测的根因。

**Goal:** 让辩论中每个 AI 的发送/提取真正独立（千问卡住不拖累 gemini/豆包），并修千问发送/提取问题。

**前置（务必）:** MCP 登录态已配好——`.claude.json` playwright args 含 `--browser chromium`，config userDataDir = `C:/Users/lintian/.claude/playwright-arena-profile`（元宝/deepseek/kimi/豆包已登录）。**直接复用，绝不重登/删 profile**。验证扩展加载：navigate AI 页后 `window.__arenaMainWorldPatched === true`。

---

## 核心根因（已实测确认）

`background.js handleDebateRound`（~line 1175）两阶段串行屏障：
1. `await Promise.all(所有AI inject)` — 等最慢的千问（inject 失败还 `sleep(2000)` 重试）
2. 之后才 `ChatBus.notifyRoundStart`（chat-bus ~line 424）统一启动所有 polling

千问慢 → Promise.all 卡 → gemini/豆包 polling 启动被阻塞。**用户铁证：去掉千问就正常。**

---

### Task 1: chat-bus 抽单 AI polling 启动函数

**Files:** Modify `src/chat-bus.js`（notifyRoundStart ~line 424-457）

- [ ] 抽 `startPollingForService(p, msgId)`：把 notifyRoundStart line 433-452 的单 AI polling 启动逻辑（推占位气泡 + clearInterval 旧 poller + new state + setInterval pollOnce + pollers.set）抽成独立函数
- [ ] notifyRoundStart 改为循环调 `startPollingForService`（行为不变，仅重构）
- [ ] 暴露 `startPollingForService` 到 ChatBus 返回对象
- [ ] 加去重守卫：`startPollingForService` 内若 `pollers.has(p.service)` 且该 poller msgId 相同则跳过（防 inject 时启动 + notifyRoundStart 重复启动）

### Task 2: handleDebateRound inject 成功即独立启 polling

**Files:** Modify `src/background.js`（handleDebateRound ~line 1175-1224）

- [ ] inject map 回调里：每个 AI inject 返回 status sent/inputted 后，**立即** `ChatBus.startPollingForService(p, pendingMsgId)`（不等 Promise.all）
- [ ] Promise.all 保留（仅为 sentIds 判断 + 记录 round），但 polling 已在各 AI inject 成功时独立启动
- [ ] notifyRoundStart 调用（line 1224）改为只推用户气泡（displayText），不再统一启 polling（已在 inject 时启动）——加参数 `skipPolling: true` 或拆 `notifyRoundStartHeaderOnly`
- [ ] 确认总结/手动发送路径仍走原 notifyRoundStart（启 polling），不受影响

### Task 3: 验证独立性（MCP 实测）

- [ ] MCP 起千问+gemini+豆包，发辩论（千问慢/失败时），确认 gemini/豆包 polling 不被千问阻塞——计时各 AI 从 inject 到 polling 启动的间隔，应互相独立
- [ ] 对比改动前后：千问卡住时 gemini/豆包 提取耗时应不变

### Task 4: 千问发送失败排查

**Files:** `src/content-qwen.js` robustInject

- [ ] MCP 实测：千问 React `[role="textbox"]` 在**刚发完上一轮/后台 tab** 状态下，execCommand insertText 后 send 是否 disabled（本会话前台首次 disabled 后续 enable，需测真实多轮/后台时机）
- [ ] 若 send 时机问题：robustInject 注入后轮询等 send enable 再点（而非固定 8×400ms）
- [ ] playwright fill 必触发 send，对照其事件序列（beforeinput/input）补齐 robustInject 的事件

### Task 5: 千问"网页回答了没提取到"排查

- [ ] MCP 千问多轮，回答完成后实测 response selector `qk-markdown` + getLastNonEmpty 提取（本会话前台正常，需测多轮/后台 + streaming 完成判定是否卡）
- [ ] 检查 v5.2.21 移除 `:not(complete)` 后千问 streaming 完成判定是否正常（stop 按钮检测够不够）

---

## 注意
- 每个 Task 后跑 `node tests/e2e/smoke.mjs`（基线 578 passed / 1 modalGone flaky）
- 版本 bump 纯数字（当前 5.2.21 → 5.2.22…），4 处同步（manifest version+version_name / popup chat-version / sidepanel version+footer / smoke 断言）
- 架构改动（Task 1-2）属核心辩论流程，改完务必 MCP 实测 + 多方审查（/cli-caller）
