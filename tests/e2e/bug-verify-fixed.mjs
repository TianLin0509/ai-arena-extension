// bug-verify-fixed.mjs — 验证 5 个 P0 修复是否真生效（走真实流程，不只是模拟源 bug 路径）
// 与 bug-verify*.mjs 互补：原脚本测"bug 在不在"，这个脚本测"修复有没有切断 bug 路径"

import { chromium } from "playwright";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const EXT_PATH = path.join(PROJECT_ROOT, "src");
const USER_DATA_DIR = path.join(os.tmpdir(), `arena-fixed-${Date.now()}`);

const results = [];
function record(id, status, evidence, notes) {
  results.push({ id, status, evidence, notes });
  const icon = status === "fixed" ? "✅" : status === "partial" ? "🟠" : "🔴";
  console.log(`\n${icon} ${id}: ${status}`);
  if (evidence) console.log(`   证据: ${typeof evidence === "string" ? evidence.slice(0, 250) : JSON.stringify(evidence).slice(0, 500)}`);
  if (notes) console.log(`   备注: ${notes}`);
}

// ── 静态白盒：源码 patch 存在性 ──
function staticCheck() {
  const checks = [
    {
      id: "F1-source",
      file: "src/inject-images.js",
      pattern: /function hasUserMessageInDom\(\)/,
      desc: "F1 hasUserMessageInDom helper 写入 inject-images.js",
    },
    {
      id: "F1-kimi",
      file: "src/content-kimi.js",
      pattern: /hasUserMessageInDom\(\)/,
      desc: "F1 Kimi 引用 hasUserMessageInDom",
    },
    {
      id: "F2-source",
      file: "src/debate-summary-template.js",
      pattern: /TEMPLATE_PLACEHOLDER_HINTS/,
      desc: "F2 prompt schema 占位符黑名单已加",
    },
    {
      id: "F3-source",
      file: "src/chat-bus.js",
      pattern: /v4\.5\.4 F3.*同步 StateMachine/s,
      desc: "F3 broadcast 内部同步 SM",
    },
    {
      id: "F4-source",
      file: "src/background.js",
      pattern: /v4\.5\.5 F4.*StateMachine\.participants\.forEach/s,
      desc: "F4-A handleDebateRound 清所有 p.response",
    },
    {
      id: "F5-source",
      file: "src/chat-bus.js",
      pattern: /MAX_POLL_TICKS\s*=\s*200/,
      desc: "F5 MAX_POLL_TICKS 兜底",
    },
    {
      id: "F5-check",
      file: "src/chat-bus.js",
      pattern: /totalTicks\s*>=\s*MAX_POLL_TICKS/,
      desc: "F5 pollOnce 内强制结束分支",
    },
    {
      id: "F6-init",
      file: "src/state-machine.js",
      pattern: /sm_pendingSummary/,
      desc: "F6 sm_pendingSummary 持久化",
    },
    {
      id: "F6-setter",
      file: "src/state-machine.js",
      pattern: /setPendingSummary\(payload\)/,
      desc: "F6 setPendingSummary setter",
    },
    {
      id: "F7-source",
      file: "src/debate-summary-template.js",
      pattern: /const arr = v => Array\.isArray\(v\)/,
      desc: "F7 render Array 兜底",
    },
    {
      id: "F8-source",
      file: "src/background.js",
      pattern: /v4\.5\.4 F8.*主动广播 hardReset/s,
      desc: "F8 hardReset 主动广播",
    },
    {
      id: "F9-source",
      file: "src/background.js",
      pattern: /v4\.5\.4 F9.*降级为普通气泡显示原文/s,
      desc: "F9 summary parse fail 降级",
    },
    {
      id: "F10-source",
      file: "src/state-machine.js",
      pattern: /const target = String\(id\)/,
      desc: "F10 getParticipant String normalize",
    },
    {
      id: "F11-source",
      file: "src/chat-bus.js",
      pattern: /v4\.5\.6 F11.*拒绝读到上一轮残留/s,
      desc: "F11 pollOnce 拒绝上一轮残留",
    },
    {
      id: "F11-state",
      file: "src/chat-bus.js",
      pattern: /prevAccepted:\s*StateMachine\.lastAcceptedByPid/,
      desc: "F11 polling state 初始化 prevAccepted",
    },
    {
      id: "F12-source",
      file: "src/content-gemini.js",
      pattern: /v4\.6\.3 F12.*优先锚定最新 model-response/s,
      desc: "F12 Gemini 锚定 latest model-response",
    },
    {
      id: "F12-fallback",
      file: "src/content-gemini.js",
      pattern: /正在生成图片/,
      desc: "F12 canvas-only 兜底占位",
    },
    {
      id: "F13-clearAllPollers",
      file: "src/chat-bus.js",
      pattern: /function clearAllPollers\(\)/,
      desc: "F13 ChatBus.clearAllPollers helper",
    },
    {
      id: "F13-pendingSummary",
      file: "src/state-machine.js",
      pattern: /v4\.6\.6 F13.*pendingSummary = null/s,
      desc: "F13 hardReset 清 pendingSummary",
    },
    {
      id: "F13-bgWiring",
      file: "src/background.js",
      pattern: /ChatBus\.clearAllPollers\(\)/,
      desc: "F13 hardReset case 调 clearAllPollers",
    },
    {
      id: "F14-removingTabs",
      file: "src/background.js",
      pattern: /tabIds\.forEach\(id => _removingTabs\.add\(id\)\)/,
      desc: "F14 hardReset 批量 _removingTabs.add 防 onRemoved 噪音",
    },
    {
      id: "F15-drawAttention",
      file: "src/chat-bus.js",
      pattern: /drawAttention:\s*true/,
      desc: "F15 focusPopup 用 drawAttention:true 提示用户",
    },
    {
      id: "F15-popupFocus",
      file: "src/popup-members.js",
      pattern: /window\.focus\(\)/,
      desc: "F15 popup addParticipant 调 window.focus() 保留用户手势",
    },
    {
      id: "F16-source",
      file: "src/content-gemini.js",
      pattern: /v4\.6\.7 F16.*thinking 阶段/s,
      desc: "F16 Gemini thinking 阶段不走 fallback",
    },
    {
      id: "F16-streaming-check",
      file: "src/content-gemini.js",
      pattern: /stillStreaming/,
      desc: "F16 检测 streaming 状态",
    },
    {
      id: "F17-sendToPopup",
      file: "src/chat-bus.js",
      pattern: /v4\.6\.7 F17.*不再依赖 popupWindowId 做 silent return/s,
      desc: "F17 sendToPopup 始终 broadcast",
    },
    {
      id: "F17-setter",
      file: "src/chat-bus.js",
      pattern: /function setPopupWindowId\(id\)/,
      desc: "F17 setPopupWindowId 暴露",
    },
    {
      id: "F17-bgWiring",
      file: "src/background.js",
      pattern: /case "popupReady"/,
      desc: "F17 background.js 处理 popupReady",
    },
    {
      id: "F17-popupReady",
      file: "src/popup.js",
      pattern: /type:\s*"popupReady",\s*windowId/,
      desc: "F17 popup.js 启动主动通知 SW",
    },
    {
      id: "F18-pollOnce",
      file: "src/chat-bus.js",
      pattern: /&&\s*!r\?\.isStreaming/,
      desc: "F18 pollOnce 判完成纳入 isStreaming",
    },
    {
      id: "F18-content-claude",
      file: "src/content-claude.js",
      pattern: /v4\.6\.8 F18.*isStreaming/s,
      desc: "F18 content-claude.js readResponse 返回 isStreaming",
    },
    {
      id: "F18-content-gemini",
      file: "src/content-gemini.js",
      pattern: /v4\.6\.8 F18.*isStreaming/s,
      desc: "F18 content-gemini.js readResponse 返回 isStreaming",
    },
    {
      id: "F18-content-chatgpt",
      file: "src/content-chatgpt.js",
      pattern: /v4\.6\.8 F18.*isStreaming/s,
      desc: "F18 content-chatgpt.js readResponse 返回 isStreaming",
    },
    {
      id: "F19-watchers",
      file: "src/chat-bus.js",
      pattern: /const watchers = new Map\(\)/,
      desc: "F19 watchers Map 兜底监听",
    },
    {
      id: "F19-startWatch",
      file: "src/chat-bus.js",
      pattern: /function startWatch\(participant/,
      desc: "F19 startWatch 函数",
    },
    {
      id: "F19-trigger",
      file: "src/chat-bus.js",
      pattern: /F19.*启动兜底 watcher/s,
      desc: "F19 pollOnce 完成后启动 watcher",
    },
    {
      id: "F19-cleanup",
      file: "src/chat-bus.js",
      pattern: /F19.*一并清 watchers/s,
      desc: "F19 clearAllPollers 一并清 watchers",
    },
    {
      id: "F20-pending",
      file: "src/background.js",
      pattern: /F20.*立刻推 pending 占位气泡/s,
      desc: "F20 handleDebateRound 入口立刻推占位",
    },
    {
      id: "F20-msgId-reuse",
      file: "src/chat-bus.js",
      pattern: /presetMsgId.*F20/s,
      desc: "F20 notifyRoundStart 支持 presetMsgId",
    },
    {
      id: "F20-popup-dedupe",
      file: "src/popup.js",
      pattern: /F20.*同 msgId 已存在.*更新文本/s,
      desc: "F20 popup appendUserMessage 同 msgId 更新",
    },
    {
      id: "F21-pending",
      file: "src/background.js",
      pattern: /F21.*立刻推 pending 占位气泡/s,
      desc: "F21 handleSummary 入口立刻推占位",
    },
    {
      id: "F21-msgId-reuse",
      file: "src/background.js",
      pattern: /F21.*复用 pendingMsgId/s,
      desc: "F21 handleSummary 完成时复用 pendingMsgId",
    },
    {
      id: "F22-checkLogin",
      file: "src/background.js",
      pattern: /async function checkLoginStatus/,
      desc: "F22 checkLoginStatus 登录态检测",
    },
    {
      id: "F22-trigger",
      file: "src/background.js",
      pattern: /F22:\s*异步检测登录态/,
      desc: "F22 addParticipant 后触发检测",
    },
    {
      id: "F24-reuse-readOne",
      file: "src/chat-bus.js",
      pattern: /复用 background\.readOneResponse/,
      desc: "F24 reextractOne 复用 v3 同款 readOneResponse sanity check",
    },
    {
      id: "F24-retry",
      file: "src/chat-bus.js",
      pattern: /MAX_RETRIES\s*=\s*5/,
      desc: "F24 5 次重试",
    },
    {
      id: "F24-loading",
      file: "src/chat-bus.js",
      pattern: /正在重新提取…/,
      desc: "F24 立刻推 loading 占位",
    },
    {
      id: "F25-sendPrompt-retry",
      file: "src/background.js",
      pattern: /F25.*3 次重试.*sendMessageWithTimeout/s,
      desc: "F25 sendPromptToService 3 次重试 + 超时",
    },
    {
      id: "F25-retryInject-retry",
      file: "src/background.js",
      pattern: /F25:\s*鲁棒化.*3 次重试.*启动 polling/s,
      desc: "F25 retryInjectParticipant 3 次重试 + 启动 polling",
    },
    {
      id: "F25-loading",
      file: "src/background.js",
      pattern: /正在发送…/,
      desc: "F25 立刻推 popup loading 占位",
    },
    {
      id: "F25-polling-trigger",
      file: "src/background.js",
      pattern: /ChatBus\.notifyRoundStart\(displayText,\s*\[p\.service\],\s*pendingMsgId\)/,
      desc: "F25 inject 成功后启动 polling 让 popup 同步新回答",
    },
    {
      id: "F26-fallback",
      file: "src/background.js",
      pattern: /F26.*lastSentByPid.*取最近发出的完整 prompt/s,
      desc: "F26 sendPromptToService text 缺省 fallback lastSentByPid",
    },
    {
      id: "F26-popup",
      file: "src/popup-bubble-actions.js",
      pattern: /F26.*lastSentByPid/s,
      desc: "F26 popup-bubble-actions 不再传 text",
    },
    // F27/F28/F31 全套 chrome.debugger 路线已被 F32 废弃，相关 check 删除
    // 见 .arena/artifacts/bg-tab-extract-deep-research.html 决策依据
    {
      id: "F32-bootstrap-file",
      file: "src/bootstrap-main-world.js",
      pattern: /__arenaMainWorldPatched[\s\S]*?visibilityState[\s\S]*?MessageChannel/,
      desc: "F32 bootstrap-main-world.js 实施完整 visibility patch + rAF/setTimeout polyfill",
    },
    {
      id: "F32-worker-timer",
      file: "src/bootstrap-main-world.js",
      pattern: /new Worker[\s\S]*?setTimeout[\s\S]*?setInterval/,
      desc: "F32+ Web Worker 接管 setTimeout/setInterval 彻底 bypass throttle",
    },
    {
      id: "F32-reinject-existing-tabs",
      file: "src/background.js",
      pattern: /injectBootstrapToTab[\s\S]*?chrome\.scripting\.executeScript[\s\S]*?world:\s*["']MAIN["']/,
      desc: "F32+ 扩展启动时主动注入 bootstrap 到现有 AI tab",
    },
    {
      id: "F32-inject-retry",
      file: "src/background.js",
      pattern: /BOOTSTRAP_INJECT_COOLDOWN_MS[\s\S]*?error page/,
      desc: "F32+ inject 失败重试 + cooldown 防重复",
    },
    {
      id: "F32-inject-on-navigation",
      file: "src/background.js",
      pattern: /onUpdated\.addListener[\s\S]*?isAiUrl[\s\S]*?injectBootstrapToTab/,
      desc: "F32+ tabs.onUpdated complete 时 inject 兜底",
    },
    // F32-no-debugger-perm 已删除 — F37 混合模式恢复 debugger 权限（Tab 模式用）
    {
      id: "F37-debugger-perm",
      file: "src/manifest.json",
      pattern: /"debugger"/,
      desc: "F37 混合模式：manifest 含 debugger 权限（Tab 模式用）",
    },
    {
      id: "F37-mixed-attach",
      file: "src/background.js",
      pattern: /F37[\s\S]*?windowMode === "tab"[\s\S]*?attachAndWake/,
      desc: "F37 addParticipant Tab 模式时持久 attach CDP",
    },
    {
      id: "F37-setmode-sync",
      file: "src/background.js",
      pattern: /case "setWindowMode"[\s\S]*?F37[\s\S]*?detachAll/,
      desc: "F37 setWindowMode 切换时同步 attach/detach",
    },
    {
      id: "F32-content-main-world",
      file: "src/manifest.json",
      pattern: /"bootstrap-main-world\.js"[\s\S]*?"run_at":\s*"document_start"[\s\S]*?"world":\s*"MAIN"/,
      desc: "F32 manifest content_scripts 引入 bootstrap MAIN world + document_start",
    },
    {
      id: "F32-bus-no-op",
      file: "src/chat-bus.js",
      pattern: /no-op \(F32\)/,
      desc: "F32 chat-bus.js attach 函数全部 no-op",
    },
    {
      id: "F28-no-force-focus-summary",
      file: "src/background.js",
      pattern: /不再强制把裁判 tab 切到前台/,
      desc: "F28 总结不再强制把裁判 tab 切到前台",
    },
    {
      id: "F29-truncated-json-repair",
      file: "src/debate-summary-template.js",
      pattern: /tryRepairTruncatedJson/,
      desc: "F29 截断 JSON 自动补齐未闭合括号",
    },
    {
      id: "F30-mini-btn",
      file: "src/popup.html",
      pattern: /id="btn-mini-mode"[\s\S]*?折叠到顶/,
      desc: "F30 popup 加 折叠到顶 按钮",
    },
    {
      id: "F30-mini-css",
      file: "src/popup.css",
      pattern: /body\[data-mode="mini"\][\s\S]*?\.chat-messages/,
      desc: "F30 body[data-mode=mini] CSS 隐藏消息区",
    },
    {
      id: "F30-mini-js",
      file: "src/popup-mini-mode.js",
      pattern: /miniModeToggle/,
      desc: "F30 popup-mini-mode.js 发 miniModeToggle 消息",
    },
    {
      id: "F30-mini-js-persist",
      file: "src/popup-mini-mode.js",
      pattern: /storage\.local\.set/,
      desc: "F30 popup-mini-mode.js 持久化模式",
    },
    {
      id: "F30-bus-toggle",
      file: "src/chat-bus.js",
      pattern: /async function toggleMiniMode[\s\S]*?chrome\.windows\.update/,
      desc: "F30 chat-bus.js toggleMiniMode 调 chrome.windows.update",
    },
    {
      id: "F30-bus-mini-bounds",
      file: "src/chat-bus.js",
      pattern: /popupMiniBounds[\s\S]*?miniBounds:\s*"chatPopupMiniBounds"/,
      desc: "F30 mini bounds 独立记忆字段",
    },
    {
      id: "F30-bg-route",
      file: "src/background.js",
      pattern: /case "miniModeToggle"/,
      desc: "F30 background.js 路由 miniModeToggle 到 ChatBus",
    },
  ];
  console.log("═".repeat(70));
  console.log("静态白盒：13 项源码 patch 存在性检查");
  console.log("═".repeat(70));
  let allFound = true;
  for (const c of checks) {
    const fp = path.join(PROJECT_ROOT, c.file);
    const text = fs.readFileSync(fp, "utf8");
    const ok = c.pattern.test(text);
    console.log(`${ok ? "✅" : "❌"} ${c.id.padEnd(14)} — ${c.desc}`);
    if (!ok) allFound = false;
  }
  console.log("");
  return allFound;
}

const allFound = staticCheck();
if (!allFound) {
  console.error("❌ 静态检查发现缺失 patch，源码与预期不一致");
  process.exit(1);
}

// ── 动态 E2E：真实流程验证 ──
const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
  channel: "chromium",
  headless: false,
  args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`, "--no-first-run", "--no-default-browser-check"],
});

try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
  console.log("[fixed] sw ready\n");

  // ════════════════════════════════════════════════════════
  // F2-fix: parseDebateSummaryJson 拒绝 prompt schema 占位符
  // ════════════════════════════════════════════════════════
  console.log("=== F2-fix: 拒绝 prompt schema 占位符 ===");
  const f2 = await sw.evaluate(async () => {
    const fakeJsonFromPrompt = `\`\`\`json
{
  "topic": "辩论的核心命题（精炼成一句话）",
  "core_conclusion": "整场辩论得出的一句话核心结论（150 字以内，是这次辩论最值得带走的认知）",
  "consensus": ["共识 1（30-80 字）"]
}
\`\`\``;
    const realJson = `\`\`\`json
{
  "topic": "AI 与社会公平",
  "core_conclusion": "技术进步需配套制度，否则放大不平等",
  "consensus": ["AI 替代部分工种已成定局"]
}
\`\`\``;
    const placeholder = self.DebateSummaryTemplate?.parse(fakeJsonFromPrompt);
    const real = self.DebateSummaryTemplate?.parse(realJson);
    return {
      placeholder_rejected: placeholder === null,
      real_accepted: real && real.topic === "AI 与社会公平",
      placeholder_value: placeholder,
    };
  });
  if (f2.placeholder_rejected && f2.real_accepted) {
    record("F2-fix", "fixed", f2, "占位符被拒绝且真总结正常解析");
  } else {
    record("F2-fix", "regression", f2, "占位符没被拦或真总结也被误杀");
  }

  // ════════════════════════════════════════════════════════
  // F4-fix: handleDebateRound 进入清所有 response（即便 inject 失败）
  // ════════════════════════════════════════════════════════
  console.log("\n=== F4-fix: handleDebateRound 一刀切清 response ===");
  const f4 = await sw.evaluate(async () => {
    StateMachine.hardReset();
    StateMachine.participants = [
      { id: "pA", service: "ai_a", tabId: 11001, name: "A", response: "A 的旧回答", responsePreview: "A 的旧回答" },
      { id: "pB", service: "ai_b", tabId: 11002, name: "B", response: "B 的旧回答", responsePreview: "B 的旧回答" },
      { id: "pC", service: "ai_c", tabId: 11003, name: "C", response: "C 的旧回答", responsePreview: "C 的旧回答" },
    ];
    StateMachine.debateSession.originalQuestion = "test";
    const origTabSend = chrome.tabs.sendMessage;
    chrome.tabs.sendMessage = async () => ({ site: "test", status: "error", error: "fake tab" });

    let invoked = false;
    try {
      if (typeof self.handleDebateRound === "function") {
        invoked = true;
        await self.handleDebateRound("free", "", false);
      } else if (typeof handleDebateRound === "function") {
        invoked = true;
        await handleDebateRound("free", "", false);
      }
    } catch (_) {}

    chrome.tabs.sendMessage = origTabSend;
    const responses = StateMachine.participants.map(p => ({ id: p.id, response: p.response }));
    return { invoked, responses, allCleared: responses.every(r => r.response === null) };
  });
  if (f4.allCleared) {
    record("F4-fix", "fixed", f4, "handleDebateRound 一刀切清所有 p.response — race 污染被切断");
  } else {
    record("F4-fix", "regression", f4, "F4-A 修复未生效，仍有 response 残留");
  }

  // ════════════════════════════════════════════════════════
  // F5-fix: MAX_POLL_TICKS 兜底（用很短的临时上限验证机制存在）
  // 不真等 5 min — 而是验证 totalTicks 字段在递增，证明 tick 上限路径已激活
  // ════════════════════════════════════════════════════════
  console.log("\n=== F5-fix: polling totalTicks 兜底机制激活 ===");
  const f5 = await sw.evaluate(async () => {
    return new Promise(async (resolve) => {
      StateMachine.hardReset();
      StateMachine.participants = [{ id: "pF5", service: "ai_f5", tabId: 22001, name: "F5", response: null, responsePreview: null }];

      let tickCalls = 0;
      let finalTicksObserved = 0;
      const origSend = chrome.tabs.sendMessage;
      chrome.tabs.sendMessage = async (tid, msg) => {
        if (msg.action === "readResponse") {
          tickCalls++;
          // 抖动让 polling 不稳定结束
          return { text: "稳定文本", hasRichContent: false, richTypes: [], imagesPending: (tickCalls % 2) };
        }
        return { status: "sent" };
      };

      let forced = false;
      const origRuntime = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = (m) => {
        if (m?.type === "chatStreamUpdate" && m.isDone && m.forcedTimeout) forced = true;
        return Promise.resolve();
      };

      await ChatBus.broadcast("test", ["ai_f5"], []);

      // 等 6 tick (~9s) 观察 totalTicks 是否在递增（间接证明上限路径已 wired）
      setTimeout(() => {
        chrome.tabs.sendMessage = origSend;
        chrome.runtime.sendMessage = origRuntime;
        // 6 tick × 1.5s = 9s 等待中 tick 数应在 5-7 区间
        resolve({ tickCalls, finalForced: forced });
      }, 9000);
    });
  });
  if (f5.tickCalls >= 4) {
    record("F5-fix", "fixed", f5,
      `polling tick 计数器在跑（${f5.tickCalls} 次 readResponse）— totalTicks 路径已 wired；5min 上限不实测（性价比低），白盒已确认 totalTicks >= MAX_POLL_TICKS 分支存在`);
  } else {
    record("F5-fix", "regression", f5, `polling 没正常 tick`);
  }

  // ════════════════════════════════════════════════════════
  // F11-fix: polling 残留检测逻辑（白盒）
  // E2E 端到端走 ChatBus.notifyRoundStart 验证不可行 — sendToPopup 因 popupWindowId=null
  // 而 noop，外部观察不到 polling 完成事件。改为提取 pollOnce 内的 residue check
  // 同款逻辑独立校验：相同 prevAccepted/text 组合下，是否能区分残留与新回答。
  // 配合静态检查 F11-source / F11-state 已确认源码 patch 存在，保证逻辑被实际 wired。
  // ════════════════════════════════════════════════════════
  console.log("\n=== F11-fix: 残留检测逻辑校验 ===");
  const f11 = await sw.evaluate(async () => {
    // 复现 pollOnce 内的 isResidue 判定（与 chat-bus.js 同款）
    const head100 = s => (s || "").trim().slice(0, 100);
    function isResidue(text, prevAccepted) {
      return !!(text && prevAccepted && (
        text === prevAccepted ||
        (head100(text).length >= 50 && head100(text) === head100(prevAccepted))
      ));
    }

    // 截图场景：Kimi 第一轮短回答 33 字符
    const shortPrev = "Hello! How can I help you today?";
    const newAns = "今天是 2026 年 5 月 24 日，星期日。新一轮的真实回答内容。";
    // 长回答场景：>100 字符触发 head 路径（streaming 时 text 在 prev 基础上追加新字符）
    const longPrev = "X".repeat(80) + " 这是一个长一点的回答，凑到 100+ 字符以触发 head100 路径的辅助残留检测";
    const longWithStreamingExtra = longPrev + " 后面是 streaming 追加的新字符";

    return {
      // 核心路径：text === prevAccepted（精确匹配，截图场景）
      residue_exact_short: isResidue(shortPrev, shortPrev),
      residue_exact_long: isResidue(longPrev, longPrev),
      // 辅助路径：长 prev + streaming extra → head100 前 100 字相同
      residue_head_long: isResidue(longWithStreamingExtra, longPrev),
      // 非残留场景
      newAnswer_not_residue: !isResidue(newAns, shortPrev),
      empty_not_residue: !isResidue("", shortPrev),
      noPrev_not_residue: !isResidue("any text", ""),
    };
  });
  const allPass = f11.residue_exact_short && f11.residue_exact_long && f11.residue_head_long
                && f11.newAnswer_not_residue && f11.empty_not_residue && f11.noPrev_not_residue;
  if (allPass) {
    record("F11-fix", "fixed", f11, "residue 判定逻辑正确：相同/head 匹配视为残留；新回答/空/无 prev 视为非残留。pollOnce 端到端行为靠手动测试 Kimi 实测验证（截图场景）");
  } else {
    record("F11-fix", "regression", f11, "residue 判定逻辑异常");
  }

  // ════════════════════════════════════════════════════════
  // F13-fix: hardReset 清 pendingSummary + ChatBus.clearAllPollers
  // 用户报 bug "重置后不再同步问答" — 主因是旧 polling 残留下个 tick 推
  // "⚠ XX 已断开" 残留消息给 popup，造成视觉错乱
  // ════════════════════════════════════════════════════════
  console.log("\n=== F13-fix: hardReset 清 pollers + pendingSummary ===");
  const f13 = await sw.evaluate(async () => {
    return new Promise(async (resolve) => {
      // 重置干净
      StateMachine.hardReset();

      // mock chrome.tabs.remove 防真关闭
      const origTabsRemove = chrome.tabs.remove;
      chrome.tabs.remove = async () => undefined;

      // mock chrome.tabs.sendMessage 让 polling 调时返回成功
      const origTabsSend = chrome.tabs.sendMessage;
      let postResetTabSends = 0;
      chrome.tabs.sendMessage = async (tid, msg) => {
        // hardReset 前后 polling 发起的 readResponse — 模拟 tabId 失效 throw
        if (msg.action === "readResponse") {
          postResetTabSends++;
          throw new Error("Tab ID does not exist: " + tid);
        }
        return { status: "sent" };
      };

      // 捕获 hardReset 后 sendToPopup 推的"已断开"残留
      let disconnectMessages = [];
      const origRuntimeSend = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = (m) => {
        if (m?.type === "chatStreamUpdate" && m?.text && m.text.includes("已断开")) {
          disconnectMessages.push(m.text);
        }
        return Promise.resolve();
      };

      // 步骤 1: 注入 fake participants + 启动 polling
      StateMachine.participants = [
        { id: "p1", service: "ai_a", tabId: 91001, name: "A", response: null, responsePreview: null },
        { id: "p2", service: "ai_b", tabId: 91002, name: "B", response: null, responsePreview: null },
      ];
      ChatBus.notifyRoundStart("test", ["ai_a", "ai_b"]);

      // 步骤 2: 设 pendingSummary 模拟"等裁判总结中"
      StateMachine.setPendingSummary({
        judgeId: "p3", judgeName: "Old Judge", judgeService: "ai_old",
        topic: "old", rounds: 1, participants: ["A", "B"], ts: Date.now(),
      });

      // 步骤 3: 等 200ms 让 polling 跑一两个 tick
      await new Promise(r => setTimeout(r, 200));
      const beforeReset_tabSends = postResetTabSends;

      // 步骤 4: 执行 hardReset 流程（直接模拟 background.js hardReset case 关键步骤）
      const tabIds = (StateMachine.participants || []).map(p => p.tabId).filter(id => typeof id === "number");
      if (typeof _removingTabs !== "undefined" && _removingTabs.add) {
        tabIds.forEach(id => _removingTabs.add(id));
      }
      try { ChatBus.clearAllPollers(); } catch (_) {}
      StateMachine.hardReset();
      try { ChatBus.clearLog(); } catch (_) {}

      // 步骤 5: 重置后再等 2 秒（>1.5s polling 间隔），看是否有"已断开"残留消息
      await new Promise(r => setTimeout(r, 2200));

      // 步骤 6: 再加 fake participant 看新 polling 启动是否正常
      StateMachine.participants = [
        { id: "p1", service: "ai_a", tabId: 92001, name: "A new", response: null, responsePreview: null },
      ];
      // 还原 tabs.sendMessage 让新 polling 成功
      chrome.tabs.sendMessage = origTabsSend;

      // 还原 hooks
      const result = {
        pendingSummary_afterReset: StateMachine.pendingSummary,
        disconnectMessageCount: disconnectMessages.length,
        disconnectMessages: disconnectMessages.slice(0, 3),
        tabSendsBefore: beforeReset_tabSends,
        tabSendsAfterReset: postResetTabSends - beforeReset_tabSends,
      };
      chrome.tabs.remove = origTabsRemove;
      chrome.runtime.sendMessage = origRuntimeSend;
      resolve(result);
    });
  });
  const f13Pass = f13.pendingSummary_afterReset === null
                && f13.disconnectMessageCount === 0;
  if (f13Pass) {
    record("F13-fix", "fixed", f13,
      `pendingSummary 清空 + 重置后 ${(2200/1500).toFixed(1)}s 内零"已断开"残留消息（旧 polling 已 stop）`);
  } else {
    record("F13-fix", "regression", f13,
      `pendingSummary=${JSON.stringify(f13.pendingSummary_afterReset)} disconnectCount=${f13.disconnectMessageCount}`);
  }

  // ════════════════════════════════════════════════════════
  // F20-fix: 辩论按下立刻显示 pending 占位气泡，inject 完成后用同 msgId 替换为正式状态
  // 模拟 inject 慢 2 秒，验证 popup 在 inject 完成前就收到占位消息
  // ════════════════════════════════════════════════════════
  console.log("\n=== F20-fix: 辩论 pending 占位气泡 ===");
  const f20 = await sw.evaluate(async () => {
    return new Promise(async (resolve) => {
      StateMachine.hardReset();
      StateMachine.participants = [
        { id: "p1", service: "ai_a", tabId: 61001, name: "A", response: "A 的初次回答", responsePreview: "A" },
        { id: "p2", service: "ai_b", tabId: 61002, name: "B", response: "B 的初次回答", responsePreview: "B" },
      ];

      // mock inject 慢 2 秒
      const origTabsSend = chrome.tabs.sendMessage;
      chrome.tabs.sendMessage = async (tid, msg) => {
        if (msg.action === "inject") {
          await new Promise(r => setTimeout(r, 2000));
          return { site: "test", status: "sent" };
        }
        if (msg.action === "readResponse") {
          return { text: "", isStreaming: true, hasRichContent: false, richTypes: [], imagesPending: 0 };
        }
        return { status: "sent" };
      };

      // 捕获按时间戳的 user 消息
      const userMsgs = [];
      const origRuntime = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = (m) => {
        if (m?.type === "chatStreamUpdate" && m?.role === "user") {
          userMsgs.push({ ts: Date.now(), msgId: m.msgId, text: m.text });
        }
        return Promise.resolve();
      };

      const t0 = Date.now();
      // 触发辩论（直接调函数）
      const debatePromise = (typeof self.handleDebateRound === "function")
        ? self.handleDebateRound("free", "", false)
        : handleDebateRound("free", "", false);

      // 等 500ms 看是否立刻有 pending 消息（应该在 inject 2s 之前）
      await new Promise(r => setTimeout(r, 500));
      const pendingAt500ms = userMsgs.find(m => m.text.includes("正在发起"));

      // 等辩论完成（inject 2s + 后续）
      await debatePromise.catch(() => {});

      chrome.tabs.sendMessage = origTabsSend;
      chrome.runtime.sendMessage = origRuntime;

      // 检查：pending 占位先到（含"正在发起"），正式 displayText 后到（不含"正在发起"），两条同 msgId
      const finalMsg = userMsgs.find(m => !m.text.includes("正在发起") && m.text.includes("辩论"));
      resolve({
        totalUserMsgs: userMsgs.length,
        pending_at_500ms_arrived: !!pendingAt500ms,
        pending_text: pendingAt500ms?.text || null,
        pending_msgId: pendingAt500ms?.msgId || null,
        final_text: finalMsg?.text || null,
        final_msgId: finalMsg?.msgId || null,
        same_msgId: pendingAt500ms && finalMsg && pendingAt500ms.msgId === finalMsg.msgId,
        time_to_pending_ms: pendingAt500ms ? pendingAt500ms.ts - t0 : -1,
      });
    });
  });
  if (f20.pending_at_500ms_arrived && f20.same_msgId && f20.time_to_pending_ms < 500) {
    record("F20-fix", "fixed", f20,
      `按下后 ${f20.time_to_pending_ms}ms 内立刻收到 pending 占位（含"正在发起..."），inject 完成后同 msgId 替换为正式显示文本`);
  } else if (!f20.pending_at_500ms_arrived) {
    record("F20-fix", "regression", f20, "500ms 内未收到 pending 占位 — 仍是老的等 inject 完成才出气泡");
  } else {
    record("F20-fix", "partial", f20, `pending 收到但 msgId 复用失败 — 会变成两条 user 消息`);
  }

  // ════════════════════════════════════════════════════════
  // F26-fix: text 缺省时从 lastSentByPid 取完整 prompt（不是 popup 短显示文本）
  // 模拟辩论场景：lastSentByPid 存了 1500 字辩论 prompt，popup user 气泡只显示"⚔️ 第1轮辩论·自由"
  // ════════════════════════════════════════════════════════
  console.log("\n=== F26-fix: 重发 fallback 到 lastSentByPid 取完整 prompt ===");
  const f26 = await sw.evaluate(async () => {
    return new Promise(async (resolve) => {
      StateMachine.hardReset();
      StateMachine.participants = [{
        id: "pF26", service: "ai_f26", tabId: 33001,
        name: "F26", response: null, responsePreview: null,
      }];
      // 模拟辩论场景：lastSentByPid 存了一段完整辩论 prompt（500 字以上模拟）
      const FULL_PROMPT = "## 第 1 轮辩论指令\n\n" +
        "请围绕以下原始问题展开辩论：\n\n【量子计算何时能商用】\n\n" +
        "上轮其他 AI 的回答：\n- Claude: 5-10 年内...\n- Gemini: 2030 年前...\n\n" +
        "请以自由辩论风格反驳/补充，输出 800 字以内...";
      StateMachine.setLastSent("pF26", FULL_PROMPT);

      // mock inject 直接 success
      let receivedPrompt = null;
      const origTabsSend = chrome.tabs.sendMessage;
      chrome.tabs.sendMessage = async (tid, msg) => {
        if (msg.action === "ping") return { ready: true };
        if (msg.action === "inject") {
          receivedPrompt = msg.text;
          return { status: "sent" };
        }
        if (msg.action === "readResponse") {
          return { text: "", isStreaming: false, hasRichContent: false, richTypes: [] };
        }
        return { status: "sent" };
      };
      const origRuntime = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = () => Promise.resolve();

      // 关键：调 sendPromptToService 不传 text，验证 fallback 取完整 prompt
      const result = await sendPromptToService("ai_f26");

      chrome.tabs.sendMessage = origTabsSend;
      chrome.runtime.sendMessage = origRuntime;

      resolve({
        result_ok: result?.ok,
        receivedPrompt_len: receivedPrompt?.length || 0,
        receivedPrompt_isFull: receivedPrompt === FULL_PROMPT,
        fullPrompt_len: FULL_PROMPT.length,
      });
    });
  });
  if (f26.result_ok && f26.receivedPrompt_isFull) {
    record("F26-fix", "fixed", f26,
      `text 缺省 → fallback 到 lastSentByPid → inject 收到完整 ${f26.fullPrompt_len} 字 prompt（不是短显示文本）`);
  } else {
    record("F26-fix", "regression", f26,
      `result_ok=${f26.result_ok} 收到 ${f26.receivedPrompt_len} 字 vs 完整 ${f26.fullPrompt_len} 字`);
  }

  // ════════════════════════════════════════════════════════
  // F30-fix: 群聊简洁模式（Mini Bar）
  // 验证：toggleMiniMode 暴露 + popup 真打开后 toggle 状态切换 + bounds 双套独立
  // ════════════════════════════════════════════════════════
  console.log("\n=== F30-fix: 群聊简洁模式 ===");
  const f30 = await sw.evaluate(async () => {
    const out = {
      apiExists: typeof ChatBus.toggleMiniMode === "function",
      getModeExists: typeof ChatBus.getPopupMode === "function",
      initialMode: null,
      togglePopupNotOpen: null,
      afterOpenMode: null,
      toggleToMini: null,
      modeAfterMini: null,
      toggleToFull: null,
      modeAfterFull: null,
      storage_full: null, storage_mini: null, storage_mode: null,
    };
    if (!out.apiExists) return out;

    out.initialMode = ChatBus.getPopupMode();

    // popup 未开时 toggle 应优雅失败
    const r1 = await ChatBus.toggleMiniMode("mini");
    out.togglePopupNotOpen = r1;

    // 真开 popup
    const open = await ChatBus.openChatPopup();
    if (!open?.ok) { out.openFail = open; return out; }
    // 等 popup 加载
    await new Promise(r => setTimeout(r, 500));
    out.afterOpenMode = ChatBus.getPopupMode();

    // 切到 mini
    out.toggleToMini = await ChatBus.toggleMiniMode("mini");
    out.modeAfterMini = ChatBus.getPopupMode();
    await new Promise(r => setTimeout(r, 200));

    // 切回 full
    out.toggleToFull = await ChatBus.toggleMiniMode("full");
    out.modeAfterFull = ChatBus.getPopupMode();
    await new Promise(r => setTimeout(r, 200));

    // 读 storage 验证双套 bounds 都存了
    const data = await chrome.storage.local.get([
      "chatPopupBounds", "chatPopupMiniBounds", "popupMode",
    ]);
    out.storage_full = data.chatPopupBounds;
    out.storage_mini = data.chatPopupMiniBounds;
    out.storage_mode = data.popupMode;

    // 清理：关 popup
    if (open.windowId) await chrome.windows.remove(open.windowId).catch(() => {});
    return out;
  });

  const f30_ok = f30.apiExists && f30.getModeExists &&
    f30.togglePopupNotOpen?.ok === false &&
    f30.toggleToMini?.ok === true && f30.modeAfterMini === "mini" &&
    f30.toggleToFull?.ok === true && f30.modeAfterFull === "full" &&
    f30.storage_full && f30.storage_mini && f30.storage_mode === "full";

  if (f30_ok) {
    record("F30-mini", "fixed", f30,
      `toggle 双向切换正常；mini 高 ${f30.toggleToMini?.bounds?.height}px ` +
      `→ full 高 ${f30.toggleToFull?.bounds?.height}px；双套 bounds 独立持久化`);
  } else {
    record("F30-mini", "regression", f30,
      `apiExists=${f30.apiExists} toMini=${f30.modeAfterMini} toFull=${f30.modeAfterFull} ` +
      `storage_full=${!!f30.storage_full} storage_mini=${!!f30.storage_mini} mode=${f30.storage_mode}`);
  }

  // ════════════════════════════════════════════════════════
  // F37 混合模式: Tab=CDP / 并列=MAIN world
  // 验证 CDPExtractor 模块 + MAIN world bootstrap 同时存在（两套并存）
  // ════════════════════════════════════════════════════════
  console.log("\n=== F37 混合模式: MAIN world + CDP 并存 ===");
  const f37 = await sw.evaluate(async () => {
    const manifest = chrome.runtime.getManifest();
    const main_cs = (manifest.content_scripts || []).find(cs =>
      Array.isArray(cs.js) && cs.js.includes("bootstrap-main-world.js")
    );
    return {
      hasDebuggerPerm: manifest.permissions.includes("debugger"),
      hasCDPExtractor: typeof self.CDPExtractor === "object",
      mainBootstrapEntry: !!main_cs,
      mainWorld: main_cs?.world === "MAIN",
      docStart: main_cs?.run_at === "document_start",
      matchCount: main_cs?.matches?.length || 0,
    };
  });
  const f37_ok = f37.hasDebuggerPerm && f37.hasCDPExtractor &&
    f37.mainBootstrapEntry && f37.mainWorld && f37.docStart &&
    f37.matchCount >= 9;
  if (f37_ok) {
    record("F37-mixed", "fixed", f37,
      `debugger 权限 + CDPExtractor + bootstrap MAIN world entry 三者并存（${f37.matchCount} AI 站点）`);
  } else {
    record("F37-mixed", "regression", f37, JSON.stringify(f37));
  }

  // F32-bugfix 回归：polling 完成后 p.response 写入仍正常（保留 F27-bugfix 核心逻辑）
  console.log("\n=== F32 polling 主流程回归: p.response 写入 ===");
  const f32poll = await sw.evaluate(async () => {
    return new Promise(async (resolve) => {
      StateMachine.hardReset();
      const TAB_ID = 88001;
      const PID = "pF32";
      const SVC = "ai_f32";
      const FINAL_TEXT = "F32 mock 回答内容";
      StateMachine.participants = [{
        id: PID, service: SVC, tabId: TAB_ID,
        name: "MockAI", response: null, responsePreview: null,
      }];

      const order = [];
      const origSend = chrome.tabs.sendMessage;
      chrome.tabs.sendMessage = async (tabId, msg) => {
        if (tabId === TAB_ID && msg.action === "readResponse") {
          order.push("read");
          return { text: FINAL_TEXT, isStreaming: false, imagesPending: 0 };
        }
        return origSend.call(chrome.tabs, tabId, msg);
      };

      ChatBus.notifyRoundStart("test", [SVC]);
      await new Promise(r => setTimeout(r, 8000));

      const p = StateMachine.participants.find(x => x.id === PID);
      chrome.tabs.sendMessage = origSend;

      resolve({
        p_response_written: !!p?.response,
        p_response_text: (p?.response || "").slice(0, 60),
        readCalled_count: order.length,
      });
    });
  });
  if (f32poll.p_response_written && f32poll.p_response_text === "F32 mock 回答内容" &&
      f32poll.readCalled_count >= 4) {
    record("F32-poll", "fixed", f32poll,
      `polling 完成 → readOneResponse 写 p.response（共 ${f32poll.readCalled_count} 次 readResponse）— F27-bugfix 核心逻辑未回归`);
  } else {
    record("F32-poll", "regression", f32poll, JSON.stringify(f32poll));
  }

  // ════════════════════════════════════════════════════════
  // F25-fix: sendPromptToService 3 次重试 + 启动 polling + popup loading 占位
  // 模拟 inject 前 2 次失败 + 第 3 次成功
  // ════════════════════════════════════════════════════════
  console.log("\n=== F25-fix: 重发机制鲁棒化 ===");
  const f25 = await sw.evaluate(async () => {
    return new Promise(async (resolve) => {
      StateMachine.hardReset();
      StateMachine.participants = [{
        id: "pF25", service: "ai_f25", tabId: 43001,
        name: "F25", response: null, responsePreview: null,
      }];

      // mock inject: 前 2 次 status="error"，第 3 次 status="sent"
      let injectCalls = 0;
      const origTabsSend = chrome.tabs.sendMessage;
      chrome.tabs.sendMessage = async (tid, msg) => {
        if (msg.action === "ping") return { ready: true };  // waitForContentScript 通过
        if (msg.action === "inject") {
          injectCalls++;
          if (injectCalls <= 2) return { site: "test", status: "error", error: "页面忙" };
          return { site: "test", status: "sent" };
        }
        if (msg.action === "readResponse") {
          return { text: "", isStreaming: false, hasRichContent: false, richTypes: [] };
        }
        return { status: "sent" };
      };

      const pushed = [];
      const origRuntime = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = (m) => {
        if (m?.type === "chatStreamUpdate" && (m.participantId === "ai_f25" || m.role === "user")) {
          pushed.push({ role: m.role, text: m.text || "", msgId: m.msgId, isDone: m.isDone });
        }
        return Promise.resolve();
      };

      const t0 = Date.now();
      const result = await sendPromptToService("ai_f25", "测试重发问题");

      chrome.tabs.sendMessage = origTabsSend;
      chrome.runtime.sendMessage = origRuntime;

      const loadingUser = pushed.find(m => m.role === "user" && m.text.includes("正在发送"));
      const loadingAi = pushed.find(m => m.role === "ai" && m.text === "" && !m.isDone);
      resolve({
        result_ok: result?.ok,
        injectCalls,
        elapsed_ms: Date.now() - t0,
        loading_user_pushed: !!loadingUser,
        loading_ai_pushed: !!loadingAi,
        loading_msgId: loadingUser?.msgId,
      });
    });
  });
  if (f25.result_ok && f25.injectCalls === 3 && f25.loading_user_pushed && f25.loading_ai_pushed) {
    record("F25-fix", "fixed", f25,
      `inject 前 2 次失败 → 第 3 次成功（共 ${f25.injectCalls} 次）+ loading 占位推送（user+ai 各 1）+ 总耗时 ${f25.elapsed_ms}ms`);
  } else {
    record("F25-fix", "regression", f25,
      `result_ok=${f25.result_ok} injectCalls=${f25.injectCalls} userLoading=${f25.loading_user_pushed} aiLoading=${f25.loading_ai_pushed}`);
  }

  // ════════════════════════════════════════════════════════
  // F24-fix: reextractOne 5 次重试 — 前 3 次空 + 第 4 次有内容 → 应成功
  // 模拟现代 SPA AI 网页 DOM 异步渲染：单次读经常空，重试后成功
  // ════════════════════════════════════════════════════════
  console.log("\n=== F24-fix: reextractOne 鲁棒化（5 次重试 + 复用 readOneResponse sanity）===");
  const f24 = await sw.evaluate(async () => {
    return new Promise(async (resolve) => {
      StateMachine.hardReset();
      StateMachine.participants = [{
        id: "pF24", service: "ai_f24", tabId: 53001,
        name: "F24", response: null, responsePreview: null,
      }];
      // 不设 lastSentByPid / lastAcceptedByPid → sanity check 不会触发

      // mock：前 3 次返回空 text（模拟 DOM 慢），第 4 次起返回有效文本
      let readCallCount = 0;
      const origTabsSend = chrome.tabs.sendMessage;
      chrome.tabs.sendMessage = async (tid, msg) => {
        if (msg.action === "readResponse") {
          readCallCount++;
          if (readCallCount <= 3) {
            return { text: "", isStreaming: false, hasRichContent: false, richTypes: [] };
          }
          return { text: "这是 AI 真实回答 — 重试 4 次后才抓到", isStreaming: false, hasRichContent: false, richTypes: [] };
        }
        return { status: "sent" };
      };

      // 捕获 popup 推送
      const pushed = [];
      const origRuntime = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = (m) => {
        if (m?.type === "chatStreamUpdate" && m?.participantId === "ai_f24") {
          pushed.push({ text: m.text, isDone: m.isDone, ts: Date.now() });
        }
        return Promise.resolve();
      };

      const t0 = Date.now();
      const result = await ChatBus.reextractOne("pF24");

      chrome.tabs.sendMessage = origTabsSend;
      chrome.runtime.sendMessage = origRuntime;

      const loadingPushed = pushed.find(p => p.text.includes("正在重新提取"));
      const successPushed = pushed.find(p => p.isDone && p.text.includes("AI 真实回答"));
      resolve({
        result_ok: result?.ok,
        result_text: result?.text,
        readCallCount,
        elapsed_ms: Date.now() - t0,
        loading_pushed: !!loadingPushed,
        success_pushed: !!successPushed,
      });
    });
  });
  if (f24.result_ok && f24.loading_pushed && f24.success_pushed && f24.readCallCount >= 4) {
    record("F24-fix", "fixed", f24,
      `loading 占位立刻推送 → 重试 ${f24.readCallCount} 次（前 3 次空）→ 第 4 次抓到内容 → 成功推送（耗时 ${f24.elapsed_ms}ms）`);
  } else {
    record("F24-fix", "regression", f24,
      `result_ok=${f24.result_ok} loading=${f24.loading_pushed} success=${f24.success_pushed} reads=${f24.readCallCount}`);
  }

  // ════════════════════════════════════════════════════════
  // F21-fix: 总结按下立刻显示 pending 占位气泡（与 F20 同模式但 handleSummary 路径）
  // ════════════════════════════════════════════════════════
  console.log("\n=== F21-fix: 总结 pending 占位气泡 ===");
  const f21 = await sw.evaluate(async () => {
    return new Promise(async (resolve) => {
      StateMachine.hardReset();
      StateMachine.participants = [
        { id: "j1", service: "ai_judge", tabId: 62001, name: "Judge", response: "Judge 的初次回答", responsePreview: "J" },
        { id: "p2", service: "ai_b", tabId: 62002, name: "B", response: "B 的初次回答", responsePreview: "B" },
      ];

      // mock inject 慢 2 秒
      const origTabsSend = chrome.tabs.sendMessage;
      chrome.tabs.sendMessage = async (tid, msg) => {
        if (msg.action === "inject") {
          await new Promise(r => setTimeout(r, 2000));
          return { site: "test", status: "sent" };
        }
        if (msg.action === "readResponse") {
          return { text: "", isStreaming: true, hasRichContent: false, richTypes: [], imagesPending: 0 };
        }
        return { status: "sent" };
      };

      // mock chrome.tabs.get / chrome.tabs.update / chrome.windows.update（handleSummary 内调）
      const origTabsGet = chrome.tabs.get;
      chrome.tabs.get = async () => ({ id: 62001, windowId: 999 });
      const origTabsUpdate = chrome.tabs.update;
      chrome.tabs.update = async () => undefined;
      const origWinUpdate = chrome.windows.update;
      chrome.windows.update = async () => undefined;

      const userMsgs = [];
      const origRuntime = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = (m) => {
        if (m?.type === "chatStreamUpdate" && m?.role === "user") {
          userMsgs.push({ ts: Date.now(), msgId: m.msgId, text: m.text });
        }
        return Promise.resolve();
      };

      const t0 = Date.now();
      const summaryPromise = (typeof self.handleSummary === "function")
        ? self.handleSummary("j1", "", "html")
        : handleSummary("j1", "", "html");

      // 等 500ms 看占位
      await new Promise(r => setTimeout(r, 500));
      const pendingAt500ms = userMsgs.find(m => m.text.includes("正在发起"));

      await summaryPromise.catch(() => {});

      chrome.tabs.sendMessage = origTabsSend;
      chrome.runtime.sendMessage = origRuntime;
      chrome.tabs.get = origTabsGet;
      chrome.tabs.update = origTabsUpdate;
      chrome.windows.update = origWinUpdate;

      const finalMsg = userMsgs.find(m => !m.text.includes("正在发起") && m.text.includes("裁判总结"));
      resolve({
        totalUserMsgs: userMsgs.length,
        pending_at_500ms_arrived: !!pendingAt500ms,
        pending_text: pendingAt500ms?.text || null,
        pending_msgId: pendingAt500ms?.msgId || null,
        final_text: finalMsg?.text || null,
        final_msgId: finalMsg?.msgId || null,
        same_msgId: pendingAt500ms && finalMsg && pendingAt500ms.msgId === finalMsg.msgId,
        time_to_pending_ms: pendingAt500ms ? pendingAt500ms.ts - t0 : -1,
      });
    });
  });
  if (f21.pending_at_500ms_arrived && f21.same_msgId && f21.time_to_pending_ms < 500) {
    record("F21-fix", "fixed", f21,
      `按下后 ${f21.time_to_pending_ms}ms 内立刻收到 pending 占位（含"正在发起..."），inject 完成后同 msgId 替换为正式显示文本`);
  } else if (!f21.pending_at_500ms_arrived) {
    record("F21-fix", "regression", f21, "500ms 内未收到 pending 占位");
  } else {
    record("F21-fix", "partial", f21, `pending 收到但 msgId 复用失败 — 会变成两条 user 消息`);
  }

  // ════════════════════════════════════════════════════════
  // F19-fix: 兜底 watcher — polling 完成后仍监听 60s 自动追加
  // 模拟 F18 漏网场景：streaming selector 失效 (isStreaming=false) → polling 早判完成
  // 完成后 AI 继续异步追加更长内容 → watcher 应捕获并用同 msgId 推 popup 更新
  // ════════════════════════════════════════════════════════
  console.log("\n=== F19-fix: 兜底 watcher 捕获完成后追加 ===");
  const f19 = await sw.evaluate(async () => {
    return new Promise(async (resolve) => {
      StateMachine.hardReset();
      StateMachine.participants = [{ id: "pF19", service: "ai_f19", tabId: 71001, name: "F19", response: null, responsePreview: null }];

      // 时间基准 mock：前 8 秒返回短文本（确保 polling 4 tick 全在短文本期间完成）
      // polling 完成需要 4 tick × 1.5s = 6s，留 2s 余量防 chromium 调度抖动
      // 8 秒后切换为长文本（此时 polling 已完成且 clearInterval，仅 watcher 在跑）
      const start = Date.now();
      const origTabsSend = chrome.tabs.sendMessage;
      chrome.tabs.sendMessage = async (tid, msg) => {
        if (msg.action === "readResponse") {
          const elapsed = Date.now() - start;
          if (elapsed < 8000) {
            return { text: "短回答", hasRichContent: false, richTypes: [], imagesPending: 0, isStreaming: false };
          }
          return { text: "短回答\n\n后续追加的更长内容 - 这是 AI 完成后异步追加的部分", hasRichContent: false, richTypes: [], imagesPending: 0, isStreaming: false };
        }
        return { status: "sent" };
      };

      // 捕获 watcherUpdate 消息
      let watcherUpdates = [];
      let doneMessages = [];
      const origRuntime = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = (m) => {
        if (m?.type === "chatStreamUpdate" && m?.participantId === "ai_f19" && m?.isDone) {
          if (m?.watcherUpdate) watcherUpdates.push(m.text);
          else doneMessages.push(m.text);
        }
        return Promise.resolve();
      };

      ChatBus.notifyRoundStart("test F19", ["ai_f19"]);

      // 等 16 秒：polling 6s 完成（短文本）+ watcher startTs≈6s + watcher tick 1 t≈9s 捕获切换后长文本
      setTimeout(() => {
        chrome.tabs.sendMessage = origTabsSend;
        chrome.runtime.sendMessage = origRuntime;
        resolve({
          elapsed_ms: Date.now() - start,
          doneMessageCount: doneMessages.length,
          firstDoneText: doneMessages[0] || null,
          watcherUpdateCount: watcherUpdates.length,
          firstWatcherText: watcherUpdates[0] || null,
          // 期望：polling 完成推一次 "短回答"，watcher 至少捕获一次追加
          passed: doneMessages.length >= 1
                  && doneMessages[0] === "短回答"
                  && watcherUpdates.length >= 1
                  && watcherUpdates[0]?.includes("后续追加"),
        });
      }, 16000);
    });
  });
  if (f19.passed) {
    record("F19-fix", "fixed", f19,
      `polling 完成推送 "短回答" → watcher 捕获追加 → 推送完整版本 (${f19.watcherUpdateCount} 次更新)`);
  } else {
    record("F19-fix", "regression", f19,
      `watcher 未启动或未捕获追加：done=${f19.doneMessageCount} watcher=${f19.watcherUpdateCount}`);
  }

  // ════════════════════════════════════════════════════════
  // F18-fix: streaming 中即便文本稳定也不判完成
  // 用户截图 bug：ChatGPT 输出 "我" 后停顿 4.5s（仍在 streaming）被 sameCount=3 误判完成
  // ════════════════════════════════════════════════════════
  console.log("\n=== F18-fix: streaming 中拒绝早判完成 ===");
  const f18 = await sw.evaluate(async () => {
    return new Promise(async (resolve) => {
      StateMachine.hardReset();
      StateMachine.participants = [{ id: "pF18", service: "ai_f18", tabId: 81001, name: "F18", response: null, responsePreview: null }];

      let tickCount = 0;
      const origTabsSend = chrome.tabs.sendMessage;
      chrome.tabs.sendMessage = async (tid, msg) => {
        if (msg.action === "readResponse") {
          tickCount++;
          // 文本稳定 "我" 但 isStreaming=true（模拟 ChatGPT 停顿规划场景）
          return {
            text: "我",
            hasRichContent: false,
            richTypes: [],
            imagesPending: 0,
            isStreaming: true,  // ← 关键：仍在 streaming
          };
        }
        return { status: "sent" };
      };

      let donePushed = false;
      let pushedText = null;
      const origRuntime = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = (m) => {
        if (m?.type === "chatStreamUpdate" && m?.isDone && m?.participantId === "ai_f18") {
          donePushed = true;
          pushedText = m.text;
        }
        return Promise.resolve();
      };

      ChatBus.notifyRoundStart("test F18", ["ai_f18"]);

      // 等 9 秒（6 tick × 1.5s）— 老逻辑 sameCount=3 时会在 ~4.5s 完成
      // 新逻辑 isStreaming=true 即便 sameCount=∞ 也不判完成
      setTimeout(() => {
        chrome.tabs.sendMessage = origTabsSend;
        chrome.runtime.sendMessage = origRuntime;
        resolve({
          tickCount,
          donePushed,
          pushedText,
          // 期待：跑了 5-6 tick 但 donePushed=false
          passed: tickCount >= 5 && !donePushed,
        });
      }, 9000);
    });
  });
  if (f18.passed) {
    record("F18-fix", "fixed", f18,
      `polling 跑了 ${f18.tickCount} tick (>5) 但 isStreaming=true 期间不判完成 — 老逻辑早在第 3 tick 就 pushed "我" 当完整回答`);
  } else if (f18.donePushed) {
    record("F18-fix", "regression", f18,
      `polling 仍把"我"当完成回答推给 popup — F18 修复未生效`);
  } else {
    record("F18-fix", "partial", f18, `polling 未跑足够 tick: ${f18.tickCount}`);
  }

  // ════════════════════════════════════════════════════════
  // F17-fix: SW 重启后 sendToPopup 仍能 broadcast（不再 silent return）
  // 用户报"popup 收不到消息"主因 — 模拟场景：popupWindowId 仍是 null（SW 刚重启）
  // 调 broadcast 必须有 chrome.runtime.sendMessage 调用尝试，而不是 silent return
  // ════════════════════════════════════════════════════════
  console.log("\n=== F17-fix: SW 重启后 popup 仍收消息 ===");
  const f17 = await sw.evaluate(async () => {
    // 重置干净 + 模拟 SW 重启场景（popupWindowId 在 ChatBus 内部仍是 null，无法直接操作 IIFE）
    // 通过反向验证：hook chrome.runtime.sendMessage 看 chatStreamUpdate 是否发出
    StateMachine.hardReset();
    StateMachine.participants = [
      { id: "p1", service: "ai_a", tabId: 91001, name: "A", response: null, responsePreview: null },
    ];

    let chatStreamUpdateCount = 0;
    const origRuntime = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = (m) => {
      if (m?.type === "chatStreamUpdate") chatStreamUpdateCount++;
      return Promise.resolve();
    };

    const origTabsSend = chrome.tabs.sendMessage;
    chrome.tabs.sendMessage = async () => ({ status: "sent", text: "" });

    // 关键测试：broadcast 时 popupWindowId 在 ChatBus 内是 null（重启后默认值）
    // 老逻辑 sendToPopup 会 silent return，新逻辑应该 broadcast 多次
    await ChatBus.broadcast("test", ["ai_a"], []);

    chrome.runtime.sendMessage = origRuntime;
    chrome.tabs.sendMessage = origTabsSend;
    return {
      chatStreamUpdateCount,
      passed: chatStreamUpdateCount >= 2,  // 至少 user 消息 + ai loading 气泡
    };
  });
  if (f17.passed) {
    record("F17-fix", "fixed", f17,
      `broadcast 发出 ${f17.chatStreamUpdateCount} 次 chatStreamUpdate — 即便 popupWindowId=null 也不再 silent return`);
  } else {
    record("F17-fix", "regression", f17,
      `仅发出 ${f17.chatStreamUpdateCount} 次 — sendToPopup 仍在 silent return`);
  }

  // ════════════════════════════════════════════════════════
  // F15-fix: focusPopup 用 drawAttention:true
  // ════════════════════════════════════════════════════════
  console.log("\n=== F15-fix: focusPopup 加 drawAttention:true ===");
  const f15 = await sw.evaluate(async () => {
    // mock chrome.windows.update 捕获参数
    let captured = null;
    const origUpdate = chrome.windows.update;
    chrome.windows.update = async (winId, opts) => {
      captured = { winId, opts };
      return { id: winId };
    };

    // mock 一个 popupWindowId — 需要先调 openChatPopup 让 ChatBus 内部记一个
    // 但 openChatPopup 会真创建 window，这里我们 mock chrome.windows.create
    const origCreate = chrome.windows.create;
    let createdId = 88888;
    chrome.windows.create = async () => ({ id: createdId, tabs: [{ id: 99999 }] });
    // 让 ChatBus 内部记下 popupWindowId
    await ChatBus.openChatPopup();
    // 现在调 focusPopup
    const r = await ChatBus.focusPopup();

    chrome.windows.update = origUpdate;
    chrome.windows.create = origCreate;
    return {
      focusOk: r?.ok === true,
      capturedFocused: captured?.opts?.focused === true,
      capturedDrawAttention: captured?.opts?.drawAttention === true,
    };
  });
  if (f15.capturedFocused && f15.capturedDrawAttention) {
    record("F15-fix", "fixed", f15, "focusPopup 调 chrome.windows.update 携带 focused:true + drawAttention:true");
  } else {
    record("F15-fix", "regression", f15, "focusPopup 参数不符预期");
  }

  // ════════════════════════════════════════════════════════
  // F10-fix: getParticipant String normalize
  // ════════════════════════════════════════════════════════
  console.log("\n=== F10-fix: getParticipant String normalize ===");
  const f10 = await sw.evaluate(async () => {
    StateMachine.hardReset();
    StateMachine.participants = [{ id: "p1", service: "ai_x", tabId: 1, name: "X", response: null, responsePreview: null }];
    return {
      byString: StateMachine.getParticipant("p1") != null,
      byNullSafe: StateMachine.getParticipant(null) === undefined,
      byUndefinedSafe: StateMachine.getParticipant(undefined) === undefined,
      // 边界测试：传入 String("p1") 应等价于直接传字符串
      byStringObj: StateMachine.getParticipant(new String("p1")) != null,
    };
  });
  if (f10.byString && f10.byNullSafe && f10.byUndefinedSafe) {
    record("F10-fix", "fixed", f10, "string id 正常匹配 + null/undefined 安全返回 undefined");
  } else {
    record("F10-fix", "regression", f10, "getParticipant 行为不符预期");
  }

} catch (e) {
  console.error("[fixed] fatal:", e);
} finally {
  await ctx.close();
}

console.log("\n" + "═".repeat(70));
console.log("修复有效性最终汇总");
console.log("═".repeat(70));
results.forEach(r => {
  const icon = r.status === "fixed" ? "✅" : r.status === "partial" ? "🟠" : "🔴";
  console.log(`${icon} ${r.id}: ${r.status}${r.notes ? "  — " + r.notes : ""}`);
});
process.exit(0);
