// popup-logo-style.js — 卡牌 logo 风格切换
// v4.8.15: classic / anime；v4.8.51: 新增 cat（小猫风格）、basic（默认基础·朴素品牌 logo）
// v4.8.54: 新增 chick（小鸡 meme）、leader（领袖手持 logo）；DEFAULT 改为 basic
//   "记忆"由 storage 实现 — storage 存的 logoStyle 始终覆盖 DEFAULT，只对未选过的用户生效
// 暴露 window.ArenaLogoStyle 给 popup-members + popup.js 共用
(function () {
  const STORAGE_KEY = "logoStyle";
  // v4.8.54: 默认从 classic 改为 basic（用户没选过时显示基础品牌 logo；
  //   选过的用户 storage 里有 logoStyle 值，会覆盖此默认，保留他们的选择 — 即"有记忆"）
  const DEFAULT = "basic";
  // v4.8.51:
  //   - cat：和 classic/anime 一样的 225×320 webp 卡片（毛茸萌猫）
  //   - basic：不打包 webp 卡片，直接走 src/icons/brands/ 的品牌 SVG/PNG（最朴素，无装饰）
  //     huawei 是 png；chatgpt 走 openai.svg；其余按服务名同名 svg
  //     CSS 给 body[data-logo-style="basic"] 的 .hero-slot 加白底卡片样式（避免透明 SVG 撞 hero-slot 边）
  // v4.8.54:
  //   - chick：黄色小鸡 meme 卡片（225×320 webp）
  //   - leader：AI 公司 CEO 手捧 logo（225×320 webp）；claude 暂无图，fileMap 兜底走 basic
  // v4.8.55: name 统一缩成 2 字（设置面板更紧凑，desc 仍承载详细说明）；leader 删 fileMap 兜底
// v5.1.0: 新增 labubu（手办风潮玩）+ qq（QQ 经典怀旧头像），10 个 AI 各一张 PNG
  const STYLES = {
    basic:   { dir: "icons/brands",        name: "基础", desc: "纯品牌 logo·无装饰", ext: "svg",
               extOverrides: { huawei: "png" },
               idMap: { chatgpt: "openai" } },
    classic: { dir: "icons/heroes",        name: "英雄", desc: "Q 版热血英雄·首发版", ext: "webp" },
    anime:   { dir: "icons/heroes-anime",  name: "少女", desc: "Q 版美少女·人气番剧风", ext: "webp" },
    cat:     { dir: "icons/heroes-cat",    name: "小猫", desc: "毛茸茸 Q 版萌猫", ext: "webp" },
    chick:   { dir: "icons/heroes-chick",  name: "小鸡", desc: "黄色小鸡 meme·童趣", ext: "webp" },
    leader:  { dir: "icons/heroes-leader", name: "领袖", desc: "AI 公司 CEO 手捧 logo", ext: "webp" },
    labubu:  { dir: "icons/heroes-labubu", name: "潮玩", desc: "Labubu 潮玩手办主题风", ext: "png" },
    qq:      { dir: "icons/heroes-qq",     name: "怀旧", desc: "QQ 经典怀旧头像·童年回忆", ext: "png" },
  };
  const IDS = ["claude","gemini","chatgpt","deepseek","doubao","qwen","kimi","yuanbao","grok","huawei"];

  let current = DEFAULT;

  function heroPath(id) {
    const meta = STYLES[current] || STYLES[DEFAULT];
    // v4.8.54: fileMap 优先 — 整路径覆盖（用于 leader 风格 claude 兜底）
    if (meta.fileMap?.[id]) return meta.fileMap[id];
    const ext = meta.extOverrides?.[id] || meta.ext;
    const fname = meta.idMap?.[id] || id;
    return `${meta.dir}/${fname}.${ext}`;
  }

  // 预览图 — 设置 tab 风格 cards 里展示 1 张代表图（统一用 claude）
  function previewPath(style) {
    const meta = STYLES[style] || STYLES[DEFAULT];
    if (meta.fileMap?.claude) return meta.fileMap.claude;
    const ext = meta.extOverrides?.claude || meta.ext;
    const fname = meta.idMap?.claude || "claude";
    return `${meta.dir}/${fname}.${ext}`;
  }

  // v4.8.51: 把当前 style 同步到 body[data-logo-style] — basic 风格的 hero-slot 需 CSS 白底兜底
  function syncBodyAttr(style) {
    try {
      if (document.body) document.body.setAttribute("data-logo-style", style);
    } catch (_) {}
  }

  function setCurrent(style, persist = true) {
    if (!STYLES[style]) style = DEFAULT;
    if (current === style) return;
    current = style;
    syncBodyAttr(style);
    if (persist) {
      try { chrome.storage.local.set({ [STORAGE_KEY]: style }); } catch (_) {}
    }
    document.dispatchEvent(new CustomEvent("logo-style-changed", { detail: { style } }));
  }

  async function init() {
    try {
      const r = await new Promise(res => chrome.storage.local.get([STORAGE_KEY], resp => res(resp || {})));
      if (r[STORAGE_KEY] && STYLES[r[STORAGE_KEY]]) current = r[STORAGE_KEY];
    } catch (_) {}
    syncBodyAttr(current);
    document.dispatchEvent(new CustomEvent("logo-style-changed", { detail: { style: current, initial: true } }));
  }

  // 跨上下文同步（设置改了，主对话端也要重渲染）
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[STORAGE_KEY]) {
        const next = changes[STORAGE_KEY].newValue;
        if (next && STYLES[next] && next !== current) {
          current = next;
          syncBodyAttr(next);
          document.dispatchEvent(new CustomEvent("logo-style-changed", { detail: { style: next } }));
        }
      }
    });
  } catch (_) {}

  window.ArenaLogoStyle = {
    get current() { return current; },
    setCurrent,
    heroPath,
    previewPath,
    listStyles() { return Object.entries(STYLES).map(([k, v]) => ({ id: k, ...v })); },
    IDS,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
