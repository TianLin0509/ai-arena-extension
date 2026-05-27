// gatekeeper-store.js — v4.9.0 chrome.storage 抽象
// 提供 loadRules / loadWhitelist / addWhitelist / saveStats 等纯数据操作
// 双端共用（background service worker + popup）

(function () {
  const KEY_ENABLED   = "gatekeeper.enabled";
  const KEY_USER      = "gatekeeper.rules.user";
  const KEY_TEAM      = "gatekeeper.rules.team";
  const KEY_WHITELIST = "gatekeeper.whitelist";
  const KEY_STATS     = "gatekeeper.stats";

  async function _get(keys) {
    return new Promise(res => chrome.storage.local.get(keys, r => res(r || {})));
  }
  async function _set(obj) {
    return new Promise(res => chrome.storage.local.set(obj, () => res()));
  }

  async function isEnabled() {
    const r = await _get([KEY_ENABLED]);
    return r[KEY_ENABLED] !== false;   // 默认启用
  }

  async function setEnabled(v) {
    await _set({ [KEY_ENABLED]: !!v });
  }

  // 加载全部启用规则：builtin（self.BUILTIN_RULES）+ user + team
  async function loadRules() {
    const r = await _get([KEY_USER, KEY_TEAM]);
    const builtin = (typeof self !== "undefined" && self.BUILTIN_RULES)
                  || (typeof window !== "undefined" && window.BUILTIN_RULES)
                  || [];
    const all = [...builtin, ...(r[KEY_USER] || []), ...(r[KEY_TEAM] || [])];
    return all.filter(rule => rule.enabled !== false);
  }

  async function loadWhitelist() {
    const r = await _get([KEY_WHITELIST]);
    return r[KEY_WHITELIST] || {};
  }

  async function addWhitelist(words, note) {
    const wl = await loadWhitelist();
    const ts = Date.now();
    for (const w of words) {
      if (!wl[w]) wl[w] = { addedAt: ts, note: note || "" };
    }
    await _set({ [KEY_WHITELIST]: wl });
  }

  async function removeWhitelist(word) {
    const wl = await loadWhitelist();
    delete wl[word];
    await _set({ [KEY_WHITELIST]: wl });
  }

  async function loadStats() {
    const r = await _get([KEY_STATS]);
    return r[KEY_STATS] || { hits: 0, masked: 0, skipped: 0, cancelled: 0 };
  }

  async function bumpStat(key) {
    const s = await loadStats();
    s[key] = (s[key] || 0) + 1;
    await _set({ [KEY_STATS]: s });
  }

  const api = {
    isEnabled, setEnabled,
    loadRules, loadWhitelist, addWhitelist, removeWhitelist,
    loadStats, bumpStat,
  };
  if (typeof self !== "undefined")   self.GatekeeperStore   = api;
  if (typeof window !== "undefined") window.GatekeeperStore = api;
})();
