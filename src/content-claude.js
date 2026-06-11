// AI Arena — Content Script for claude.ai
// v4.8.47: IIFE + globalThis guard 防御重复注入（reload 扩展 / ensureContentScriptInjected 多次触发时不撞 const SITE 重复声明）
(function() {
if (globalThis.__AI_ARENA_CS_LOADED_claude__) {
  console.log("[content-claude] already loaded, skip duplicate injection");
  return;
}
globalThis.__AI_ARENA_CS_LOADED_claude__ = true;

const SITE = "claude";

// 选择器配置（启动时从 background 获取）
let selectors = null;
chrome.runtime.sendMessage({ type: "getSelectors", platform: SITE }, (resp) => {
  if (resp) selectors = resp;
});

// v2.1.0: marker 已移除

const _reportedFailures = new Set();
// 按优先级尝试选择器数组，返回第一个匹配的元素
function queryBySelectors(action, options = {}) {
  const sels = selectors?.[action] || [];
  for (const sel of sels) {
    const el = options.all ? document.querySelectorAll(sel) : document.querySelector(sel);
    if (options.all ? el.length > 0 : el) return el;
  }
  const heuristic = getHeuristicElement(action, options);
  if (heuristic) return heuristic;
  if (!_reportedFailures.has(action)) { _reportedFailures.add(action); chrome.runtime.sendMessage({ type: "selectorFailure", platform: SITE, action }).catch(() => {}); }
  return options.all ? [] : null;
}

function getHeuristicElement(action, options = {}) {
  if (action === "input") {
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
    // v4.5.4 F1: 无用户消息 DOM → 不在对话页，放弃 heuristic 防误抓装饰元素
    if (typeof hasUserMessageInDom === "function" && !hasUserMessageInDom()) return options.all ? [] : null;
    const blocks = document.querySelectorAll('div, article, section');
    const block = globalThis.ArenaShared?.findReadableBlock?.(blocks, { minTextLength: 100, minHeight: 50, limit: 80 });
    return options.all ? (block ? [block] : []) : block;
  }
  if (action === "sendButton") {
    const btns = [...document.querySelectorAll("button")];
    return btns.filter(b => b.getBoundingClientRect().bottom > window.innerHeight - 150 && b.querySelector("svg")).pop() || null;
  }
  return options.all ? [] : null;
}

// v5.2.20: streaming 判定改用 ArenaShared.detectStreaming（限定最新回答容器 + 视口可见，
//   不再全文档 querySelector + 裸 width>0），修第二/三轮起 isStreaming 误卡 true 导致提取拖延/超时。
function _detectStreaming() {
  const rs = queryBySelectors("response", { all: true });
  const latest = rs && rs.length ? latestResponseElement(rs) : null;
  return globalThis.ArenaShared?.detectStreaming?.(selectors?.streaming || [], latest, window, document) || false;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    if (msg.action === "ping") {
      sendResponse({ ready: true });
      return false;
    }
    if (msg.action === "inject") {
      // v5.0.16: 发送失败时清 cursor 锚点 → 提取回退尾部候选，防错误基准截掉真实新回答
      const respondInject = (result) => {
        if (!result || result.status !== "sent") { try { globalThis.ArenaShared?.clearResponseCursorAnchor?.(SITE); } catch (_) {} }
        sendResponse(result);
      };
      injectAndSend(msg.text).then(respondInject).catch(e => respondInject({ site: SITE, status: "error", error: e.message }));
      return true;
    }
    if (msg.action === "readResponse") {
      readLatestResponse().then(async text => {
        if (typeof postProcessBlobUrls === "function") { text = await postProcessBlobUrls(text); }
        // v5.0.20: imagesPending 一并透传 — 旧版被解构丢弃，pollOnce 的"图片加载中不算空超时"保护失效
        const { hasRichContent, richTypes, imagesPending } = detectRichContent();
        // v4.6.8 F18: readResponse 返回 isStreaming 让 chat-bus pollOnce 判完成时纳入条件
        // 防 ChatGPT/Claude 等复杂问题中"模型停顿规划下一段"时被 4.5s sameCount 误判完成
        const isStreaming = _detectStreaming();
        // v5.0.20: 同文本省略 — 与 SW 上次收到的一致时只回 sameText 不整段回传
        const t = (text || "").trim();
        const h = globalThis.ArenaShared?.textHash?.(t) || null;
        if (msg.knownHash && h && h === msg.knownHash) {
          sendResponse({ site: SITE, sameText: true, hasRichContent, richTypes, imagesPending, isStreaming });
          return;
        }
        sendResponse({ site: SITE, text: t, textHash: h, hasRichContent, richTypes, imagesPending, isStreaming });
      }).catch(e => sendResponse({ site: SITE, text: "", error: e.message }));
      return true;
    }
    if (msg.action === "injectImages") {
      handleInjectImages(msg.images).then(sendResponse).catch(e => sendResponse({ status: "error", error: e.message }));
      return true;
    }
    // v5.0.3: chat-bus 检测到 prompt-echo（polling 提取到的"回答"就是用户问题本身 → Claude 网页没真发送）
    //   时，调此 action 在 Claude 网页补一次发送。不重新 inject 文本（textbox 里已有 prompt），
    //   只找 send button click，找不到/disabled 时 fallback Enter。
    if (msg.action === "resubmit") {
      (async () => {
        for (let i = 0; i < 15; i++) {
          const btn = findSendButton();
          if (btn && !btn.disabled && btn.getAttribute("aria-disabled") !== "true") {
            btn.click();
            sendResponse({ ok: true, via: "button" });
            return;
          }
          await sleep(200);
        }
        const el = queryBySelectors("input");
        if (el) {
          el.focus();
          el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
          el.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
          el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
          sendResponse({ ok: true, via: "enter" });
          return;
        }
        sendResponse({ ok: false, error: "no send button / no input" });
      })();
      return true;
    }
    if (msg.action === "checkCompletion") {
      const text = getLastResponseText();
      const isStreaming = _detectStreaming();
      sendResponse({
        site: SITE,
        textLength: text.length,
        isStreaming
      });
      return false;
    }
    if (msg.action === "readFullConversation") {
      sendResponse({ site: SITE, turns: readFullConversation() });
      return false;
    }
  } catch (e) {
    sendResponse({ site: SITE, status: "error", error: e.message });
    return false;
  }
});

