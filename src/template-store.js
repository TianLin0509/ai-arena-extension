// template-store.js — 模板的统一访问层
// 同时在 background SW（importScripts）和 popup（<script>）下工作
// 数据持久层：chrome.storage.local["arena_templates_v1"]
// 缓存策略：启动 prefetch 到内存；监听 onChanged 同步刷新；所有 resolve 同步返回

(function (root) {
  const STORAGE_KEY = "arena_templates_v1";
  const _subscribers = new Set();
  let _cache = { overrides: {}, userTemplates: [] };
  let _ready = false;
  let _readyPromise = null;

  function _builtin() {
    return root.ArenaBuiltinTemplates || {};
  }

  function _safeStorage() {
    try {
      return (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) ? chrome.storage.local : null;
    } catch (_) { return null; }
  }

  function _notify() {
    _subscribers.forEach(cb => { try { cb(); } catch (_) {} });
  }

  async function init() {
    if (_readyPromise) return _readyPromise;
    _readyPromise = new Promise((resolve) => {
      const storage = _safeStorage();
      if (!storage) { _ready = true; resolve(); return; }
      storage.get([STORAGE_KEY], (r) => {
        const got = r && r[STORAGE_KEY];
        if (got && typeof got === "object") {
          _cache.overrides = got.overrides && typeof got.overrides === "object" ? got.overrides : {};
          _cache.userTemplates = Array.isArray(got.userTemplates) ? got.userTemplates : [];
        }
        _ready = true;
        resolve();
      });
    });
    // 监听 storage 变化（跨 popup/SW 同步）
    try {
      const storage = _safeStorage();
      if (storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area !== "local" || !changes[STORAGE_KEY]) return;
          const v = changes[STORAGE_KEY].newValue || { overrides: {}, userTemplates: [] };
          _cache.overrides = v.overrides && typeof v.overrides === "object" ? v.overrides : {};
          _cache.userTemplates = Array.isArray(v.userTemplates) ? v.userTemplates : [];
          _notify();
        });
      }
    } catch (_) {}
    return _readyPromise;
  }

  function _persist() {
    const storage = _safeStorage();
    if (!storage) return Promise.resolve();
    return new Promise((resolve) => {
      storage.set({ [STORAGE_KEY]: _cache }, () => resolve());
    });
  }

  function isReady() { return _ready; }

  // 同步 resolve：override?.[fieldKey] ?? builtin.fields[k].value
  function resolve(binding, fieldKey) {
    const ov = _cache.overrides[binding];
    if (ov && ov[fieldKey] !== undefined) return ov[fieldKey];
    const b = _builtin()[binding];
    if (!b) return "";
    const f = b.fields.find(x => x.key === fieldKey);
    return f ? f.value : "";
  }

  // 返回该 binding 所有字段的当前值 {fieldKey: value}
  function resolveAllFields(binding) {
    const b = _builtin()[binding];
    if (!b) return {};
    const out = {};
    b.fields.forEach(f => { out[f.key] = resolve(binding, f.key); });
    return out;
  }

  // 返回完整模板对象（含字段是否被覆盖的标记）
  function resolveTemplate(binding) {
    const b = _builtin()[binding];
    if (!b) return null;
    const ov = _cache.overrides[binding] || {};
    const fields = b.fields.map(f => ({
      ...f,
      value: ov[f.key] !== undefined ? ov[f.key] : f.value,
      modified: ov[f.key] !== undefined
    }));
    return {
      binding: b.binding,
      emoji: b.emoji,
      name: b.name,
      category: b.category,
      fields,
      anyModified: fields.some(x => x.modified)
    };
  }

  function listBuiltinBindings() {
    return Object.keys(_builtin());
  }

  function listBuiltinTemplates() {
    return listBuiltinBindings().map(b => resolveTemplate(b)).filter(Boolean);
  }

  async function saveOverride(binding, fieldKey, value) {
    if (!_cache.overrides[binding]) _cache.overrides[binding] = {};
    _cache.overrides[binding][fieldKey] = value;
    await _persist();
    _notify();
  }

  // v4.5.1: 批量 patch 一个 binding 的多个字段，单次 _persist + 单次 _notify。
  // patches 形如 { fieldKey: value | null }，value=null 表示重置该字段（删 override）。
  // 修复 P0：避免 saveEditor 并发 Promise.all 触发多次 storage.set 和 N 次重渲染。
  async function applyOverridesBatch(binding, patches) {
    if (!patches || typeof patches !== "object") return;
    const keys = Object.keys(patches);
    if (keys.length === 0) return;
    if (!_cache.overrides[binding]) _cache.overrides[binding] = {};
    for (const k of keys) {
      const v = patches[k];
      if (v === null || v === undefined) {
        delete _cache.overrides[binding][k];
      } else {
        _cache.overrides[binding][k] = v;
      }
    }
    if (Object.keys(_cache.overrides[binding]).length === 0) {
      delete _cache.overrides[binding];
    }
    await _persist();
    _notify();
  }

  async function resetOverride(binding, fieldKey) {
    if (!_cache.overrides[binding]) return;
    if (fieldKey === undefined) {
      delete _cache.overrides[binding];
    } else {
      delete _cache.overrides[binding][fieldKey];
      if (Object.keys(_cache.overrides[binding]).length === 0) delete _cache.overrides[binding];
    }
    await _persist();
    _notify();
  }

  async function resetAllOverrides() {
    _cache.overrides = {};
    await _persist();
    _notify();
  }

  function listUserTemplates() {
    return _cache.userTemplates.slice();
  }

  function getUserTemplate(id) {
    return _cache.userTemplates.find(t => t.id === id) || null;
  }

  function _genId() {
    return "u_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  async function addUserTemplate({ name, body }) {
    const now = Date.now();
    const t = {
      id: _genId(),
      name: String(name || "").trim(),
      body: String(body || ""),
      createdAt: now,
      updatedAt: now
    };
    _cache.userTemplates.push(t);
    await _persist();
    _notify();
    return t;
  }

  async function updateUserTemplate(id, patch) {
    const t = _cache.userTemplates.find(x => x.id === id);
    if (!t) return null;
    if (patch.name !== undefined) t.name = String(patch.name || "").trim();
    if (patch.body !== undefined) t.body = String(patch.body || "");
    t.updatedAt = Date.now();
    await _persist();
    _notify();
    return t;
  }

  async function deleteUserTemplate(id) {
    const before = _cache.userTemplates.length;
    _cache.userTemplates = _cache.userTemplates.filter(x => x.id !== id);
    if (_cache.userTemplates.length === before) return false;
    await _persist();
    _notify();
    return true;
  }

  function subscribe(cb) {
    if (typeof cb !== "function") return () => {};
    _subscribers.add(cb);
    return () => _subscribers.delete(cb);
  }

  root.ArenaTemplateStore = {
    init,
    isReady,
    resolve,
    resolveAllFields,
    resolveTemplate,
    listBuiltinBindings,
    listBuiltinTemplates,
    saveOverride,
    applyOverridesBatch,
    resetOverride,
    resetAllOverrides,
    listUserTemplates,
    getUserTemplate,
    addUserTemplate,
    updateUserTemplate,
    deleteUserTemplate,
    subscribe
  };

  // 自动 init（异步）
  init();
})(typeof self !== "undefined" ? self : window);
