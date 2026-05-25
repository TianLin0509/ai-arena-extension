// AI Arena — Background Service Worker v3.0.0

// 从 sidepanel 缓存的屏幕尺寸；双屏时用于判断 AI 窗口应放到哪块屏幕。
let lastKnownScreen = { width: 1920, height: 1080, left: 0, top: 0 };

// v4.8.29 F37 混合模式: Tab 模式走 chrome.debugger 持久 attach（黄条不影响 UI），
// 并列模式走 MAIN world visibility patch（无黄条）— 两套并存按需启用
importScripts("selectors-config.js", "state-machine.js", "templates-builtin.js", "template-store.js", "debate-engine.js", "cdp-extractor.js", "chat-bus.js", "ppt-prompts.js", "debate-summary-template.js");

const SERVICES = {
  claude:   { url: "https://claude.ai/new",              name: "Claude" },
  gemini:   { url: "https://gemini.google.com/app",      name: "Gemini" },
  chatgpt:  { url: "https://chatgpt.com",                name: "ChatGPT" },
  deepseek: { url: "https://chat.deepseek.com",          name: "DeepSeek" },
  doubao:   { url: "https://www.doubao.com/chat",        name: "豆包" },
  qwen:     { url: "https://www.qianwen.com",             name: "千问" },
  kimi:     { url: "https://www.kimi.com",               name: "Kimi" },
  yuanbao:  { url: "https://yuanbao.tencent.com/chat",   name: "元宝" },
  grok:     { url: "https://grok.com",                   name: "Grok" },
};

const MAX_PARTICIPANTS = 3;
const _removingTabs = new Set();
let _modeSwitchPromise = Promise.resolve();  // v4.8.30 F38-②: setWindowMode 切换串行化
let windowMode = "tiled"; // "tab" | "tiled"
// v4.8.30 F38-①: windowMode 异步加载竞态修复 — 包成 Promise 加入 initPromise，
// 让 injectBootstrapToExistingTabs 等 windowMode 真加载完再分流 tab/tiled 路径
const _windowModeLoaded = new Promise(resolve => {
  chrome.storage.local.get("windowMode", (d) => {
    if (d.windowMode === "tab" || d.windowMode === "tiled") windowMode = d.windowMode;
    resolve();
  });
});

// ── 初始化 ──
const initPromise = Promise.all([StateMachine.init(), ChatBus.init(), _windowModeLoaded]);

// v4.2.0 Phase 2: 默认点扩展图标 → 开 popup 群聊窗口（而非 sidepanel）
// sidepanel 仍可通过 popup 内"打开 sidepanel"按钮或 openSidepanel message 进入
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});

chrome.action.onClicked.addListener(async () => {
  try {
    await ChatBus.openChatPopup();
  } catch (e) {
    console.warn("[Arena] action.onClicked openChatPopup fail:", e);
    // fallback: 退化到 sidepanel
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.windowId != null) {
        await chrome.sidePanel.open({ windowId: tabs[0].windowId });
      }
    } catch (_) {}
  }
});

// ── 右键菜单 ──
// v4.3.9/12: MV3 SW 重启 / 扩展 reload 时 onInstalled 可能重复触发 → 同 id create 报错。
// 双层兜底：① async/await + try/catch 任一步骤失败都不抛 ② lastError 也消费
async function ensureContextMenu() {
  try {
    await chrome.contextMenus.removeAll();
  } catch (e) {
    console.warn("[Arena] contextMenus.removeAll:", e?.message);
  }
  try {
    await chrome.contextMenus.create({
      id: "ai-arena-ask",
      title: "用 AI Arena 提问",
      contexts: ["selection"],
    });
  } catch (e) {
    // 即使理论上 removeAll 后 create 不该重复，也兜底吞掉
    console.warn("[Arena] contextMenus.create:", e?.message);
  }
  // 显式消费 lastError 防 Chrome 错误页弹红字
  if (chrome.runtime.lastError) {
    console.warn("[Arena] runtime.lastError consumed:", chrome.runtime.lastError.message);
  }
}
chrome.runtime.onInstalled.addListener(ensureContextMenu);
chrome.runtime.onStartup.addListener(ensureContextMenu);
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "ai-arena-ask" && info.selectionText) {
    chrome.runtime.sendMessage({ type: "contextMenuText", text: info.selectionText }).catch(() => {});
    if (tab?.windowId) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
});

// v4.8.19 F32: 旧 injectVisibilityOverride 已删除 — manifest content_scripts
// bootstrap-main-world.js 在 document_start 即注入完整 visibility patch（更早、更全）

// v4.8.20 F32+: 扩展启动时主动注入 bootstrap-main-world.js 到现有 AI tab
// 原因：manifest content_scripts 只对 navigation 时生效。用户 reload 扩展但
// AI tab 没刷新时，bootstrap 不会注入 → 仍被 background throttle。
// 这里 onInstalled / onStartup 主动给所有 AI tab 注入一次。
const AI_URL_PATTERNS = [
  "https://claude.ai/*",
  "https://gemini.google.com/*",
  "https://chatgpt.com/*",
  "https://chat.deepseek.com/*",
  "https://www.doubao.com/*",
  "https://tongyi.aliyun.com/*",
  "https://www.qianwen.com/*",
  "https://kimi.moonshot.cn/*",
  "https://www.kimi.com/*",
  "https://yuanbao.tencent.com/*",
  "https://grok.com/*",
];
// v4.8.21 F32+: cooldown + 失败重试 + onUpdated 兜底
const _lastBootstrapInject = new Map();  // tabId -> timestamp
const BOOTSTRAP_INJECT_COOLDOWN_MS = 5000;

async function injectBootstrapToTab(tabId, url, reason) {
  const last = _lastBootstrapInject.get(tabId);
  if (last && Date.now() - last < BOOTSTRAP_INJECT_COOLDOWN_MS) {
    return { ok: true, skipped: "cooldown" };
  }
  // 失败重试 1 次（针对 "Frame is showing error page" 这种 navigation 瞬态）
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        files: ["bootstrap-main-world.js"],
      });
      _lastBootstrapInject.set(tabId, Date.now());
      console.log(`[F32+] ✅ inject tab=${tabId} reason=${reason}${attempt > 0 ? ` retry=${attempt}` : ""} url=${url?.slice(0, 50)}`);
      return { ok: true };
    } catch (e) {
      const msg = e?.message || String(e);
      // 第一次失败若是 navigation 瞬态错误，延迟 1.5s 重试
      if (attempt === 0 && /error page|cannot access|no tab|frame.*error/i.test(msg)) {
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      console.warn(`[F32+] ❌ inject tab=${tabId} reason=${reason} attempt=${attempt} url=${url?.slice(0, 50)}: ${msg}`);
      return { ok: false, error: msg };
    }
  }
}