function _extractEl(el) {
  if (!el) return "";
  // v5.2.12: 优先 extractTextSafe（fenced 损坏自动回退 textContent，鲁棒 ≥ v1.0）
  if (typeof extractTextSafe === "function") return extractTextSafe(el);
  if (typeof extractTextWithFences === "function") return extractTextWithFences(el);
  return el.textContent || el.innerText || "";
}
function latestResponseElement(elements) {
  const picked = globalThis.ArenaShared?.getLatestResponseCandidate?.(elements, SITE);
  if (picked) return picked;
  if (globalThis.ArenaShared?.hasResponseCursor?.(SITE)) return null;
  if (!elements || !elements.length) return null;
  return globalThis.ArenaShared?.getLastNonEmpty?.(elements) || elements[elements.length - 1];
}

function rememberCurrentResponseCursor() {
  // v5.0.16: 只用站点自身 response 选择器建锚点，且与提取同源（indexOf 可直接命中）。
  //   旧版追加的广谱通配（[class*='assistant'] / [class*='response'] 等）会把侧边栏、
  //   设置按钮等无关元素收进候选，锚点可能落在对话区之后，把真实新回答整体过滤掉。
  try {
    globalThis.ArenaShared?.rememberResponseCursor?.(SITE, queryBySelectors("response", { all: true }));
  } catch (_) {}
}

function getLastResponseText() {
  const responses = queryBySelectors("response", { all: true });
  // v5.2.6: 取最后一个有内容的（兜底末位空容器：streaming / spacer / 装饰）
  if (responses.length > 0) {
    const _last = latestResponseElement(responses);
    return _extractEl(_last);
  }
  return "";
}

