// memo-store.js — v5.0.21 划线收藏（备忘录）存储
// 用户场景：多 AI 迭代过程中看到好的金句/结论，划线一键存进圆桌备忘录 Tab，
// 来源可以是 AI 原网页（content-shared 浮钮）或圆桌主界面气泡（popup-memos）。
// 数据：chrome.storage.local["arenaMemos"] = [{id, text, source:{type,service,url,title}, ts}]
self.ArenaMemoStore = (() => {
  const KEY = "arenaMemos";
  const MAX_ITEMS = 200;   // FIFO 上限，防 storage 膨胀
  const MAX_TEXT = 5000;   // 单条上限
  let mutationQueue = Promise.resolve();

  function enqueueMutation(fn) {
    const run = mutationQueue.catch(() => {}).then(fn);
    mutationQueue = run.catch(() => {});
    return run;
  }

  async function list() {
    const d = await chrome.storage.local.get([KEY]);
    return Array.isArray(d[KEY]) ? d[KEY] : [];
  }

  async function add(text, source) {
    return enqueueMutation(async () => {
      const t = String(text || "").trim().slice(0, MAX_TEXT);
      if (!t) return { ok: false, error: "空内容" };
      const items = await list();
      const memo = {
        id: `memo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        text: t,
        source: source && typeof source === "object" ? source : {},
        ts: Date.now(),
      };
      items.push(memo);
      while (items.length > MAX_ITEMS) items.shift();
      await chrome.storage.local.set({ [KEY]: items });
      _notify(items.length);
      return { ok: true, memo, count: items.length };
    });
  }

  async function remove(id) {
    return enqueueMutation(async () => {
      const items = await list();
      const next = items.filter(m => m.id !== id);
      await chrome.storage.local.set({ [KEY]: next });
      _notify(next.length);
      return { ok: true, count: next.length };
    });
  }

  async function clear() {
    return enqueueMutation(async () => {
      await chrome.storage.local.set({ [KEY]: [] });
      _notify(0);
      return { ok: true, count: 0 };
    });
  }

  // 通知 popup 刷新备忘录 Tab（popup 关闭时静默失败，符合 F17 设计）
  function _notify(count) {
    try { chrome.runtime.sendMessage({ type: "memoUpdated", count }).catch(() => {}); } catch (_) {}
  }

  return { list, add, remove, clear, KEY, MAX_ITEMS, MAX_TEXT };
})();