async function injectBootstrapToExistingTabs() {
  // v4.8.30 F38-①: 等 windowMode 真加载完（tab/tiled 影响下面的 CDP 路由）
  try { await _windowModeLoaded; } catch (_) {}
  console.log(`[F32+] scan existing AI tabs (mode=${windowMode})`);
  let injected = 0, failed = 0, totalMatched = 0;
  const aiTabIds = [];
  for (const pattern of AI_URL_PATTERNS) {
    try {
      const tabs = await chrome.tabs.query({ url: pattern });
      totalMatched += tabs.length;
      for (const tab of tabs) {
        aiTabIds.push({ id: tab.id, windowId: tab.windowId });
        const r = await injectBootstrapToTab(tab.id, tab.url, "startup");
        if (r.ok && !r.skipped) injected++;
        else if (!r.ok) failed++;
      }
    } catch (e) {
      console.warn(`[F32+] query fail pattern=${pattern}:`, e?.message);
    }
  }
  console.log(`[F32+] scan DONE matched=${totalMatched} injected=${injected} failed=${failed}`);

  // v4.8.34: 取消并列模式下的 activateAiWindowsOnce — 用户反馈"扫一遍 AI 窗口"视觉抖动
  //   旧行为（v4.8.26-v4.8.33）：chrome 启动后第一次激活扩展，把每个已开的 AI window
  //   依次 focus 800ms 再还原原焦点，3 个窗口 = 2.4s 可见抖动。
  //   新行为：扩展启动时只静默注入 bootstrap JS（已在 injectBootstrapToTab 完成）。
  //   代价：首次辩论前 AI tab 可能仍被 chrome heavy-throttle，但辩论代码本身会
  //   tabs.update(active:true) 切到目标 tab，chrome 自动解 throttle。
  //   Tab 模式 CDP attachAndWake 保留（无视觉抖动）。
  if (windowMode === "tab" && self.CDPExtractor && aiTabIds.length) {
    console.log(`[F37] tab mode, attaching ${aiTabIds.length} existing AI tab(s)`);
    for (const { id } of aiTabIds) {
      try {
        const r = await self.CDPExtractor.attachAndWake(id);
        console.log(`[F37] attach tab=${id} ok=${r?.ok} code=${r?.code}`);
      } catch (_) {}
    }
  }
  // 并列模式：不再做强制 focus（v4.8.34）
}

// v4.8.34: activateAiWindowsOnce / _activatedOnce / storage.session activatedOnce 整套删除
// （视觉抖动元凶；详见上方注释）

// 触发 1: 安装 / 启动 / SW 唤醒
chrome.runtime.onInstalled.addListener(() => { injectBootstrapToExistingTabs(); });
chrome.runtime.onStartup.addListener(() => { injectBootstrapToExistingTabs(); });
injectBootstrapToExistingTabs();

// 触发 2: AI tab navigation 完成时兜底（最可靠的时机，error page 瞬态已过）
function isAiUrl(url) {
  if (!url) return false;
  return AI_URL_PATTERNS.some(p => {
    try {
      const re = new RegExp("^" + p.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
      return re.test(url);
    } catch { return false; }
  });
}
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!isAiUrl(tab.url)) return;
  injectBootstrapToTab(tabId, tab.url, "navigation");
});

// v4.8.23 F33: 删除冗余 auto-reconnect inject —— 真凶
// 老代码 onUpdated complete 时给 AI tab 主动 inject content-${service}.js
// 但 manifest content_scripts 已经在 document_idle 自动注入了 → 第二次 inject
// 导致 `const SITE = "deepseek"` 重复声明 SyntaxError → 整个 script 抛错 →
// chrome.runtime.onMessage listener 注册失败 → sendMessage readResponse 收不到
// 响应 → polling 读到空文本 → 45s empty timeout → "未提取到内容"
//
// manifest content_scripts 已经处理 navigation 重注入，auto-reconnect 是冗余

// ── 标签页关闭 → 直接移除参与者 ──
chrome.tabs.onRemoved.addListener((closedId) => {
  // v4.8.30 F38-⑤: 显式 detach CDP 防 attachedTabs Map 残留 stale 条目
  // （onDetach 事件通常会兜底但异常路径可能漏发）
  if (self.CDPExtractor) self.CDPExtractor.detach(closedId).catch(() => {});
  if (_removingTabs.delete(closedId)) return; // We initiated this removal
  const p = StateMachine.participants.find(p => p.tabId === closedId);
  if (p) {
    StateMachine.removeParticipant(p.id);
    notifyStatus(`${p.name} 标签页已关闭，已移除`);
    StateMachine._broadcastStateUpdate();
  }
});
chrome.windows.onRemoved.addListener((windowId) => {
  ChatBus.onWindowRemoved(windowId);
});
chrome.windows.onBoundsChanged?.addListener((win) => {
  ChatBus.rememberBounds(win.id);
});