// 健壮注入：优先模拟粘贴 → execCommand → innerHTML 兜底
async function robustInject(el, text) {
  el.focus();
  // 清空现有内容
  el.innerHTML = "";
  el.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(100);

  // 方法1: 模拟粘贴（最能触发框架状态更新）
  try {
    // v4.8.53: 长文本（>1500 字）跳过 paste — ChatGPT / Kimi 的 paste 处理器会把长文本
    //   自动转成 .txt 附件（截图证据：用户反馈"用户补充要求: 对于极化可重构: ..." 文件 card），
    //   导致 prompt 没作为文字发出去。throw 跳到 catch{} 走 execCommand insertText 路径。
    if (text.length > 1500) throw new Error("skip_paste_long_text");
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    const pasteEvent = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(pasteEvent);
    await sleep(150);
    // v4.8.60: paste 合成事件不自动触发 input event，手动补让 React/ProseMirror 框架感知
    try { el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: text })); } catch (_) {}
    await sleep(50);
    if (el.innerText.trim().length > 0) return;
  } catch {}

  // 方法2: execCommand（广泛兼容）
  try {
    el.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, text);
    await sleep(150);
    // v4.8.60: execCommand insertText 在某些浏览器版本下不自动触发 input event，补一次
    try { el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text })); } catch (_) {}
    await sleep(50);
    if (el.innerText.trim().length > 0) return;
  } catch {}

  // 方法3: 安全兜底
  // v5.2.17: 安全注入（多方审查 Codex 高危）— 杜绝 innerHTML 拼接用户 prompt（防 < > & 被解析篡改/XSS）
  if (globalThis.ArenaShared?.setEditableLines) {
    globalThis.ArenaShared.setEditableLines(el, text);
  } else {
    el.innerHTML = "";
    text.split("\n").forEach(line => { const p = document.createElement("p"); if (line) p.textContent = line; else p.appendChild(document.createElement("br")); el.appendChild(p); });
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

async function injectAndSend(text) {
  try {
    rememberCurrentResponseCursor();
    const el = queryBySelectors("input");
    if (!el) return { site: SITE, status: "error", error: "未找到输入框", code: "INJECT_NO_INPUT", snapshot: { service: SITE, stage: "injecting", hitSelectors: { input: null }, domTextLen: 0, bootstrapReady: !!globalThis.__arenaBootstrap, pageUrl: location.href } };

    await robustInject(el, text);

    for (let i = 0; i < 15; i++) {
      await sleep(200);
      const current = (el.tagName === "TEXTAREA" ? el.value : el.innerText).trim();
      if (current.length >= text.length * 0.3) break;
    }

    // v5.2.24: Claude ProseMirror 首次提问 bug — welcome 屏过渡期 ProseMirror state 同步慢，
    //   dispatch Enter (untrusted) 被 ProseMirror onKeyDown 识别为换行而非 submit。修：Enter 之前
    //   先尝试 send button click 绕开 Enter 不稳定。
    // v5.0.3: 升级为短轮询等 button enable — v5.2.24 只检查 1 次，robustInject 刚结束的第 1 帧 React
    //   state 还在异步同步 execCommand insertText 的效果，button 几百 ms 才 enable → 跳过 → 走 Enter
    //   兜底 → 复现 bug。改 10 × 200ms = 2s 轮询覆盖 React 同步窗口，仍 disabled 则落 Enter 兜底。
    for (let i = 0; i < 10; i++) {
      const btn = findSendButton();
      if (btn && !btn.disabled && btn.getAttribute("aria-disabled") !== "true") {
        btn.click();
        await sleep(400);
        const remaining = (el.tagName === "TEXTAREA" ? el.value : el.innerText).trim();
        if (remaining.length < text.length * 0.3) return { site: SITE, status: "sent" };
        break; // click 触发但 textbox 没清空 → 落 Enter 兜底
      }
      await sleep(200);
    }

    el.focus();
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    await sleep(50);
    el.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    await sleep(50);
    el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));

    await sleep(500);
    const remaining = (el.tagName === "TEXTAREA" ? el.value : el.innerText).trim();
    if (remaining.length < text.length * 0.3) return { site: SITE, status: "sent" };

    // v4.8.60: fallback retry 加强 — 3 次 300ms → 8 次 400ms = 3.2s；加 input event 触发 React state 刷新；
    //   aria-disabled 检测兼容 DeepSeek/Kimi 等用 aria 而不是 .disabled 的框架
    for (let attempt = 0; attempt < 8; attempt++) {
      await sleep(400);
      try { el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "" })); } catch (_) {}
      const btn = findSendButton();
      const disabled = btn && (btn.disabled || btn.getAttribute("aria-disabled") === "true");
      if (btn && !disabled) { btn.click(); return { site: SITE, status: "sent" }; }
    }

    // v4.8.60: fail-soft 替代 v4.8.50 fail-loud — Enter 可能已触发发送（input 残留只是 React 异步清空慢），
    //   返回 sent 让 chat-bus 启 polling 兜底；polling EMPTY_TIMEOUT_TICKS (45s) 未读到才真正报错
    //   背景：fail-loud 对 DeepSeek/Kimi React 同步慢的场景误报，user 看到"注入失败"但消息已发 → 错失提取
    return { site: SITE, status: "sent", inject_warning: "button stayed disabled after 8 retries — polling will verify" };
  } catch (e) {
    return { site: SITE, status: "error", error: e.message };
  }
}

