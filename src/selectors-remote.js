// selectors-remote.js — 远程选择器热更新（v5.0.64）
//
// 为什么存在：9 个 AI 平台任何一家改 DOM，全体用户的发送/提取立即断粮；
//   商店重审要数天。本模块让 background 定期从静态 JSON 拉「选择器覆盖表」，
//   getSelectors 时 override 优先 + 内置表兜底 —— 平台 DOM 变更只需向仓库
//   push 一个 JSON，用户端 12h 内自愈，零商店重审。
//
// 安全边界（CWS 远程代码红线）：
//   - 只接受纯数据（选择器字符串数组），严格 schema 校验 + 尺寸上限，绝不 eval
//   - 校验不过 = 当作不存在，永远回退内置表（fail-safe）
//   - 内容脚本侧 queryBySelectors 对每条选择器 try/catch，非法选择器跳过不炸 action
//
// 源顺序：GitHub raw（ACAO:* 实测✓）→ jsDelivr（ACAO:*，国内可达性较好）→
//   Gitee raw（302 无 ACAO，机会主义尝试）。全部失败 = 保持现状，下个周期再试。

(function (global) {
  const SCHEMA_VERSION = 1;
  const STALE_MS = 12 * 60 * 60 * 1000; // 12h 刷新周期
  const SOURCES = [
    "https://raw.githubusercontent.com/TianLin0509/ai-arena-extension/main/selectors-override.json",
    "https://cdn.jsdelivr.net/gh/TianLin0509/ai-arena-extension@main/selectors-override.json",
    "https://gitee.com/lt17210720082/ai-arena-extension/raw/main/selectors-override.json",
  ];
  // 与 selectors-config.js 各平台实际使用的 action 键对齐；未知键静默丢弃（前向兼容）
  const ACTION_KEYS = new Set(["input", "response", "streaming", "sendButton", "userMessage", "conversation"]);
  const LIMITS = { platforms: 24, selectorsPerAction: 24, selectorLength: 400 };

  // "5.0.64" 三段数字比较；解析失败返回 null → 调用方 fail-safe
  function parseVer(s) {
    const m = String(s || "").trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
    return m ? [+m[1], +m[2], +m[3]] : null;
  }
  function cmpVer(a, b) {
    const pa = parseVer(a), pb = parseVer(b);
    if (!pa || !pb) return null;
    for (let i = 0; i < 3; i++) { if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1; }
    return 0;
  }

  function isStale(fetchedAt, now) {
    if (typeof fetchedAt !== "number" || fetchedAt <= 0) return true;
    return (now - fetchedAt) >= STALE_MS;
  }

  // 严格校验 + 深拷贝消毒。任何整体性问题 → {ok:false}；单条选择器问题 → 丢该条。
  function validateOverride(raw, extVersion) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "not-object" };
    if (raw.schema !== SCHEMA_VERSION) return { ok: false, reason: "schema" };
    if (raw.minExtVersion != null) {
      const c = cmpVer(extVersion, raw.minExtVersion);
      if (c === null || c < 0) return { ok: false, reason: "minExtVersion" };
    }
    const src = raw.platforms;
    if (!src || typeof src !== "object" || Array.isArray(src)) return { ok: false, reason: "platforms" };
    const platforms = {};
    let count = 0;
    for (const [site, actions] of Object.entries(src)) {
      if (count >= LIMITS.platforms) break;
      if (!actions || typeof actions !== "object" || Array.isArray(actions)) continue;
      const clean = {};
      for (const [action, arr] of Object.entries(actions)) {
        if (!ACTION_KEYS.has(action) || !Array.isArray(arr)) continue;
        const sels = [];
        for (const s of arr) {
          if (sels.length >= LIMITS.selectorsPerAction) break;
          if (typeof s !== "string") continue;
          const t = s.trim();
          if (!t || t.length > LIMITS.selectorLength) continue;
          sels.push(t);
        }
        if (sels.length) clean[action] = sels;
      }
      if (Object.keys(clean).length) { platforms[site] = clean; count++; }
    }
    return { ok: true, platforms };
  }

  // override 优先 + 内置兜底（append 去重）。override 缺席该平台 → 直接回内置引用（零拷贝）。
  function mergeSelectors(defaults, overridePlatforms, platform) {
    const base = (defaults && defaults[platform]) || {};
    const over = overridePlatforms && overridePlatforms[platform];
    if (!over) return base;
    const merged = {};
    const keys = new Set([...Object.keys(over), ...Object.keys(base)]);
    for (const k of keys) {
      const seen = new Set();
      const out = [];
      for (const s of [...(over[k] || []), ...(base[k] || [])]) {
        if (seen.has(s)) continue;
        seen.add(s);
        out.push(s);
      }
      merged[k] = out;
    }
    return merged;
  }

  const api = { SCHEMA_VERSION, STALE_MS, SOURCES, validateOverride, mergeSelectors, cmpVer, isStale };

  global.SelectorsRemote = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis));