// ── 消息处理 ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  initPromise.then(async () => {
    try {
      switch (msg.type) {
        case "addParticipant":
          if (msg.screen) lastKnownScreen = msg.screen;
          sendResponse(await addParticipant(msg.service)); break;
        case "removeParticipant": sendResponse(await removeParticipant(msg.id)); break;
        case "broadcast":         sendResponse(await handleBroadcast(msg.text, msg.images)); break;
        case "debateRound":       sendResponse(await handleDebateRound(msg.style, msg.guidance, msg.concise, msg.force)); break;
        case "summary":           sendResponse(await handleSummary(msg.judgeId, msg.customInstruction, msg.format)); break;
        case "checkAllCompletion": sendResponse(await checkAllCompletion()); break;
        case "focusTab":          sendResponse(await handleFocusTab(msg.id)); break;
        case "readOneResponse":   sendResponse(await readOneResponse(msg.participantId)); break;
        case "sendPromptToService": sendResponse(await sendPromptToService(msg.service || "chatgpt", msg.text || "")); break;
        case "exportSession":     sendResponse(exportSession()); break;
        case "getState":          sendResponse(StateMachine.getFullState()); break;
        case "getSelectors":      sendResponse(DEFAULT_SELECTORS[msg.platform] || {}); break;
        case "setWindowMode": {
          // v4.8.29 F37 混合模式: 切换 Tab/并列 时同步 attach/detach CDP
          // v4.8.30 F38-②: Promise chain 串行化防快速切换竞态（attach fire-and-forget
          // 还没完成 detachAll 看到空 Map → 残留 debugger attach）
          const oldMode = windowMode;
          windowMode = msg.mode;
          chrome.storage.local.set({ windowMode: msg.mode });
          _modeSwitchPromise = _modeSwitchPromise.then(async () => {
            if (!self.CDPExtractor) return;
            if (msg.mode === "tab" && oldMode !== "tab") {
              console.log(`[F37] mode → tab, attaching ${StateMachine.participants.length} AI tabs (serial)`);
              for (const p of StateMachine.participants) {
                if (p.tabId) await self.CDPExtractor.attachAndWake(p.tabId).catch(() => {});
              }
            } else if (msg.mode === "tiled" && oldMode === "tab") {
              console.log(`[F37] mode → tiled, detaching all CDP (after prior attach finished)`);
              await self.CDPExtractor.detachAll();
            }
          }).catch(e => console.warn("[F38] mode switch chain:", e?.message));
          await _modeSwitchPromise;
          sendResponse({ ok: true });
          break;
        }
        case "arrangeWindows":
          if (msg.screen) lastKnownScreen = msg.screen;
          sendResponse(await arrangeWindows(msg.screen || lastKnownScreen));
          break;
        case "openChatPopup":
          sendResponse(await ChatBus.openChatPopup()); break;
        case "miniModeToggle":
          // v4.8.15 F30: popup-mini-mode.js 触发，resize popup window 到 mini/full
          sendResponse(await ChatBus.toggleMiniMode(msg.mode)); break;
        case "miniMenuExpand":
          // v4.8.28: mini 模式下 task-menu 打开时临时撑大窗口让菜单向下露出
          sendResponse(await ChatBus.miniMenuExpand(msg.expand)); break;
        // v4.8.31: 删除 setMiniSkip — mini 头像点击改 removeParticipant 共享 hero-slot 逻辑
        case "popupReady":
          // v4.6.7 F17: popup DOMContentLoaded 主动告知 SW 自己的 windowId
          // SW 重启后 ChatBus.popupWindowId 是 null，靠这条消息恢复
          if (typeof msg.windowId === "number") ChatBus.setPopupWindowId(msg.windowId);
          sendResponse({ ok: true });
          break;
        case "chatBroadcast":
          sendResponse(await ChatBus.broadcast(msg.text, msg.targets || [], msg.images || [])); break;
        case "chatRestoreLog":
          sendResponse({ messages: ChatBus.getLog() }); break;
        case "chatClear":
          ChatBus.clearLog(); sendResponse({ ok: true }); break;
        case "chatJumpToOrigin":
          sendResponse(await ChatBus.jumpToOrigin(msg.participantId)); break;
        case "chatReextractOne":
          sendResponse(await ChatBus.reextractOne(msg.participantId)); break;
        case "chatSkipParticipant":
          sendResponse(ChatBus.skipParticipant(msg.participantId, msg.msgId)); break;

        // ── 手动操作 ──
        case "sendToOne":
          sendResponse(await sendToOneParticipant(msg.participantId));
          break;
        case "retryInject":
          sendResponse(await retryInjectParticipant(msg.id));
          break;
        case "resetSession":
          StateMachine.resetSession();
          notifyStatus("会话已重置");
          sendResponse({ ok: true });
          break;
        case "hardReset":
          // v4.3.6: hardReset 之前关闭所有 AI 网页 tab
          // v4.6.6 F14: 提前批量加入 _removingTabs 防 chrome.tabs.onRemoved 监听器
          // 对每个 tab 触发一次 removeParticipant + _broadcastStateUpdate + notifyStatus
          // （N 次重复噪音 + 给 popup-members 推 N+1 次 stateUpdate 抖动）
          try {
            const tabIds = (StateMachine.participants || [])
              .map(p => p.tabId)
              .filter(id => typeof id === "number");
            if (tabIds.length) {
              tabIds.forEach(id => _removingTabs.add(id));
              await chrome.tabs.remove(tabIds).catch(() => {});
            }
          } catch (_) {}
          // v4.6.6 F13: 清 polling — 防旧 polling 下个 tick 调失效 tabId 触发 catch
          // 推送"⚠ XX 已断开"残留消息到 popup（用户报"重置后不再同步问答"主因）
          try { ChatBus.clearAllPollers(); } catch (_) {}
          StateMachine.hardReset();
          try { ChatBus.clearLog(); } catch (_) {}
          // v4.5.4 F8: 主动广播 hardReset 让 popup-members 清空 streamStatus，
          // 否则重置后立即添加同 service 新 AI，其状态会显示上一次的 ready/error 鬼影
          chrome.runtime.sendMessage({ type: "hardReset" }).catch(() => {});
          notifyStatus("已彻底重置（AI 标签页 + 群聊 + 辩论上下文）");
          sendResponse({ ok: true });
          break;
        case "pptBuildPrompt": {
          // v4.3.0：popup PPT 工坊调此 handler 拿 prompt 字符串
          try {
            const kind = msg.kind || "copy";
            const templateKey = msg.template || "intro";
            const state = StateMachine.getFullState();
            const participants = state.participants || [];
            // 从 participants.response 收集讨论
            const responses = (StateMachine.participants || [])
              .filter(p => (p.response || p.responsePreview || "").trim())
              .map(p => ({ name: p.name || p.service, text: (p.response || p.responsePreview || "").trim() }));
            const question = msg.question || "";
            const ctx = { question, responses, imageBrief: msg.imageBrief || "" };
            let prompt = "";
            if (kind === "copy") prompt = self.PptPrompts.buildCopyPrompt(ctx);
            else if (kind === "image") prompt = self.PptPrompts.buildImagePrompt(ctx, templateKey);
            else if (kind === "pptx") prompt = self.PptPrompts.buildPptxPrompt();
            else { sendResponse({ ok: false, error: `未知 kind: ${kind}` }); break; }
            sendResponse({ ok: true, prompt, template: self.PptPrompts.TEMPLATE_META[templateKey] || null });
          } catch (e) {
            sendResponse({ ok: false, error: e.message });
          }
          break;
        }
        case "openSidepanel":
          try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tabs[0]?.windowId != null && chrome.sidePanel?.open) {
              await chrome.sidePanel.open({ windowId: tabs[0].windowId });
              sendResponse({ ok: true });
            } else {
              sendResponse({ ok: false, error: "sidePanel API 不可用" });
            }
          } catch (e) {
            sendResponse({ ok: false, error: e.message });
          }
          break;

        default: sendResponse({ ok: false, error: "Unknown message type" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  });
  return true;
});