async function readLatestResponse() {
  // v6: streaming 检测已由 sidepanel 轮询负责，此处仅短暂等待 DOM 稳定
  await sleep(500);

  // 多策略读取最后一条 AI 回答
  const text = getLastAssistantText();
  return text;
}

// v4.8.27 F35: 清理 Claude 回答的 sr-only / thinking 噪音
// 截图证据："Claude responded: 1+1=2Thinking about...1+1=2" 三段被拼一起
// 1. "Claude responded:" 是 sr-only 截图 aria-label，应剥离
// 2. thinking summary 是 Claude 思考过程，用户不需要看（默认折叠在 UI 上）
// 3. 真正回答可能在 .prose 或某个 final 容器
function cleanClaudeText(raw) {
  if (!raw) return "";
  let t = raw;
  // 剥离开头的 sr-only "Claude responded:" / "Reply:" / 类似前缀
  t = t.replace(/^(Claude\s+(responded|replied|said|response):?\s*|Reply\s*:?\s*)/i, "");
  return t.trim();
}

// 在 .font-claude-message 容器内提取真正回答，跳过 thinking 折叠块
function _extractClaudeResponse(container) {
  if (!container) return "";
  // Claude UI 把 thinking 放在 <details> 或 [data-state="open"] 折叠区
  // 复制一份 DOM，剥离 thinking 节点后再 innerText
  const clone = container.cloneNode(true);
  // 移除 thinking summary（多种可能选择器）
  clone.querySelectorAll([
    "details",
    "[aria-label*='Thinking' i]",
    "[aria-label*='思考' i]",
    "[data-testid*='thinking' i]",
    "button[aria-expanded]",  // 折叠展开按钮
    ".sr-only",  // 屏幕阅读器专用文本（含 "Claude responded:" 等）
    "[aria-hidden='false'].sr-only",
  ].join(", ")).forEach(el => el.remove());

  // 也移除带 "Thinking about" 文本开头的标题/按钮
  clone.querySelectorAll("h1, h2, h3, h4, button, summary").forEach(el => {
    const t = (el.innerText || "").trim();
    if (/^(Thinking|思考|Pondering|Considering)\b/i.test(t)) el.remove();
  });

  // v5.2.12: 同 _extractEl 思路（双路 + 损坏回退）
  let text = "";
  if (typeof extractTextSafe === "function") text = extractTextSafe(clone);
  else if (typeof extractTextWithFences === "function") text = extractTextWithFences(clone);
  else text = clone.textContent || clone.innerText || "";
  return cleanClaudeText(text);
}

