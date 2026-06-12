// popup-settings.js — 设置 Tab：主题 + 快捷键
// v4.6.9: 状态日志已抽到 popup-log.js（右栏下半部分固定区），本文件不再含 log 逻辑
(function () {
  // v4.8.18: 主题中文化（参考"湛蓝陨石"风格 — 4 字诗意命名，跟卡牌风格统一）
  // v5.1.0: 新增 G 绛紫暮霭 / H 碧绿茶林，总 8 套
  const THEMES = [
    { id: "C", name: "极光琉璃",  gradient: "linear-gradient(135deg,#5eead4,#a78bfa)" },
    { id: "A", name: "深海指挥",  gradient: "linear-gradient(135deg,#4f8cff,#6ee7ff)" },
    { id: "B", name: "暖橙书页",  gradient: "linear-gradient(135deg,#b85c38,#e6d7c8)" },
    { id: "D", name: "霓虹赛博",  gradient: "linear-gradient(135deg,#ff2d95,#00f0ff)" },
    { id: "E", name: "月白极简",  gradient: "linear-gradient(135deg,#1a1a2e,#fff)" },
    { id: "F", name: "落日熔金",  gradient: "linear-gradient(135deg,#ff8c42,#e84393)" },
    { id: "G", name: "绛紫暮霭",  gradient: "linear-gradient(135deg,#a855f7,#4a2870)" },
    { id: "H", name: "碧绿茶林",  gradient: "linear-gradient(135deg,#4d8b56,#a3d9a5)" },
  ];
  const THEME_KEY = "uiTheme";
  const CAPTAIN_KEY = "captainModeEnabled";
  // v5.0.19: 上下文压缩 — 多轮辩论转发队友回答时压缩超长部分（防公司网关上传限额），默认关
  const COMPRESS_KEY = "debateContextCompressEnabled";
  // v5.0.21: 划线收藏 — AI 原网页选中文本浮出"存入备忘录"按钮，默认开
  const MEMOCLIP_KEY = "memoClipEnabled";

  // v5.2.25: 新用户默认主题改为 A 深海指挥（用户已设置过 → storage 覆盖此默认，保留选择）
  let currentTheme = "A";
  let captainMode = true;
  let contextCompress = false;
  let memoClip = true;

  function render() {
    const root = document.getElementById("rp-panel-settings");
    if (!root) return;
    // v4.8.15: 风格区块 — 卡牌 logo 在「经典英雄」「二次元少女」两套美术之间切换
    const logoStyle = window.ArenaLogoStyle?.current || "classic";
    const styles = window.ArenaLogoStyle?.listStyles() || [];
    const stylesHtml = styles.map(s => {
      const preview = window.ArenaLogoStyle?.previewPath(s.id) || "";
      const active = s.id === logoStyle;
      return `
        <div class="rp-style-item ${active ? "active" : ""}" data-style="${s.id}" title="${s.desc}">
          <img class="rp-style-preview" src="${preview}" alt="${s.name}">
          <div class="rp-style-meta">
            <div class="rp-style-name">${s.name}${active ? " ✓" : ""}</div>
            <div class="rp-style-desc">${s.desc}</div>
          </div>
        </div>`;
    }).join("");

    // v5.0.6: AI 窗口布局 + 检查更新 + GitHub + 新手教程 从顶栏迁到设置 tab
    const curWinMode = window.ChatWindowMode?.current || "tiled";
    root.innerHTML = `
      <div class="rp-section-title">应用</div>
      <div class="rp-app-group">
        <div class="rp-app-row">
          <span class="rp-app-row-lbl">AI 窗口布局</span>
          <div class="hdr-mode-toggle" id="hdr-mode-toggle" role="group" aria-label="AI 窗口布局">
            <button type="button" class="hdr-mode-btn ${curWinMode === 'tab' ? 'active' : ''}" data-mode="tab" title="所有 AI 同窗口不同标签页">Tab</button>
            <button type="button" class="hdr-mode-btn ${curWinMode === 'tiled' ? 'active' : ''}" data-mode="tiled" title="每个 AI 独立窗口并列">并列</button>
          </div>
        </div>
        <div class="rp-app-row">
          <span class="rp-app-row-lbl">协作身份</span>
          <button class="rp-app-btn ${captainMode ? 'active' : ''}" id="rp-captain-toggle" title="切换队长模式 / 普通模式">
            ${captainMode ? '队长模式' : '普通模式'}
          </button>
        </div>
        <div class="rp-app-row">
          <span class="rp-app-row-lbl">上下文压缩</span>
          <button class="rp-app-btn ${contextCompress ? 'active' : ''}" id="rp-compress-toggle" title="多轮辩论转发队友回答时压缩超长部分（保留首尾要点），防止单次发送过长触发公司网关/站点上传限额">
            ${contextCompress ? '已开启' : '已关闭'}
          </button>
        </div>
        <div class="rp-app-row">
          <span class="rp-app-row-lbl">划线收藏</span>
          <button class="rp-app-btn ${memoClip ? 'active' : ''}" id="rp-memoclip-toggle" title="在 AI 原网页选中文本时浮出「存入圆桌备忘录」按钮（圆桌主界面的划线收藏始终可用）">
            ${memoClip ? '已开启' : '已关闭'}
          </button>
        </div>
        <div class="rp-app-row rp-app-row-btns">
          <button class="rp-app-btn" id="rp-check-update" title="调 GitHub Releases API 比对版本">↻ 检查更新</button>
          <button class="rp-app-btn" id="rp-open-github" title="在新标签页打开 GitHub 仓库">⎘ GitHub</button>
          <button class="rp-app-btn" id="rp-open-tutorial" title="打开完整玩法手册（5 页）">📘 新手教程</button>
          <button class="rp-app-btn" id="rp-restart-onboarding" title="重新开始 4 步任务式新手之旅">🔰 新手之旅</button>
        </div>
      </div>

      <div class="rp-section-title">主题</div>
      <div class="rp-theme-grid">
        ${THEMES.map(t => `
          <div class="rp-theme-item ${t.id === currentTheme ? "active" : ""}" data-theme="${t.id}">
            <span class="rp-theme-swatch" style="background:${t.gradient}"></span>
            <span>${t.name}${t.id === currentTheme ? " ✓" : ""}</span>
          </div>
        `).join("")}
      </div>

      <div class="rp-section-title">风格</div>
      <div class="rp-style-grid">${stylesHtml}</div>

      <div class="rp-section-title">快捷键</div>
      <div class="rp-kbd-list">
        <div><span class="rp-kbd">Ctrl+Enter</span> 发送给全部</div>
        <div><span class="rp-kbd">Ctrl+Shift+D</span> 辩论</div>
        <div><span class="rp-kbd">@</span> 单发指定 AI</div>
        <div><span class="rp-kbd">@all</span> 显式全发</div>
      </div>

      <div class="rp-section-title">常见问题</div>
      <div class="rp-faq">
        <details><summary>为什么要登录各家 AI 的网站？</summary><p>圆桌的原理是插件替你同时操作各家 AI 的<b>官方网页</b>，所以用哪个 AI 就要登录哪个 AI 的网站（手机号注册即可）。插件不收集、不经手你的账号。</p></details>
        <details><summary>浏览器顶上的黄色「调试」提示是什么？</summary><p>Tab 模式下读取 AI 回答的正常通道，是 Chrome 对所有同类插件的标准提示，不是病毒。<b>请不要点「取消」</b>，否则 AI 回答会变慢。</p></details>
        <details><summary>为什么 Claude / ChatGPT / Gemini 打不开？</summary><p>这几家需要国际网络环境。没有的话，用「🟢 国内直连」分组里的 AI（DeepSeek / 豆包 / Kimi / 元宝），点了就能用。</p></details>
        <details><summary>AI 一直转圈不回答怎么办？</summary><p>点成员 Tab 的「🩺 体检」按钮，红灯项旁边就是修复按钮；也可以用气泡上的 🔄 重新提取 / ⏭ 跳过。</p></details>
        <details><summary>我的对话数据存在哪里？</summary><p>全部存在<b>你自己电脑</b>的浏览器里（chrome.storage），不上传任何服务器。卸载插件即全部清除。</p></details>
        <details><summary>怎么只问其中一个 AI？</summary><p>输入框里打 <b>@</b> 选 AI 名字，就只发给它（不广播给其他人）。</p></details>
        <details><summary>怎么移除一个 AI？</summary><p>成员卡右上角的 <b>×</b>。它的网页标签也会一起关掉。</p></details>
        <details><summary>想重看新手引导？</summary><p>上面「应用」区的 <b>🔰 新手之旅</b>（4 步任务）或 <b>📘 新手教程</b>（完整手册）。</p></details>
      </div>
    `;

    // v5.0.6: 应用区块事件绑定
    root.querySelectorAll(".hdr-mode-btn").forEach(b => {
      b.addEventListener("click", () => {
        window.ChatWindowMode?.set?.(b.dataset.mode);
        // 立即更新 active 视觉（ChatWindowMode.set 是 async，先本地反馈）
        root.querySelectorAll(".hdr-mode-btn").forEach(x => x.classList.toggle("active", x.dataset.mode === b.dataset.mode));
      });
    });
    root.querySelector("#rp-check-update")?.addEventListener("click", () => {
      window.ChatUpdateCheck?.checkAndShow?.({ manual: true }).catch(() => {});
    });
    root.querySelector("#rp-open-github")?.addEventListener("click", () => {
      try { chrome.tabs.create({ url: "https://github.com/TianLin0509/ai-arena-extension" }); } catch (_) {}
    });
    root.querySelector("#rp-open-tutorial")?.addEventListener("click", () => {
      window.ChatTutorial?.show?.();
    });
    // v5.0.22 A: 重开任务式新手之旅
    root.querySelector("#rp-restart-onboarding")?.addEventListener("click", () => {
      window.ChatOnboarding?.restart?.();
    });
    root.querySelector("#rp-captain-toggle")?.addEventListener("click", () => {
      captainMode = !captainMode;
      try { chrome.storage.local.set({ [CAPTAIN_KEY]: captainMode }); } catch (_) {}
      render();
    });
    root.querySelector("#rp-compress-toggle")?.addEventListener("click", () => {
      contextCompress = !contextCompress;
      try { chrome.storage.local.set({ [COMPRESS_KEY]: contextCompress }); } catch (_) {}
      render();
    });
    root.querySelector("#rp-memoclip-toggle")?.addEventListener("click", () => {
      memoClip = !memoClip;
      try { chrome.storage.local.set({ [MEMOCLIP_KEY]: memoClip }); } catch (_) {}
      render();
    });

    root.querySelectorAll(".rp-theme-item").forEach(el => {
      el.addEventListener("click", () => setTheme(el.dataset.theme));
    });
    root.querySelectorAll(".rp-style-item").forEach(el => {
      el.addEventListener("click", () => {
        window.ArenaLogoStyle?.setCurrent(el.dataset.style);
        render();   // 立即重绘 active 标记
      });
    });
  }

  function setTheme(id) {
    currentTheme = id;
    document.body.setAttribute("data-theme", id);
    try { chrome.storage.local.set({ [THEME_KEY]: id }); } catch (_) {}
    render();
    document.dispatchEvent(new CustomEvent("theme:changed", { detail: { theme: id } }));
  }

  async function refresh() {
    try {
      const r = await new Promise(res => {
        chrome.storage.local.get([THEME_KEY, CAPTAIN_KEY, COMPRESS_KEY, MEMOCLIP_KEY], resp => res(resp || {}));
      });
      if (r[THEME_KEY]) {
        currentTheme = r[THEME_KEY];
        document.body.setAttribute("data-theme", currentTheme);
      } else {
        document.body.setAttribute("data-theme", currentTheme);
      }
      captainMode = r[CAPTAIN_KEY] !== false;
      contextCompress = r[COMPRESS_KEY] === true;  // v5.0.19: 默认关，显式打开才压缩
      memoClip = r[MEMOCLIP_KEY] !== false;        // v5.0.21: 默认开
    } catch (_) {}
    render();
  }

  document.addEventListener("rp:activated", (e) => {
    if (e.detail?.tab === "settings") refresh();
  });
  // v4.8.15: logo 风格跨实例切换 → 重绘以更新 ✓ 标记
  document.addEventListener("logo-style-changed", () => render());

  document.addEventListener("theme:cycle", () => {
    const ids = THEMES.map(t => t.id);
    const idx = ids.indexOf(currentTheme);
    const next = ids[(idx + 1) % ids.length];
    setTheme(next);
  });

  // pushLog 兼容入口由 popup-log.js 接管：window.ChatSettings.pushLog = ChatLog.push
  // 这里不再监听 chrome.runtime.onMessage (避免双重监听导致日志重复)
  const api = {
    refresh, render, setTheme,
    currentTheme: () => currentTheme,
  };
  // 跟 popup-log.js 共存：popup-log.js 已经把 pushLog 挂到了 window.ChatSettings
  if (window.ChatSettings) Object.assign(window.ChatSettings, api);
  else window.ChatSettings = api;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refresh);
  } else {
    refresh();
  }
})();