// ── v4.7.2 F22: 添加 AI 时检测登录状态 ──
// 用 chrome.scripting.executeScript 在 AI tab 跑通用启发式：DOM 含登录关键字 +
// 没有对话输入框 → 未登录。比依赖每个 content-*.js 的 isLoginBlocked 更通用。
async function checkLoginStatus(tabId, displayName, service) {
  try {
    // 等页面初步加载（DOM ready），但不强求 complete（部分 SPA 永远不到 complete）
    await new Promise(r => setTimeout(r, 3500));
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // v4.7.5 F22 启发式：CTA / Modal / URL / not-login class 四个维度任一命中即未登录

        // 1. 找登录 CTA 按钮 — selector 扩展到 div/span/li（Kimi 用 <div class="not-login-container">登录</div>）
        const LOGIN_CTA = /^(登录|登陆|登入|立即登录|账号登录|账户登录|微信登录|扫码登录|手机登录|Sign in|Sign up|Sign Up|Log in|Log In|Login|Get started|Continue with)$/i;
        const ctas = Array.from(document.querySelectorAll(
          'button, a, [role="button"], div, span, li'
        )).filter(el => {
          const t = (el.innerText || el.textContent || "").trim();
          if (!t || t.length > 10) return false;  // 收紧到 10 字
          if (!LOGIN_CTA.test(t)) return false;
          // 排除"父含子也含同样文本"的重复（取最深的）
          if (el.querySelector('*')) {
            const childTexts = Array.from(el.children).map(c => (c.innerText || "").trim());
            if (childTexts.some(ct => ct === t)) return false;
          }
          const r = el.getBoundingClientRect?.();
          return r && r.width > 20 && r.height > 10;
        });
        const hasLoginCTA = ctas.length > 0;

        // 2. 登录 modal（含登录字眼的 dialog/modal）
        const hasLoginModal = Array.from(document.querySelectorAll(
          '[role="dialog"], [class*="modal"]:not([class*="modal-hidden"]):not([class*="not-modal"])'
        )).some(el => {
          const r = el.getBoundingClientRect?.();
          if (!r || r.width < 100 || r.height < 80) return false;
          const t = (el.innerText || "").trim();
          return /登录|Sign in|Log in|Sign up|登录即可/i.test(t);
        });

        // 3. URL 路径含 login/sign_in
        const path = (location.pathname || "") + (location.hash || "");
        const urlLooksLikeLogin = /(?:^|\/)(login|signin|sign[_-]?in|sign[_-]?up|account\/(?:login|signin))(?:\/|\?|$)/i.test(path);

        // 4. v4.7.5 关键新增：明显的"未登录"class 标识（Kimi 的 not-login-container 等）
        // 这是最 strong 的信号 — 前端用 class 标记登录态时，登录后通常会替换类名
        const hasNotLoginClass = Array.from(document.querySelectorAll(
          '[class*="not-login"], [class*="not_login"], [class*="unlogin"], '
          + '[class*="un-login"], [class*="logged-out"], [class*="loggedOut"], '
          + '[class*="anonymous"], [class*="guest-user"]'
        )).some(el => {
          const r = el.getBoundingClientRect?.();
          return r && r.width > 0 && r.height > 0;
        });

        const loggedIn = !(hasLoginCTA || hasLoginModal || urlLooksLikeLogin || hasNotLoginClass);
        return { loggedIn, hasLoginCTA, hasLoginModal, urlLooksLikeLogin, hasNotLoginClass, ctaCount: ctas.length };
      },
    }).catch(() => null);
    const r = results?.[0]?.result;
    if (r && r.loggedIn === false) {
      const tipMsgId = `m${Date.now()}_login_${service}`;
      // 用同一个 chatStreamUpdate 通道推一条 ai 警告气泡（popup updateAIBubble 自动按 service 加头像）
      chrome.runtime.sendMessage({
        type: "chatStreamUpdate", role: "ai",
        msgId: tipMsgId, participantId: service,
        text: `⚠ ${displayName} 似乎未登录。请到 ${displayName} 网页登录后，点击气泡 🔄 重试 / 重新加入。`,
        isDone: true,
        loginWarning: true,
      }).catch(() => {});
      notifyStatus(`⚠ ${displayName} 未登录，提问前请先登录`);
    }
  } catch (_) {
    // 检测失败（tab 已关 / 没 scripting 权限等）不影响添加
  }
}

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

  let tabId;
  if (windowMode === "tiled") {
    // 并列模式：每个 AI 开独立窗口
    const isFirst = StateMachine.participants.length === 0;
    const targetLayout = await getAiTargetLayout(lastKnownScreen);
    // v4.8.24 F34: focused:true 让 AI window 短暂可见，触发 Chrome 内核的"曾 visible"
    // 标记 — 否则 from-never-visible tab 触发 Heavy Timer Throttling (1/min 严格 throttle)
    // 即使 visibility patch 都救不了，因为 chrome chain count 看 C++ 层 history，不看 JS getter
    // 500ms 后 focusPopup 会切回 popup，用户视觉上仅看到一瞬间 AI window 闪现
    const win = await chrome.windows.create({
      url: info.url,
      state: "normal",
      focused: true,
      ...windowBoundsForCreate(targetLayout.screen)
    });
    tabId = win.tabs[0].id;
    // 双屏时 AI 窗口放到另一屏，sidepanel 保留在用户当前屏；单屏沿用旧体验。
    if (isFirst && !targetLayout.isDifferentDisplay) chrome.sidePanel.open({ windowId: win.id }).catch(() => {});
  } else {
    // Tab 模式：同一窗口的不同标签页
    const currentWindow = await chrome.windows.getCurrent();
    const tab = await chrome.tabs.create({ url: info.url, windowId: currentWindow.id, active: false });
    tabId = tab.id;
  }

  StateMachine.addParticipant(id, service, tabId, `${info.name}-${count}`);
  notifyStatus(`已添加 ${info.name}-${count}`);
  StateMachine._broadcastStateUpdate();
  // v4.7.2 F22: 异步检测登录态，未登录推 popup 警告气泡（不阻塞 addParticipant 返回）
  checkLoginStatus(tabId, `${info.name}-${count}`, service).catch(() => {});

  // 并列模式下自动排列窗口
  if (windowMode === "tiled") {
    // 等页面稍微加载后再排列
    setTimeout(async () => {
      try { await arrangeWindows(); } catch (_) {}
      // v4.3.0：排列窗口后把 popup 拉回前端，避免用户失焦
      try { await ChatBus.focusPopup(); } catch (_) {}
    }, 500);
  }

  // v4.3.0：立即把 popup 拉回前端（不等 arrange）
  try { await ChatBus.focusPopup(); } catch (_) {}

  // v4.8.29 F37 混合模式: Tab 模式持久 attach chrome.debugger（黄条不影响 tab UI），
  // 并列模式靠 MAIN world bootstrap-main-world.js 自动注入（已在 manifest content_scripts）
  if (windowMode === "tab" && self.CDPExtractor) {
    setTimeout(async () => {
      // v4.8.30 F38-③: timeout 内重检 windowMode — 1.5s 内若切到 tiled，不该再 attach
      if (windowMode !== "tab") {
        console.log(`[F38] addParticipant timeout: mode changed to ${windowMode}, skip attach`);
        return;
      }
      try {
        const r = await self.CDPExtractor.attachAndWake(tabId);
        console.log(`[F37] tab-mode CDP attach service=${service} tab=${tabId} ok=${r?.ok} code=${r?.code}`);
      } catch (e) { console.warn(`[F37] attach fail:`, e?.message); }
    }, 1500);
  }

  return { ok: true, participants: StateMachine.getFullState().participants };
}

async function removeParticipant(id) {
  const p = StateMachine.getParticipant(id);
  if (!p) return { ok: false };
  // v4.8.29 F37: 移除参与者前 detach 该 tab 的 CDP（如已 attach）
  if (p.tabId && self.CDPExtractor) {
    try { await self.CDPExtractor.detach(p.tabId); } catch (_) {}
  }
  if (p.tabId) { _removingTabs.add(p.tabId); try { await chrome.tabs.remove(p.tabId); } catch {} }
  StateMachine.removeParticipant(id);
  notifyStatus(`已移除 ${p.name}`);
  StateMachine._broadcastStateUpdate();
  return { ok: true, participants: StateMachine.getFullState().participants };
}

// ── 广播（状态机驱动） ──

async function handleBroadcast(text, images) {
  StateMachine.debateSession.originalQuestion = text;
  StateMachine.debateSession.rounds = [];
  StateMachine.debateSession.summaryText = "";
  StateMachine.setFlowState(FlowState.BROADCASTING);

  StateMachine.participants.forEach(p => {
    p.response = null;
    p.responsePreview = null;
  });
  StateMachine.save();
  StateMachine._broadcastStateUpdate();

  const results = {};
  await Promise.all(StateMachine.participants.map(async (p) => {
    if (!p.tabId) {
      results[p.id] = { name: p.name, status: "error", error: "未打开" };
      return;
    }
    // 记录"刚发给该 p 的 prompt"——readOneResponse 用此校验防把用户消息当成 AI 回复
    StateMachine.setLastSent(p.id, text);
    const tryInject = async () => {
      const ready = await waitForContentScript(p.tabId);
      if (!ready) return { name: p.name, status: "error", error: "页面未就绪" };
      if (images && images.length > 0) {
        await chrome.tabs.sendMessage(p.tabId, { action: "injectImages", images });
      }
      const result = await chrome.tabs.sendMessage(p.tabId, { action: "inject", text });
      return { name: p.name, ...result };
    };
    try {
      const r = await tryInject();
      if (r.status === "error") {
        await new Promise(ok => setTimeout(ok, 2000));
        results[p.id] = await tryInject();
      } else {
        results[p.id] = r;
      }
    } catch (e) {
      try {
        await new Promise(ok => setTimeout(ok, 2000));
        results[p.id] = await tryInject();
      } catch (e2) {
        results[p.id] = { name: p.name, status: "error", error: e2.message };
      }
    }
  }));

  StateMachine.save();
  StateMachine._broadcastStateUpdate();

  const allOk = Object.values(results).every(r => r.status === "sent" || r.status === "inputted");
  const anyOk = Object.values(results).some(r => r.status === "sent" || r.status === "inputted");
  if (allOk) {
    StateMachine.setFlowState(FlowState.AWAITING_RESPONSES);
    notifyStatus("广播完成，等待回复...");
    // 唤醒所有 AI 标签页，确保后台标签页恢复 DOM 渲染
  } else {
    StateMachine.setFlowState(anyOk ? FlowState.AWAITING_RESPONSES : FlowState.IDLE);
    notifyStatus("部分发送失败，请处理后继续");
  }

  return results;
}