function getLastAssistantText() {
  // 优先策略：用容器 + cleanup（剥 thinking 和 sr-only）
  // v5.2.6: 取最后一个有内容的（fallback selector 也兜底）
  const claudeMsgs = document.querySelectorAll(".font-claude-message");
  if (claudeMsgs.length > 0) {
    const _last = latestResponseElement(claudeMsgs);
    const r = _extractClaudeResponse(_last);
    if (r) return r;
  }

  // v5.2.6: 取最后一个有内容的（fallback selector 也兜底）
  const testIdMsgs = document.querySelectorAll("[data-testid='chat-message-content']");
  if (testIdMsgs.length > 0) {
    const _last = latestResponseElement(testIdMsgs);
    const r = _extractClaudeResponse(_last);
    if (r) return r;
  }

  // 选择器配置兜底
  const responses = queryBySelectors("response", { all: true });
  // v5.2.6: 取最后一个有内容的（兜底末位空容器：Claude thinking 容器空场景）
  if (responses.length > 0) {
    const _last = latestResponseElement(responses);
    return cleanClaudeText(_extractEl(_last));
  }

  // v5.2.6: 取最后一个有内容的（fallback selector 也兜底）
  const streamContainers = document.querySelectorAll("[data-is-streaming]");
  if (streamContainers.length > 0) {
    const last = latestResponseElement(streamContainers);
    const r = _extractClaudeResponse(last);
    if (r) return r;
  }

  const proseBlocks = document.querySelectorAll(".prose, .markdown");
  // v5.2.6: 取最后一个有内容的（fallback prose 也兜底）
  if (proseBlocks.length > 0) {
    const _last = latestResponseElement(proseBlocks);
    return cleanClaudeText(_extractEl(_last));
  }

  const allBlocks = document.querySelectorAll('[class*="message"], [class*="response"], [class*="assistant"]');
  const fallback = globalThis.ArenaShared?.findReadableBlock?.(allBlocks, { minTextLength: 50, minHeight: 0, limit: 80 });
  if (fallback) return cleanClaudeText(_extractEl(fallback));

  return "";
}

function readFullConversation() {
  try {
    const turns = [];

    // 策略 1: data-testid（旧版）
    const userMsgs = document.querySelectorAll('[data-testid="human-turn"]');
    const aiMsgs = document.querySelectorAll('[data-testid="chat-message-content"]');
    if (userMsgs.length > 0 || aiMsgs.length > 0) {
      const len = Math.max(userMsgs.length, aiMsgs.length);
      for (let i = 0; i < len; i++) {
        if (userMsgs[i]) turns.push({ role: "user", text: userMsgs[i].innerText.trim() });
        if (aiMsgs[i]) turns.push({ role: "assistant", text: aiMsgs[i].innerText.trim() });
      }
      return turns;
    }

    // 策略 2: 通用 — 遍历对话流中的所有轮次
    // Claude 页面通常是 user/assistant 交替的 div 块
    const allTurns = document.querySelectorAll('[data-testid="human-turn"], .font-claude-message, [data-is-streaming]');
    if (allTurns.length > 0) {
      allTurns.forEach(el => {
        const isUser = el.matches('[data-testid="human-turn"]') || el.closest('[data-testid="human-turn"]');
        turns.push({
          role: isUser ? "user" : "assistant",
          text: el.innerText.trim()
        });
      });
      return turns;
    }

    // 策略 3: 最后兜底 — 获取整个对话区域的文本
    const chatArea = document.querySelector('[class*="conversation"], [class*="chat"], main');
    if (chatArea) {
      turns.push({ role: "assistant", text: chatArea.innerText.trim().slice(-2000) });
    }

    return turns;
  } catch { return []; }
}

function findSendButton() {
  return queryBySelectors("sendButton");
}

function detectRichContent() {
  const types = [];
  // Claude Artifact
  if (document.querySelector('[class*="artifact"], iframe[src*="artifact"]')) types.push("artifact");
  // 多图
  const imgs = document.querySelectorAll("main img, [role='main'] img");
  if (imgs.length > 1) types.push("image");
  // Mermaid（Claude 偶尔嵌 mermaid）
  if (document.querySelector('code.language-mermaid, [class*="mermaid"]')) types.push("mermaid");
  const imagesPending = (typeof countPendingImages === "function") ? countPendingImages() : 0;
  return { hasRichContent: types.length > 0, richTypes: types, imagesPending };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

})();  // v4.8.47 IIFE 防御重复注入 END
