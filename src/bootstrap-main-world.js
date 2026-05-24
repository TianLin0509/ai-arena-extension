// AI Arena — MAIN world anti-throttle patch (v4.8.20 F32+)
// 在 document_start 注入到 AI 网页的 MAIN world，让网页完全不受 background throttle 影响
//
// 加强版（v4.8.20）：用 Web Worker 接管 setTimeout/setInterval
// Web Worker 跑在独立线程，Chrome **不对 worker 内的 setTimeout 节流**
// → SPA 内部的 chunk-loop setTimeout(pump, 16) 完全不受影响
// → 流式回答速度和前台一致
//
// 完整 patch 清单：
// 1. document.visibilityState / hidden 锁死 (JS 层 + prototype)
// 2. visibility/blur/pagehide 事件拦截
// 3. document.hasFocus() = true
// 4. requestAnimationFrame fallback (MessageChannel)
// 5. setTimeout/setInterval 转发到 Web Worker
(() => {
  if (window.__arenaMainWorldPatched) return;
  window.__arenaMainWorldPatched = true;

  // ──────── 1. visibilityState / hidden 锁死 ────────
  const visibleDesc = { get: () => "visible", configurable: true };
  const hiddenDesc = { get: () => false, configurable: true };
  try {
    Object.defineProperty(Document.prototype, "visibilityState", visibleDesc);
    Object.defineProperty(Document.prototype, "hidden", hiddenDesc);
  } catch (_) {}
  try {
    Object.defineProperty(document, "visibilityState", visibleDesc);
    Object.defineProperty(document, "hidden", hiddenDesc);
  } catch (_) {}
  try {
    Object.defineProperty(document, "webkitVisibilityState", visibleDesc);
    Object.defineProperty(document, "webkitHidden", hiddenDesc);
  } catch (_) {}

  // ──────── 2. visibility/focus 事件拦截 ────────
  ["visibilitychange", "webkitvisibilitychange", "blur", "pagehide", "freeze"].forEach(t => {
    document.addEventListener(t, e => e.stopImmediatePropagation(), true);
    window.addEventListener(t, e => e.stopImmediatePropagation(), true);
  });

  // ──────── 3. document.hasFocus 锁死 ────────
  try { document.hasFocus = () => true; } catch (_) {}

  // ──────── 4. requestAnimationFrame MessageChannel fallback ────────
  try {
    const origRAF = window.requestAnimationFrame.bind(window);
    const origCAF = window.cancelAnimationFrame.bind(window);
    const ch = new MessageChannel();
    const queue = new Map();
    let nextId = 1 << 30;
    ch.port1.onmessage = () => {
      const t = performance.now();
      const callbacks = [...queue.entries()];
      queue.clear();
      for (const [, cb] of callbacks) { try { cb(t); } catch (_) {} }
    };
    window.requestAnimationFrame = function (cb) {
      try { const id = origRAF(cb); if (id) return id; } catch (_) {}
      const id = nextId++;
      queue.set(id, cb);
      ch.port2.postMessage(0);
      return id;
    };
    window.cancelAnimationFrame = function (id) {
      if (queue.has(id)) { queue.delete(id); return; }
      try { origCAF(id); } catch (_) {}
    };
  } catch (_) {}

  // ──────── 5. setTimeout/setInterval 走 Web Worker（重磅 anti-throttle） ────────
  // Chrome 对 background tab 节流 setTimeout/setInterval 到 1Hz，影响 SPA 内部
  // chunk-loop（如 setTimeout(pump, 16) 串联 ReadableStream chunk 处理）
  // Web Worker 跑独立线程，setTimeout 不被节流 → 直接 bypass
  try {
    const workerCode = `
      const timers = new Map();
      self.onmessage = (e) => {
        const { type, id, delay } = e.data;
        if (type === 'set') {
          const tid = setTimeout(() => {
            timers.delete(id);
            self.postMessage(id);
          }, delay);
          timers.set(id, tid);
        } else if (type === 'clear') {
          const tid = timers.get(id);
          if (tid != null) { clearTimeout(tid); timers.delete(id); }
        }
      };
    `;
    const blob = new Blob([workerCode], { type: "application/javascript" });
    const workerUrl = URL.createObjectURL(blob);
    const worker = new Worker(workerUrl);

    const stCallbacks = new Map();  // setTimeout
    const intervalCfg = new Map();  // setInterval { cb, delay, active }
    let wid = 2 << 30;

    worker.onmessage = (e) => {
      const id = e.data;
      // setInterval: 用 active 标记防 clearInterval 后 cb 仍触发
      if (intervalCfg.has(id)) {
        const cfg = intervalCfg.get(id);
        if (cfg.active) {
          try { cfg.cb(); } catch (_) {}
          if (intervalCfg.has(id) && intervalCfg.get(id).active) {
            worker.postMessage({ type: "set", id, delay: cfg.delay });
          }
        }
        return;
      }
      // setTimeout: 一次性
      const cb = stCallbacks.get(id);
      if (cb) {
        stCallbacks.delete(id);
        try { cb(); } catch (_) {}
      }
    };

    const origSetTimeout = window.setTimeout.bind(window);
    const origClearTimeout = window.clearTimeout.bind(window);
    window.setTimeout = function (cb, delay, ...args) {
      if (typeof cb !== "function") return origSetTimeout(cb, delay, ...args);
      const id = wid++;
      stCallbacks.set(id, args.length ? () => cb(...args) : cb);
      worker.postMessage({ type: "set", id, delay: Math.max(0, delay || 0) });
      return id;
    };
    window.clearTimeout = function (id) {
      if (stCallbacks.has(id)) {
        stCallbacks.delete(id);
        worker.postMessage({ type: "clear", id });
        return;
      }
      origClearTimeout(id);
    };

    const origSetInterval = window.setInterval.bind(window);
    const origClearInterval = window.clearInterval.bind(window);
    window.setInterval = function (cb, delay, ...args) {
      if (typeof cb !== "function") return origSetInterval(cb, delay, ...args);
      const id = wid++;
      const tickFn = args.length ? () => cb(...args) : cb;
      intervalCfg.set(id, { cb: tickFn, delay: Math.max(0, delay || 0), active: true });
      worker.postMessage({ type: "set", id, delay: Math.max(0, delay || 0) });
      return id;
    };
    window.clearInterval = function (id) {
      if (intervalCfg.has(id)) {
        intervalCfg.get(id).active = false;
        intervalCfg.delete(id);
        worker.postMessage({ type: "clear", id });
        return;
      }
      origClearInterval(id);
    };
  } catch (e) {
    console.warn("[AI Arena] Worker timer patch failed:", e);
  }

  console.log("[AI Arena] MAIN world anti-throttle patch applied (v4.8.20 F32+)");
})();
