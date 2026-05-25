// AI Arena — 共享操作图标库（v4.8.42）
// 卡下方 .hqa-btn 和气泡 .msg-meta .acts button 共用 5 个 Lucide 风 SVG
//   resend     重新发送 — paper plane（再次发出）
//   reextract  重新提取 — refresh-cw（圆环箭头）
//   skip       跳过本轮 — skip-forward（双三角）
//   copy       复制     — overlapping squares
//   jump       跳原页   — external-link
//
// 用法：window.ChatActionIcons.svg("resend")  返回 inline SVG string
(function () {
  const SVGS = {
    resend:
      '<svg class="ai-icn" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
    reextract:
      '<svg class="ai-icn" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/><path d="M21 3v6h-6"/></svg>',
    skip:
      '<svg class="ai-icn" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/></svg>',
    copy:
      '<svg class="ai-icn" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
    jump:
      '<svg class="ai-icn" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  };
  function svg(action) { return SVGS[action] || ""; }
  window.ChatActionIcons = { svg };
})();