// v4.8.5 F25: 鲁棒化 — 3 次重试 + 超时 + 启动 polling + popup loading 占位
async function retryInjectParticipant(id) {
  const p = StateMachine.getParticipant(id);
  if (!p || !p.tabId) return { ok: false, error: "参与者无效" };
  const text = StateMachine.debateSession.originalQuestion;
  if (!text) return { ok: false, error: "无原始问题可重发（debateSession 为空）" };

  const pendingMsgId = `m${Date.now()}_retry_${p.id}`;
  const displayText = `🔄 重发原题：${text.length > 40 ? text.slice(0, 40) + "…" : text}`;
  // 立刻推 popup loading 占位
  try {
    chrome.runtime.sendMessage({
      type: "chatStreamUpdate", role: "user",
      msgId: pendingMsgId,
      text: `${displayText} · 正在发送…`,
    }).catch(() => {});
    chrome.runtime.sendMessage({
      type: "chatStreamUpdate", role: "ai",
      msgId: pendingMsgId, participantId: p.service,
      text: "", isDone: false,
    }).catch(() => {});
  } catch (_) {}

  const MAX_TRIES = 3;
  let lastError = "未知错误";
  let injectResult = null;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    try {
      const ready = await waitForContentScript(p.tabId);
      if (!ready) {
        lastError = "页面未就绪 (content script 失联)";
        console.warn(`[F35] retryInject ${p.service} attempt ${attempt + 1}/${MAX_TRIES}: ${lastError}`);
      } else {
        StateMachine.setLastSent(p.id, text);
        const result = await sendMessageWithTimeout(p.tabId, { action: "inject", text }, 15000);
        if (result?.status === "sent" || result?.status === "inputted") {
          injectResult = result;
          break;
        }
        lastError = result?.error || `inject 异常状态: ${result?.status}`;
        console.warn(`[F35] retryInject ${p.service} attempt ${attempt + 1}/${MAX_TRIES}: status=${result?.status} err=${result?.error}`);
      }
    } catch (e) {
      lastError = e?.message || lastError;
      console.warn(`[F35] retryInject ${p.service} attempt ${attempt + 1}/${MAX_TRIES} EXCEPTION:`, e?.message);
    }
    if (attempt < MAX_TRIES - 1) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  if (injectResult) {
    notifyStatus(`已重发原题给 ${p.name}`);
    try {
      ChatBus.notifyRoundStart(displayText, [p.service], pendingMsgId);
    } catch (e) { console.warn("[bg] notifyRoundStart fail:", e?.message); }
    return { ok: true, result: injectResult };
  }

  try {
    chrome.runtime.sendMessage({
      type: "chatStreamUpdate", role: "ai",
      msgId: pendingMsgId, participantId: p.service,
      text: `⚠ 重发失败：${lastError}\n\n请确认 ${p.name} 网页可用，必要时刷新页面后再试。`,
      isDone: true,
    }).catch(() => {});
  } catch (_) {}
  notifyStatus(`⚠ 重发给 ${p.name} 失败: ${lastError}`);
  return { ok: false, error: lastError };
}

