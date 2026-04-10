// selector-manager.js — 四层选择器管理
// 优先级：GitHub 热更新 > 内置默认 > 启发式兜底

const GITHUB_SELECTORS_URL = "https://raw.githubusercontent.com/lintian233/ai-arena-extension/master/selectors.json";
const SELECTORS_CACHE_KEY = "selectorsRemoteCache";
const SELECTORS_FETCH_TIMEOUT = 3000; // 3秒超时，静默失败
const SELECTOR_FAILURE_LOG_KEY = "selectorFailureLog";

const SelectorManager = {
  _remoteSelectors: null,  // GitHub 热更新的选择器
  _failureLog: {},         // { platform: { action: count } }

  // 初始化：从 cache 加载 + 异步拉取远程
  async init() {
    // 从本地缓存恢复
    try {
      const data = await chrome.storage.local.get([SELECTORS_CACHE_KEY, SELECTOR_FAILURE_LOG_KEY]);
      if (data[SELECTORS_CACHE_KEY]) this._remoteSelectors = data[SELECTORS_CACHE_KEY];
      if (data[SELECTOR_FAILURE_LOG_KEY]) this._failureLog = data[SELECTOR_FAILURE_LOG_KEY];
    } catch {}

    // 异步拉取远程（不阻塞启动）
    this._fetchRemote();
  },

  async _fetchRemote() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SELECTORS_FETCH_TIMEOUT);
      const resp = await fetch(GITHUB_SELECTORS_URL, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (resp.ok) {
        const data = await resp.json();
        this._remoteSelectors = data;
        chrome.storage.local.set({ [SELECTORS_CACHE_KEY]: data });
      }
    } catch {
      // 网络不可用（公司内网等），静默失败，用缓存或内置
    }
  },

  // 获取某平台某操作的选择器数组（已按优先级合并）
  getSelectors(platform, action) {
    const remote = this._remoteSelectors?.[platform]?.[action] || [];
    const builtin = DEFAULT_SELECTORS[platform]?.[action] || [];
    // 去重合并：远程优先，然后内置
    const seen = new Set();
    const merged = [];
    for (const sel of [...remote, ...builtin]) {
      if (!seen.has(sel)) { seen.add(sel); merged.push(sel); }
    }
    return merged;
  },

  // 获取所有平台的完整选择器配置（供 content script 请求）
  getAllForPlatform(platform) {
    const result = {};
    const actions = new Set([
      ...Object.keys(DEFAULT_SELECTORS[platform] || {}),
      ...Object.keys(this._remoteSelectors?.[platform] || {})
    ]);
    for (const action of actions) {
      result[action] = this.getSelectors(platform, action);
    }
    return result;
  },

  // 上报选择器失败
  reportFailure(platform, action) {
    if (!this._failureLog[platform]) this._failureLog[platform] = {};
    this._failureLog[platform][action] = (this._failureLog[platform][action] || 0) + 1;
    chrome.storage.local.set({ [SELECTOR_FAILURE_LOG_KEY]: this._failureLog });
    // 通知侧边栏
    chrome.runtime.sendMessage({
      type: "selectorWarning",
      platform,
      action,
      message: `${platform} 的 ${action} 选择器可能已失效（已降级到启发式模式）`
    }).catch(() => {});
  },

  getFailureLog() {
    return this._failureLog;
  }
};
