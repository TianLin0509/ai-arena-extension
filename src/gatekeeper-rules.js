// gatekeeper-rules.js — v4.9.0 内置敏感词规则
// 纯数据，无逻辑。被 gatekeeper-store.js 在首次启动时注入到 chrome.storage
// 用户和团队可在此基础上扩展（v4.9.1 设置页 + 团队包）

(function () {
  const BUILTIN_RULES = [
    // ── 正则类（高准确率） ──
    {
      id: "huawei-staff-id",
      category: "工号",
      type: "regex",
      pattern: "\\b[A-Z]?\\d{8}\\b",
      flags: "g",
      severity: "block",
      source: "builtin",
      enabled: true,
      desc: "华为工号：可选字母前缀 + 8 位数字",
    },
    {
      id: "internal-ip-10",
      category: "内网 IP",
      type: "regex",
      pattern: "\\b10\\.(?:25[0-5]|2[0-4]\\d|[01]?\\d?\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|[01]?\\d?\\d)){2}\\b",
      flags: "g",
      severity: "block",
      source: "builtin",
      enabled: true,
      desc: "10.x.x.x 段内网 IP",
    },
    {
      id: "internal-ip-172",
      category: "内网 IP",
      type: "regex",
      pattern: "\\b172\\.(1[6-9]|2\\d|3[01])(?:\\.(?:25[0-5]|2[0-4]\\d|[01]?\\d?\\d)){2}\\b",
      flags: "g",
      severity: "block",
      source: "builtin",
      enabled: true,
      desc: "172.16-31.x.x 段内网 IP",
    },
    {
      id: "internal-ip-192",
      category: "内网 IP",
      type: "regex",
      pattern: "\\b192\\.168(?:\\.(?:25[0-5]|2[0-4]\\d|[01]?\\d?\\d)){2}\\b",
      flags: "g",
      severity: "block",
      source: "builtin",
      enabled: true,
      desc: "192.168.x.x 段内网 IP",
    },
    {
      id: "huawei-email",
      category: "内部邮箱",
      type: "regex",
      pattern: "\\b[\\w.+-]+@huawei\\.com\\b",
      flags: "gi",
      severity: "block",
      source: "builtin",
      enabled: true,
      desc: "华为邮箱 (*@huawei.com)",
    },
    {
      id: "mobile-phone-cn",
      category: "手机号",
      type: "regex",
      pattern: "\\b1[3-9]\\d{9}\\b",
      flags: "g",
      severity: "block",
      source: "builtin",
      enabled: true,
      desc: "中国大陆手机号（11 位）",
    },
    {
      id: "huawei-internal-domain",
      category: "内部域名",
      type: "regex",
      pattern: "\\b(?:[\\w-]+\\.)+(?:huawei\\.com\\.cn|hi\\.huawei\\.com|w3\\.huawei\\.com|inhuawei\\.com)\\b",
      flags: "gi",
      severity: "block",
      source: "builtin",
      enabled: true,
      desc: "华为内网子域名（hi.huawei.com / w3.huawei.com 等）",
    },

    // ── 词表类（literal-list）──
    {
      id: "carrier-cn",
      category: "客户",
      type: "literal-list",
      pattern: ["中国移动", "中国电信", "中国联通", "中国广电"],
      severity: "block",
      source: "builtin",
      enabled: true,
      desc: "国内运营商客户名",
    },
    {
      id: "strategic-keywords",
      category: "保密词",
      type: "literal-list",
      pattern: ["保密", "未公开", "投标价", "议价", "内部资料"],
      severity: "warn",
      source: "builtin",
      enabled: true,
      desc: "战略关键词 — 软提醒，弹窗标黄不强阻",
    },
  ];

  // 暴露给 background service worker 和 popup（双端共用）
  if (typeof self !== "undefined") self.BUILTIN_RULES = BUILTIN_RULES;
  if (typeof window !== "undefined") window.BUILTIN_RULES = BUILTIN_RULES;
})();
