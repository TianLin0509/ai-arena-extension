// AI Arena — Content Script Shared Helpers
// v5.2.6: 跨 9 平台提取共用工具
//
// 设计原则：
// - 必须在 inject-images.js 之前注入（manifest content_scripts 顺序）
// - 暴露到 globalThis.ArenaShared，避免污染 page world
// - IIFE + guard 防御 reload 扩展时重复声明
(function () {
  if (globalThis.ArenaShared && globalThis.ArenaShared._loaded) return;

  // 取数组里最后一个有 innerText 内容的元素
  // 解决：
  //   - 豆包 spacer 占位行（v_list_row 4 行里 2 行空）
  //   - streaming 起步窗口（容器建好但 SSE 还没填）
  //   - 思考链分容器（DeepSeek 思考 + 回复分两个 .ds-markdown，末位可能是空 thinking）
  //   - fallback selector 命中装饰元素（spinner / toolbar / 推荐问题）
  //
  // 行为：从末尾向前扫，第一个 innerText.trim().length > 0 的元素返回
  //       找不到返回 null —— 调用方应 fallback 到 responses[length-1] 保守兜底
  function getLastNonEmpty(elements) {
    if (!elements) return null;
    const arr = elements.length !== undefined ? elements : [...elements];
    for (let i = arr.length - 1; i >= 0; i--) {
      const el = arr[i];
      if (!el) continue;
      const text = (el.innerText || el.textContent || "").trim();
      if (text.length > 0) return el;
    }
    return null;
  }

  globalThis.ArenaShared = {
    _loaded: true,
    getLastNonEmpty,
  };
})();