// ── 手动发送给单个参与者（根据当前阶段自动构建 prompt） ──
async function sendToOneParticipant(participantId) {
  const p = StateMachine.getParticipant(participantId);
  if (!p?.tabId) return { ok: false, error: "参与者无效" };

  try {
    const ready = await waitForContentScript(p.tabId);
    if (!ready) return { ok: false, error: "页面未就绪" };

    let text;
    const rounds = StateMachine.debateSession.rounds;
    if (rounds.length === 0) {
      // 初始广播阶段：发原始问题
      text = StateMachine.debateSession.originalQuestion || "";
    } else {
      // 辩论阶段：构建该参与者的辩论 prompt
      const lastRound = rounds[rounds.length - 1];
      const responses = lastRound.responses || {};
      text = DebateEngine.buildDebatePrompt(
        participantId, responses, lastRound.style || "free",
        lastRound.roundNum, lastRound.guidance || "", false
      );
    }

    if (!text) return { ok: false, error: "无可发送内容" };
    // 记录"刚发给该 p 的 prompt"——sanity check 用
    StateMachine.setLastSent(participantId, text);
    const result = await chrome.tabs.sendMessage(p.tabId, { action: "inject", text });
    return { ok: result.status !== "error", result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── 向指定服务单独发送任意 prompt（PPT 制作 / 气泡 🔄 重发） ──
// v4.8.5 F25: 鲁棒化 — 3 次重试 + 立刻 popup loading 占位 + 成功后启动 polling
//   让 popup 同步新 AI 回答（之前 inject 完不启动 polling，popup 永远看不到结果）
// v4.8.7 F26: text 缺省时从 StateMachine.lastSentByPid 取完整 prompt
//   修复辩论/总结场景重发 bug — popup user 气泡显示的是 "⚔️ 第N轮辩论..." 短文本
//   不是完整 prompt，气泡 🔄 重发取 popup 显示文本会丢完整内容
async function sendPromptToService(service, text) {
  const p = StateMachine.participants.find(x => x.service === service);
  if (!p?.tabId) return { ok: false, error: `未找到已打开的 ${SERVICES[service]?.name || service} 参与者` };

  // v4.8.7 F26: 缺省 text 时 fallback 到 lastSentByPid 取最近发出的完整 prompt
  let prompt = (text || "").trim();
  if (!prompt) {
    prompt = (StateMachine.lastSentByPid?.[p.id] || "").trim();
  }
  if (!prompt) return { ok: false, error: "无可重发的 prompt（未找到上次发送内容）" };

  // v4.8.5 F25: 立刻推 popup loading 占位（pendingMsgId 复用模式，类似 F20/F21）
  const pendingMsgId = `m${Date.now()}_resend_${p.id}`;
  const displayText = `🔄 重发：${prompt.length > 40 ? prompt.slice(0, 40) + "…" : prompt}`;
  try {
    chrome.runtime.sendMessage({
      type: "chatStreamUpdate", role: "user",
      msgId: pendingMsgId,
      text: `${displayText} · 正在发送…`,
    }).catch(() => {});
    chrome.runtime.sendMessage({
      type: "chatStreamUpdate", role: "ai",
      msgId: pendingMsgId, participantId: p.service,
      text: "", isDone: false,
    }).catch(() => {});
  } catch (_) {}

  // v4.8.5 F25: 3 次重试 inject + sendMessageWithTimeout 15s 防挂死
  const MAX_TRIES = 3;
  let lastError = "未知错误";
  let injectResult = null;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    try {
      const ready = await waitForContentScript(p.tabId);
      if (!ready) {
        lastError = "页面未就绪 (content script 失联)";
      } else {
        p.response = null;
        p.responsePreview = null;
        StateMachine.setLastSent(p.id, prompt);
        StateMachine.setFlowState(FlowState.BROADCASTING);
        StateMachine.save();
        StateMachine._broadcastStateUpdate();

        const result = await sendMessageWithTimeout(p.tabId, { action: "inject", text: prompt }, 15000);
        if (result?.status === "sent" || result?.status === "inputted") {
          injectResult = result;
          break;
        }
        lastError = result?.error || `inject 异常状态: ${result?.status}`;
      }
    } catch (e) {
      lastError = e?.message || lastError;
    }
    if (attempt < MAX_TRIES - 1) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  if (injectResult) {
    StateMachine.setFlowState(FlowState.AWAITING_RESPONSES);
    notifyStatus(`已重发给 ${p.name}`);
    // 启动 polling 让 AI 新回答能同步进 popup（复用 pendingMsgId 让占位气泡自动升级）
    try {
      ChatBus.notifyRoundStart(displayText, [p.service], pendingMsgId);
    } catch (e) { console.warn("[bg] notifyRoundStart fail:", e?.message); }
    return { ok: true, participantId: p.id, name: p.name, result: injectResult };
  }

  // 3 次都失败 — 推明确错误气泡（复用 pendingMsgId 升级 loading 为错误信息）
  try {
    chrome.runtime.sendMessage({
      type: "chatStreamUpdate", role: "ai",
      msgId: pendingMsgId, participantId: p.service,
      text: `⚠ 重发失败：${lastError}\n\n请确认 ${p.name} 网页可用，必要时刷新页面后再试。`,
      isDone: true,
    }).catch(() => {});
  } catch (_) {}
  notifyStatus(`⚠ 重发给 ${p.name} 失败: ${lastError}`);
  return { ok: false, error: lastError };
}

// ── 辩论（状态机驱动） ──

async function handleDebateRound(style = "free", guidance = "", concise = false, force = false) {
  if (StateMachine.participants.length < 2) {
    notifyStatus("至少需要 2 个参与者");
    return { ok: false, error: "参与者不足" };
  }

  // v4.8.38: 检测是否有 AI 正在 polling（重发后 / 当前轮还没收完）
  //   handleDebateRound 严格读 p.response，但 polling 未完成时 p.response 仍是上一轮内容。
  //   非强制模式下返回 needsConfirm，由 popup 弹 confirm 询问用户。
  if (!force) {
    let activeServices = [];
    try {
      activeServices = ChatBus.getActivePollingServices?.() || [];
    } catch (_) {}
    if (activeServices.length > 0) {
      // service → 友好名 + participant id 映射
      const pollingNames = activeServices.map(svc => {
        const p = StateMachine.participants.find(pp => pp.service === svc);
        return p?.name || svc;
      });
      return {
        ok: false,
        needsConfirm: true,
        reason: "polling_in_progress",
        pollingServices: activeServices,
        pollingNames,
        message: `⏳ ${pollingNames.length} 个 AI 仍在回答中（${pollingNames.join("、")}），用当前内容辩论将使用上一轮的回答。确认继续？`,
      };
    }
  }

  const responses = {};
  for (const p of StateMachine.participants) {
    if (p.response) {
      responses[p.id] = { name: p.name, text: p.response };
    }
  }

  if (Object.keys(responses).length < 2) {
    notifyStatus("至少需要 2 个有效回答");
    return { ok: false, error: "回答不足" };
  }

  const roundNum = StateMachine.debateSession.rounds.length + 1;
  StateMachine.setFlowState(FlowState.BROADCASTING);
  notifyStatus(`第${roundNum}轮：以「${DEBATE_STYLES[style]?.name || style}」风格交叉发送...`);

  // v4.6.13 F20: 立刻推 pending 占位气泡 — 在 inject 1-3s 等待前先让 popup 显示反馈
  // 避免用户按下辩论按钮后觉得"插件卡住了"。inject 完成后用同 msgId 替换为正式 displayText。
  const styleName = DEBATE_STYLES[style]?.name || style;
  const guidanceSuffix = guidance ? `：${guidance}` : "";
  const displayText = `⚔️ 第${roundNum}轮辩论·${styleName}${guidanceSuffix}`;
  const pendingMsgId = `m${Date.now()}_d${roundNum}`;
  try {
    chrome.runtime.sendMessage({
      type: "chatStreamUpdate", role: "user",
      msgId: pendingMsgId,
      text: `${displayText} · 正在发起...`,
    }).catch(() => {});
    // 给每个候选参与者推 loading 气泡占位
    for (const id of Object.keys(responses)) {
      const p = StateMachine.getParticipant(id);
      if (p?.service) {
        chrome.runtime.sendMessage({
          type: "chatStreamUpdate", role: "ai",
          msgId: pendingMsgId, participantId: p.service,
          text: "", isDone: false,
        }).catch(() => {});
      }
    }
  } catch (_) {}

  // v4.5.5 F4: 进入新一轮前先清所有参与者 response，防止上一轮某个 AI 晚到的回答
  // 污染下一轮 — race 场景：A/B 5-8s 完成 → 用户启动第 1 轮 → C 15s 晚到，C 的旧轮
  // 初始回答会塞进 p.response，下一轮 buildDebatePrompt 拿到混乱上下文
  StateMachine.participants.forEach(p => {
    p.response = null;
    p.responsePreview = null;
  });

  const sendResults = {};
  await Promise.all(Object.keys(responses).map(async (id) => {
    const p = StateMachine.getParticipant(id);
    if (!p?.tabId) return;
    const prompt = DebateEngine.buildDebatePrompt(id, responses, style, roundNum, guidance, concise);
    // 记录"刚发给该 p 的 prompt"——sanity check 用
    StateMachine.setLastSent(id, prompt);
    try {
      sendResults[id] = await chrome.tabs.sendMessage(p.tabId, { action: "inject", text: prompt });
    } catch (e) {
      await new Promise(ok => setTimeout(ok, 2000));
      try {
        sendResults[id] = await chrome.tabs.sendMessage(p.tabId, { action: "inject", text: prompt });
      } catch (e2) {
        sendResults[id] = { site: p.service, status: "error", error: e2.message };
        notifyStatus(`注入 ${p.name} 失败: ${e2.message}`);
      }
    }
  }));

  const sentIds = Object.entries(sendResults)
    .filter(([, r]) => r?.status === "sent" || r?.status === "inputted")
    .map(([id]) => id);

  if (sentIds.length >= 2) {
    StateMachine.debateSession.rounds.push({
      roundNum, style, guidance,
      responses: Object.fromEntries(Object.entries(responses).map(([id, r]) => [id, { name: r.name, text: r.text }]))
    });

    StateMachine.participants.forEach(p => {
      if (sentIds.includes(p.id)) {
        p.response = null;
        p.responsePreview = null;
      }
    });
  }

  StateMachine.save();
  StateMachine.setFlowState(sentIds.length > 0 ? FlowState.AWAITING_RESPONSES : FlowState.IDLE);
  if (sentIds.length < 2) {
    notifyStatus("辩论发送失败：有效接收方不足");
    return { ok: false, error: "有效接收方不足", roundNum, activeIds: sentIds, results: sendResults };
  }
  notifyStatus(`第${roundNum}轮辩论已发送`);

  // 同步 popup 群聊：显示用户气泡 + 启动 polling 给每个参与者
  // v4.6.13 F20: 用 pendingMsgId 复用入口时推的占位气泡 → popup 收到时更新文本而非新增气泡
  try {
    const services = sentIds.map(id => StateMachine.getParticipant(id)?.service).filter(Boolean);
    ChatBus.notifyRoundStart(displayText, services, pendingMsgId);
  } catch (e) { console.warn("[chat-bus] notifyRoundStart failed:", e.message); }

  return { ok: true, roundNum, activeIds: sentIds, results: sendResults };
}

// ── 辩论总结 ──

async function handleSummary(judgeId, customInstruction = "", format = "html") {
  if (StateMachine.participants.length < 2) { notifyStatus("至少需要 2 个参与者"); return { ok: false, error: "参与者不足" }; }
  const judge = StateMachine.getParticipant(judgeId);
  if (!judge?.tabId) { notifyStatus("裁判未打开"); return { ok: false, error: "裁判未打开" }; }

  const responses = {};
  for (const p of StateMachine.participants) {
    if (p.response) {
      responses[p.id] = { name: p.name, text: p.response };
    }
  }
  if (Object.keys(responses).length < 2) { notifyStatus("回答不足"); return { ok: false, error: "回答不足" }; }

  // v4.4.1: format 决定走 JSON→HTML 还是老的 markdown 散文
  const useJsonHtml = format !== "text";
  const prompt = useJsonHtml
    ? DebateEngine.buildSummaryPrompt(
        StateMachine.debateSession.originalQuestion,
        StateMachine.debateSession.rounds,
        responses,
        customInstruction
      )
    : DebateEngine.buildSummaryPromptText(
        StateMachine.debateSession.originalQuestion,
        StateMachine.debateSession.rounds,
        responses,
        customInstruction
      );

  StateMachine.setFlowState(FlowState.SUMMARY);
  // v4.4.0: 仅 html 模式设置 pendingSummary（text 模式走老路径，气泡显示散文即可）
  // v4.5.5 F6: 用 setPendingSummary 触发 save，SW 重启时可恢复
  StateMachine.setPendingSummary(useJsonHtml ? {
    judgeId: judge.id,
    judgeName: judge.name,
    judgeService: judge.service,
    customInstruction,
    topic: StateMachine.debateSession.originalQuestion || "",
    rounds: StateMachine.debateSession.rounds.length || 0,
    participants: StateMachine.participants.map(p => p.name),
    ts: Date.now(),
  } : null);
  notifyStatus(`正在由 ${judge.name} 总结...`);

  // v4.6.14 F21: 立刻推 pending 占位气泡 — 同 F20 模式，inject 1-3s 等待前先反馈
  // 避免用户按下"裁判总结"后觉得卡住。inject 完成后用同 msgId 替换为正式 displayText。
  const displayText = `📋 裁判总结请求 → ${judge.name}${customInstruction ? '：' + customInstruction : ''}`;
  const pendingMsgId = `m${Date.now()}_s${judge.id}`;
  try {
    chrome.runtime.sendMessage({
      type: "chatStreamUpdate", role: "user",
      msgId: pendingMsgId,
      text: `${displayText} · 正在发起...`,
    }).catch(() => {});
    chrome.runtime.sendMessage({
      type: "chatStreamUpdate", role: "ai",
      msgId: pendingMsgId, participantId: judge.service,
      text: "", isDone: false,
    }).catch(() => {});
  } catch (_) {}

  try {
    StateMachine.setLastSent(judge.id, prompt);
    const result = await chrome.tabs.sendMessage(judge.tabId, { action: "inject", text: prompt });
    if (result?.status === "error") {
      const error = result.error || "注入失败";
      notifyStatus(`总结失败: ${error}`);
      StateMachine.setPendingSummary(null);
      return { ok: false, error };
    }
    // v4.8.13 F28: 不再强制把裁判 tab 切到前台
    // 历史代码因为 background tab 提取失败才切，F27 CDP 已解决 throttle 问题
    // 用户反馈："使用总结功能时会突然强迫我跳转到最前方" — 删掉这两行
    notifyStatus(`总结已发送给 ${judge.name}`);
    try {
      // v4.6.14 F21: 复用 pendingMsgId 让 popup 更新原占位气泡（不新增）
      ChatBus.notifyRoundStart(displayText, [judge.service], pendingMsgId);
    } catch (e) { console.warn("[chat-bus] notifyRoundStart failed:", e.message); }
    return { ok: true, result };
  } catch (e) {
    StateMachine.pendingSummary = null;
    notifyStatus(`总结失败: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// v4.4.0: 解析 AI 输出的 JSON → 渲染 arXiv 风格 HTML → 写文件 + 推送 popup
async function finalizeDebateSummary(rawText, pending) {
  try {
    const data = self.DebateSummaryTemplate?.parse(rawText);
    if (!data) {
      // v4.5.4 F9: parse 失败 → 降级为普通气泡显示原文，不让用户面对"按了没反应"
      console.warn("[summary] JSON 解析失败，原文回退展示");
      try {
        chrome.runtime.sendMessage({
          type: "chatStreamUpdate", role: "ai",
          msgId: `summary_fallback_${pending?.ts || Date.now()}`,
          participantId: pending?.judgeService || "summary",
          text: `⚠ 裁判总结 JSON 解析失败，以下为原文：\n\n${rawText || "(空)"}`,
          isDone: true,
        }).catch(() => {});
      } catch (_) {}
      notifyStatus("总结 JSON 解析失败，已显示原文");
      try {
        if (StateMachine.flowState === FlowState.SUMMARY) {
          StateMachine.setFlowState(FlowState.IDLE);
        }
      } catch (_) {}
      return { ok: false, error: "parse_failed" };
    }
    const date = new Date(pending.ts).toISOString().slice(0, 10);
    const duration_min = Math.max(1, Math.round((Date.now() - pending.ts) / 60000));
    const html = self.DebateSummaryTemplate.render(data, {
      topic: pending.topic,
      date,
      participants: pending.participants,
      rounds: pending.rounds,
      duration_min,
    });
    if (!html) return { ok: false, error: "render_failed" };

    // 写文件（chrome.downloads → 下载目录）
    let downloadId = null;
    try {
      const fileName = `debate-summary-${date}-${pending.ts}.html`;
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      // SW 中无法 URL.createObjectURL Blob（MV3 限制），用 data URL
      const reader = new FileReader();
      const dataUrl = await new Promise((res, rej) => {
        reader.onload = () => res(reader.result);
        reader.onerror = rej;
        reader.readAsDataURL(blob);
      });
      downloadId = await chrome.downloads.download({
        url: dataUrl,
        filename: `ai-arena/${fileName}`,
        saveAs: false,
      });
    } catch (e) {
      console.warn("[summary] 写文件失败:", e?.message);
    }

    // 推送 popup 渲染 iframe 预览
    chrome.runtime.sendMessage({
      type: "debateSummaryReady",
      html,
      data,
      meta: { ...pending, date, duration_min },
      downloadId,
    }).catch(() => {});

    notifyStatus(`📋 辩论总结 HTML 已生成${downloadId ? `（已保存到下载目录）` : ""}`);
    return { ok: true, downloadId };
  } catch (e) {
    console.warn("[summary] finalize fail:", e);
    return { ok: false, error: e.message };
  }
}

// ── 无标记完成检测（文本稳定 + stop button 消失） ──

async function checkAllCompletion() {
  const statuses = {};
  await Promise.all(StateMachine.participants.map(async (p) => {
    if (!p.tabId) { statuses[p.id] = { name: p.name, status: "offline", textLength: 0, isStreaming: false }; return; }
    try {
      const r = await chrome.tabs.sendMessage(p.tabId, { action: "checkCompletion" });
      statuses[p.id] = { name: p.name, textLength: r.textLength || 0, isStreaming: !!r.isStreaming };
    } catch { statuses[p.id] = { name: p.name, status: "offline", textLength: 0, isStreaming: false }; }
  }));
  return statuses;
}

// ── 读取单个回答 ──

async function readOneResponse(participantId) {
  const p = StateMachine.getParticipant(participantId);
  if (!p?.tabId) return { ok: false, text: "" };
  try {
      const r = await sendMessageWithTimeout(p.tabId, { action: "readResponse" }, 30000);
      if (r?.error) {
        return { ok: false, text: "", error: r.error };
      }
      const text = r?.text || "";
      if (!text.trim()) {
        return { ok: false, text: "", error: "未读到有效回复" };
      }
      if (isInvalidAiResponse(text)) {
        return { ok: false, text: "", error: "读到平台错误或登录提示，不作为有效回复" };
      }
      if (text) {
      // sanity check：拒绝读到用户刚发的 prompt 或上轮残留
      const sent = StateMachine.lastSentByPid?.[participantId] || "";
      const prevResp = StateMachine.lastAcceptedByPid?.[participantId] || p.response || "";
      const head = (s) => (s || "").trim().slice(0, 100);
      if (sent && text === sent) {
        return { ok: false, text: "", error: "疑似读到用户消息（与 prompt 完全相同），请手动提取" };
      }
      if (sent && head(text).length >= 50 && head(text) === head(sent)) {
        return { ok: false, text: "", error: "疑似读到用户消息（前100字与 prompt 相同），请手动提取" };
      }
      if (prevResp && text === prevResp) {
        return { ok: false, text: "", error: "疑似读到上一轮残留回复，请等待新回复或手动提取" };
      }
      StateMachine.setParticipantResponse(p.id, text);
    }
    return { ok: true, text };
  } catch (e) {
    return { ok: false, text: "", error: e.message };
  }
}

function isInvalidAiResponse(text) {
  return /Something went wrong while generating the response|please contact us through our help center|感谢你试用 ChatGPT|登录或注册，以获取更智能的回复|需要登录|Sign in to continue/i.test(text || "");
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
  const initialResponses = StateMachine.participants.filter(p => p.response);
  if (initialResponses.length > 0) {
    md += `## 各 AI 回答\n\n`;
    for (const p of initialResponses) {
      md += `### ${p.name}\n\n${p.response}\n\n`;
    }
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

// ── 并列模式：排列窗口 ──
async function arrangeWindows(screen = lastKnownScreen) {
  if (windowMode !== "tiled") return { ok: false, error: "非并列模式" };
  const parts = StateMachine.participants.filter(p => p.tabId);
  if (parts.length === 0) return { ok: false, error: "无参与者" };

  const targetLayout = await getAiTargetLayout(screen);
  const targetScreen = targetLayout.screen;
  const screenW = targetScreen.width;
  const screenH = targetScreen.height;
  const screenLeft = targetScreen.left;
  const screenTop = targetScreen.top;

  // 反转顺序：第一个添加的参与者放最右边（带侧边栏）
  const ordered = [...parts].reverse();
  const n = ordered.length;
  // Win10/11 窗口有 ~7px 隐形边框（阴影），补偿后窗口视觉上无缝拼接
  const border = 7;
  const perW = Math.floor(screenW / n);

  for (let i = 0; i < n; i++) {
    const tab = await chrome.tabs.get(ordered[i].tabId).catch(() => null);
    if (!tab) continue;
    const winId = tab.windowId;
    const isLast = i === n - 1;
    const baseLeft = screenLeft + i * perW;
    const baseW = isLast ? screenW - i * perW : perW;
    await chrome.windows.update(winId, {
      left: baseLeft - border,
      top: screenTop,
      width: baseW + border * 2,
      height: screenH,
      state: "normal",
      focused: true
    });
  }

  // 最右侧窗口（第一个添加的参与者）打开侧边栏
  const lastTab = await chrome.tabs.get(ordered[n - 1].tabId).catch(() => null);
  if (lastTab && !targetLayout.isDifferentDisplay) {
    await chrome.sidePanel.open({ windowId: lastTab.windowId }).catch(() => {});
  }

  return { ok: true, screen: targetScreen, displayId: targetLayout.displayId, isDifferentDisplay: targetLayout.isDifferentDisplay };
}

// v4.8.33: 删除 AI_HOSTS — 副屏判定不再依赖 hasUserWindow，AI 域名过滤无用

async function getAiTargetLayout(sidepanelScreen = lastKnownScreen) {
  const fallback = normalizeScreen(sidepanelScreen);
  try {
    if (!chrome.system?.display?.getInfo) {
      console.log("[Arena/layout] chrome.system.display unavailable, using sidepanel screen");
      return { screen: fallback, displayId: null, isDifferentDisplay: false };
    }
    const displays = await chrome.system.display.getInfo();
    const normalized = displays
      .map(d => ({ id: d.id, screen: normalizeScreen(d.workArea || d.bounds), isPrimary: !!d.isPrimary }))
      .filter(d => d.screen.width > 0 && d.screen.height > 0);

    console.log("[Arena/layout] displays:", normalized.map(d => ({ id: d.id.slice(-6), ...d.screen, primary: d.isPrimary })));
    console.log("[Arena/layout] sidepanel reports:", fallback);

    // 找到 sidepanel 所在屏（current display）
    const current = findDisplayForScreen(fallback, normalized) || normalized.find(d => d.isPrimary) || normalized[0];
    // 关键：currentScreen 直接信任 sidepanelScreen（用户屏），不使用 normalized display 的 workArea
    // 因为 chrome.system.display 偶尔返回虚拟坐标，而 sidepanel 的 window.screen 是浏览器内核报告的真实屏
    const currentScreen = fallback;
    console.log("[Arena/layout] current display picked:", current?.id?.slice(-6), "currentScreen:", currentScreen);

    // 自动：副屏优先 + 不存在真副屏则回退同屏
    if (normalized.length < 2) {
      console.log("[Arena/layout] single display detected, using current");
      return { screen: currentScreen, displayId: current?.id || null, isDifferentDisplay: false };
    }

    // v4.8.33: 副屏判定放宽 — 默认 AI 窗口去和群聊窗口"不同屏"
    //   旧规则要求副屏上有【非 AI 平台】的用户 chrome window（防虚拟副屏自污染），
    //   代价：副屏空白时识别失败 → 用户实际是双屏却 AI 仍弹同屏。
    //   新规则：只看 chrome.system.display 报告的物理不重叠副屏，去掉 hasUserWindow 门。
    const others = normalized.filter(d => {
      if (d.id === current.id) return false;
      const notOverlap = !overlapsDisplay(d.screen, currentScreen);
      console.log("[Arena/layout] other display", d.id.slice(-6), "notOverlap:", notOverlap);
      return notOverlap;
    });

    if (others.length === 0) {
      console.log("[Arena/layout] no real secondary, using current screen");
      return { screen: currentScreen, displayId: current?.id || null, isDifferentDisplay: false };
    }
    const currentCenter = centerOf(currentScreen);
    const target = others.sort((a, b) => distance(centerOf(a.screen), currentCenter) - distance(centerOf(b.screen), currentCenter))[0];
    console.log("[Arena/layout] using secondary display", target.id.slice(-6), target.screen);
    return { screen: target.screen, displayId: target.id, isDifferentDisplay: true };
  } catch (e) {
    console.warn("[Arena/layout] error, falling back to sidepanel screen:", e?.message || e);
    return { screen: fallback, displayId: null, isDifferentDisplay: false };
  }
}

// 判断两个 screen rect 是否物理重叠（用于过滤虚假副屏）
// 真副屏 = 完全不重叠（物理上水平/垂直分离）。任何重叠（哪怕 1 像素）都视为虚假副屏。
function overlapsDisplay(a, b) {
  const ax2 = a.left + a.width, ay2 = a.top + a.height;
  const bx2 = b.left + b.width, by2 = b.top + b.height;
  const overlapW = Math.max(0, Math.min(ax2, bx2) - Math.max(a.left, b.left));
  const overlapH = Math.max(0, Math.min(ay2, by2) - Math.max(a.top, b.top));
  return overlapW > 0 && overlapH > 0;
}

function normalizeScreen(screen = {}) {
  const width = Math.max(300, Math.round(screen.width || screen.availWidth || 1920));
  const height = Math.max(300, Math.round(screen.height || screen.availHeight || 1080));
  return {
    left: Math.round(screen.left ?? screen.availLeft ?? 0),
    top: Math.round(screen.top ?? screen.availTop ?? 0),
    width,
    height
  };
}

function windowBoundsForCreate(screen) {
  const s = normalizeScreen(screen);
  return {
    left: s.left,
    top: s.top,
    width: Math.max(500, Math.min(s.width, 1200)),
    height: Math.max(500, s.height)
  };
}

function findDisplayForScreen(screen, displays) {
  const point = centerOf(screen);
  const contains = displays.find(d => (
    point.x >= d.screen.left &&
    point.x < d.screen.left + d.screen.width &&
    point.y >= d.screen.top &&
    point.y < d.screen.top + d.screen.height
  ));
  if (contains) return contains;

  return displays
    .map(d => ({ display: d, overlap: overlapArea(screen, d.screen) }))
    .sort((a, b) => b.overlap - a.overlap)[0]?.display || null;
}

function centerOf(screen) {
  return { x: screen.left + screen.width / 2, y: screen.top + screen.height / 2 };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function overlapArea(a, b) {
  const left = Math.max(a.left, b.left);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const top = Math.max(a.top, b.top);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

// ── 工具函数 ──

async function waitForContentScript(tabId, maxRetries = 12) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await chrome.tabs.sendMessage(tabId, { action: "ping" });
      // v4.8.19 F32: 不再调 injectVisibilityOverride（已删，manifest content_scripts 提前注入）
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
