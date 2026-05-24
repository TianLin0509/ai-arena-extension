// AI Arena — CDP 唤醒后台 tab 模块（v4.8.29 F37 mixed mode）
//
// 混合模式架构：
// - Tab 模式（AI 在同一 window 不同 tab，被遮挡）→ 持久 chrome.debugger.attach
//   黄条全程显示但 tab 模式 UI 不受影响（顶部有空间）
// - 并列模式（每个 AI 独立 window，能看到）→ 不 attach，靠 MAIN world visibility patch
//   黄条不出现，mini bar 等场景不被遮挡
//
// CDP 命令：Page.setWebLifecycleState(active) + Emulation.setFocusEmulationEnabled
//        + Emulation.setIdleOverride 三连绕过 Chrome background throttle
//
// 安全保证：
// - 只读操作 + 生命周期/焦点 emulation
// - 绝不调 Network.* — 不动 cookie / 登录态 / 存储

(function () {
  const attachedTabs = new Map();
  const PROTOCOL_VERSION = "1.3";

  async function isTabInBackground(tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab.active) return true;
      const win = await chrome.windows.get(tab.windowId).catch(() => null);
      if (!win) return false;
      return !win.focused;
    } catch (_) {
      return false;
    }
  }

  async function attachAndWake(tabId) {
    if (!tabId) return { ok: false, error: "no tabId" };
    if (attachedTabs.has(tabId)) {
      return { ok: true, reused: true };
    }
    try {
      await chrome.debugger.attach({ tabId }, PROTOCOL_VERSION);
    } catch (e) {
      const msg = e?.message || String(e);
      return { ok: false, error: msg, code: classifyAttachError(msg) };
    }
    try {
      await chrome.debugger.sendCommand({ tabId }, "Page.enable", {});
      await chrome.debugger.sendCommand({ tabId }, "Page.setWebLifecycleState", { state: "active" });
      // v4.8.12: 关键 — Page.setWebLifecycleState 只改 lifecycle（freeze/discard），不改
      // renderer visibility / rAF throttle。SPA（React/Angular）调度依赖 rAF，仍然被
      // background throttle 降级到 1 Hz。必须发 Emulation.setFocusEmulationEnabled
      // 让 page 以为有 focus → scheduler 全速 → 流式渲染恢复。Puppeteer 内部 capture
      // screenshot 时用的就是这条命令。
      try {
        await chrome.debugger.sendCommand({ tabId }, "Emulation.setFocusEmulationEnabled", { enabled: true });
      } catch (e) {
        console.warn("[CDPExtractor] setFocusEmulationEnabled 不支持:", e?.message);
      }
      // 兜底：模拟"用户活跃"信号 — 解除某些 idle-based throttle
      try {
        await chrome.debugger.sendCommand({ tabId }, "Emulation.setIdleOverride", { isUserActive: true, isScreenUnlocked: true });
      } catch (_) {}
      attachedTabs.set(tabId, { attachedAt: Date.now() });
      return { ok: true, reused: false };
    } catch (e) {
      try { await chrome.debugger.detach({ tabId }); } catch (_) {}
      return { ok: false, error: e?.message || String(e) };
    }
  }

  function classifyAttachError(msg) {
    if (!msg) return "unknown";
    if (/Another debugger is already attached/i.test(msg)) return "devtools_open";
    if (/Cannot access a chrome.* URL/i.test(msg)) return "chrome_url";
    if (/No tab with given id/i.test(msg)) return "no_tab";
    if (/permission/i.test(msg)) return "no_permission";
    return "other";
  }

  async function detach(tabId) {
    if (!tabId || !attachedTabs.has(tabId)) return;
    attachedTabs.delete(tabId);
    // v4.8.10 F27-bugfix2: 不再手动 setWebLifecycleState("frozen")
    // frozen 会暂停 tab 渲染 + JS → AI 网页变黑屏/空白（截图证据：用户反馈）
    // detach 后 Chrome 自动按 tab 真实可见性恢复 lifecycle，无需手动干预
    try {
      await chrome.debugger.detach({ tabId });
    } catch (_) {}
  }

  async function detachAll() {
    const ids = Array.from(attachedTabs.keys());
    for (const tabId of ids) {
      await detach(tabId);
    }
  }

  function isAttached(tabId) {
    return attachedTabs.has(tabId);
  }

  function getStats() {
    return {
      attachedCount: attachedTabs.size,
      tabs: Array.from(attachedTabs.entries()).map(([tabId, info]) => ({
        tabId, attachedAt: info.attachedAt, elapsed: Date.now() - info.attachedAt,
      })),
    };
  }

  if (chrome.debugger?.onDetach) {
    chrome.debugger.onDetach.addListener((source, reason) => {
      if (source.tabId && attachedTabs.has(source.tabId)) {
        attachedTabs.delete(source.tabId);
        console.log(`[CDPExtractor] external detach tab=${source.tabId} reason=${reason}`);
      }
    });
  }

  self.CDPExtractor = {
    isTabInBackground, attachAndWake, detach, detachAll,
    isAttached, getStats,
  };
})();
