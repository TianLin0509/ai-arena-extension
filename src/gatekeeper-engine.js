// gatekeeper-engine.js — v4.9.0 敏感信息扫描引擎
// scan(text) → Hit[]，maskText(text, hits) → string
// 简单 for-loop 逐 rule exec，MVP 不做 mega-regex（10 几条规则总 < 10ms 够用）
// 100ms 超时兜底防 ReDoS

(function () {
  const SCAN_TIMEOUT_MS = 100;

  // 把 rule 编译成 RegExp 或 literal RegExp
  function compileRule(rule) {
    if (rule.type === "regex") {
      try { return new RegExp(rule.pattern, rule.flags || "g"); }
      catch (e) { console.warn("[Gatekeeper] bad regex", rule.id, e); return null; }
    }
    if (rule.type === "literal" || rule.type === "literal-list") {
      const words = Array.isArray(rule.pattern) ? rule.pattern : [rule.pattern];
      const escaped = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      try { return new RegExp("(?:" + escaped.join("|") + ")", "g"); }
      catch (e) { console.warn("[Gatekeeper] bad literal", rule.id, e); return null; }
    }
    return null;
  }

  async function scan(text) {
    if (!text || typeof text !== "string") return [];
    const Store = (self.GatekeeperStore || window.GatekeeperStore);
    if (!Store) return [];

    const enabled = await Store.isEnabled();
    if (!enabled) return [];

    const rules = await Store.loadRules();
    const whitelist = await Store.loadWhitelist();
    const hits = [];

    const deadline = Date.now() + SCAN_TIMEOUT_MS;
    for (const rule of rules) {
      if (Date.now() > deadline) {
        console.warn("[Gatekeeper] scan timeout, returning partial hits");
        break;
      }
      const re = compileRule(rule);
      if (!re) continue;
      let m;
      // 用新对象避免 lastIndex 串扰
      const localRe = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
      while ((m = localRe.exec(text)) !== null) {
        const matched = m[0];
        if (whitelist[matched]) continue;
        hits.push({
          rule: rule.id,
          category: rule.category,
          text: matched,
          index: m.index,
          length: matched.length,
          masked: `<${rule.category}>`,
          severity: rule.severity || "block",
        });
        if (m.index === localRe.lastIndex) localRe.lastIndex++;  // 防 0-width 死循环
      }
    }

    // 按 index 升序返回（用户视觉顺序）
    return hits.sort((a, b) => a.index - b.index);
  }

  function maskText(text, hits) {
    if (!hits || !hits.length) return text;
    // 按 index 倒序替换，避免 offset 错乱
    const sorted = [...hits].sort((a, b) => b.index - a.index);
    let result = text;
    for (const h of sorted) {
      result = result.slice(0, h.index) + h.masked + result.slice(h.index + h.length);
    }
    return result;
  }

  // 仅判断有没有 block 级命中（warn 不算）— 给"是否阻断"的判定
  function hasBlocking(hits) {
    return hits.some(h => h.severity !== "warn");
  }

  const api = { scan, maskText, hasBlocking };
  if (typeof self !== "undefined")   self.GatekeeperEngine   = api;
  if (typeof window !== "undefined") window.GatekeeperEngine = api;
})();
