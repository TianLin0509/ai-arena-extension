// popup-role-hats.js — 成员 Tab 的「角色帽」section
// v4.6.0: 参考 Hub 群聊职责帽机制。
//   - 5 顶通用角色帽（在 templates-builtin.js 以 role.* binding 定义）
//   - 用户在成员栏点角色帽 → 弹"选 AI"菜单 → 拼 prompt 进群聊输入框
//   - prompt 格式：`@AI 戴上「label」帽子：{duty}\n输出格式：{format}\n\n`
//     选"全员广播"则不带 @（走广播逻辑）

(function () {
  const ROLE_BINDINGS = [
    "role.clarifier",
    "role.fact_check",
    "role.critic",
    "role.judge",
    "role.action"
  ];

  // v4.6.1 P2 fix: participant 没 emoji 字段时按 service id 查表（与 popup-members.js ALL_SERVICES 同步）
  const SERVICE_EMOJI = {
    claude: "🟧",   // Anthropic 橙
    gemini: "🔷",   // Google 蓝菱
    chatgpt: "🟢",  // OpenAI 绿
    deepseek: "🔵", // DeepSeek 蓝
    doubao: "🥟",   // 豆包
    qwen: "🐫",     // 千问（驼）
    kimi: "🌙",     // Kimi 月
    yuanbao: "💰",  // 元宝
    grok: "❌"       // Grok X
  };

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function showToast(msg) {
    const t = document.getElementById("tpl-toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("tpl-toast-show");
    clearTimeout(t._hatTimer);
    t._hatTimer = setTimeout(() => t.classList.remove("tpl-toast-show"), 1800);
  }

  // ============== AI 选择菜单 ==============
  let menuEl = null;
  let outsideHandler = null;

  function closeMenu() {
    if (menuEl) { menuEl.remove(); menuEl = null; }
    if (outsideHandler) { document.removeEventListener("click", outsideHandler, true); outsideHandler = null; }
  }

  function openAiPickerMenu(anchorBtn, binding) {
    closeMenu();
    chrome.runtime.sendMessage({ type: "getState" }, (state) => {
      // v4.6.1 P1 fix: 检查 lastError（SW 休眠时 callback 会拿到 undefined state）
      if (chrome.runtime.lastError) {
        console.warn("[RoleHats] getState failed:", chrome.runtime.lastError.message);
        showToast("背景脚本未就绪，请稍后重试");
        return;
      }
      const participants = Array.isArray(state?.participants) ? state.participants : [];
      const rect = anchorBtn.getBoundingClientRect();
      menuEl = document.createElement("div");
      menuEl.className = "rp-hat-picker";
      menuEl.style.position = "fixed";

      const tpl = window.ArenaTemplateStore?.resolveTemplate(binding);
      const hatName = tpl?.name || binding;
      const hatEmoji = tpl?.emoji || "🎩";

      const items = [
        ...participants.map(p => ({
          kind: "single",
          id: p.id,
          // P1 fix: service id（小写）+ 中文 name（fallback）都缓存，applyHat 优先用 id 避免 mention 解析歧义
          serviceId: p.id,
          name: p.name,
          html: `<span class="rp-hat-pi-em">${escapeHtml(SERVICE_EMOJI[p.id] || "🤖")}</span><span>${escapeHtml(p.name)}</span>`
        })),
        // v4.6.1: 1 个参与者也允许"全员广播"（去掉 >= 2 限制，单参与者时它等价于直接给该 AI，但语义上仍然是"广播"）
        ...(participants.length >= 1
          ? [{
              kind: "broadcast",
              id: "__all__",
              name: "全员广播",
              html: `<span class="rp-hat-pi-em">📣</span><span>全员广播</span>`
            }]
          : [])
      ];

      const header = `<div class="rp-hat-picker-header">给谁戴 ${escapeHtml(hatEmoji)} ${escapeHtml(hatName)}？</div>`;
      const body = items.length === 0
        ? `<div class="rp-hat-picker-empty">先在上方添加 AI 参与者</div>`
        : items.map(it => `
            <button class="rp-hat-picker-item" data-target="${escapeHtml(it.id)}" data-kind="${it.kind}">
              ${it.html}
            </button>
          `).join("");

      menuEl.innerHTML = header + body;
      document.body.appendChild(menuEl);

      // v4.6.1 P2 fix: 测得 menu 实际尺寸后再 clamp 到 viewport（防 popup 窄被裁切）
      const menuRect = menuEl.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const left = Math.max(8, Math.min(rect.left, vw - menuRect.width - 8));
      const top = (rect.bottom + 4 + menuRect.height > vh)
        ? Math.max(8, rect.top - menuRect.height - 4)   // 顶部空间也不够时仍尽量塞
        : (rect.bottom + 4);
      menuEl.style.left = `${left}px`;
      menuEl.style.top = `${top}px`;

      menuEl.querySelectorAll(".rp-hat-picker-item").forEach(btn => {
        btn.addEventListener("click", () => {
          // v4.6.1 P1 fix: applyHat 内部异步 sendMessage，closeMenu 移到 callback 之后
          // 这里 menuEl 引用先抓一下，applyHat 内部 closeMenu 依赖全局 menuEl，已 sync
          applyHat(binding, btn.dataset.target, btn.dataset.kind);
        });
      });

      // 点击外部关闭
      outsideHandler = (e) => {
        if (menuEl && !menuEl.contains(e.target) && e.target !== anchorBtn) closeMenu();
      };
      setTimeout(() => document.addEventListener("click", outsideHandler, true), 0);
    });
  }

  // ============== 拼 prompt + 插输入框 ==============
  function applyHat(binding, targetId, kind) {
    const Store = window.ArenaTemplateStore;
    if (!Store) { closeMenu(); return; }
    const tpl = Store.resolveTemplate(binding);
    if (!tpl) { closeMenu(); return; }
    const duty = Store.resolve(binding, "duty");
    const format = Store.resolve(binding, "format");
    const hatName = tpl.name;

    if (kind === "single") {
      // v4.6.1 P1 fix: 直接用 service id 作 mention（如 @claude），popup.js parseMentions 的
      // nameToId 同时映射 id 和 lowercase 中文名，用 id 最稳定（避免中文名异常）。
      // closeMenu 移到这里同步关，避免用户感知延迟。
      doInsert(`@${targetId} `, hatName, duty, format);
      closeMenu();
    } else {
      doInsert("", hatName, duty, format);
      closeMenu();
    }
  }

  function doInsert(aiPrefix, hatName, duty, format) {
    const text = `${aiPrefix}戴上「${hatName}」帽子：${duty}\n输出格式：${format}\n\n`;
    insertToInput(text);
  }

  function insertToInput(text) {
    const box = document.getElementById("chat-input");
    if (!box) return;
    const cur = box.textContent || "";
    box.textContent = cur ? cur + text : text;
    box.classList.add("tpl-input-flash");
    setTimeout(() => box.classList.remove("tpl-input-flash"), 600);
    box.focus();
    try {
      const range = document.createRange();
      range.selectNodeContents(box);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {}
    box.dispatchEvent(new Event("input", { bubbles: true }));
    // toast
    const t = document.getElementById("tpl-toast");
    if (t) {
      t.textContent = "已戴上角色帽";
      t.classList.add("tpl-toast-show");
      clearTimeout(t._hatTimer);
      t._hatTimer = setTimeout(() => t.classList.remove("tpl-toast-show"), 1800);
    }
  }

  // ============== Members Tab 渲染入口 ==============
  function renderHatsBar() {
    const panel = document.getElementById("rp-panel-members");
    if (!panel) return;
    // v4.6.1 P0 fix: 查询和创建用同一个 className（.rp-hat-section），否则永远找不到旧容器，
    // 每次 render 会重复 insertBefore 新 div，导致 panel 内 .rp-hat-section 累积。
    let bar = panel.querySelector(".rp-hat-section");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "rp-hat-section";
      // 在「模型实力榜」之前插入
      const lbTitle = panel.querySelector(".rp-lb-title");
      if (lbTitle) panel.insertBefore(bar, lbTitle);
      else panel.appendChild(bar);
    }
    const Store = window.ArenaTemplateStore;
    const hats = ROLE_BINDINGS
      .map(b => Store?.resolveTemplate(b))
      .filter(Boolean);
    bar.innerHTML = `
      <div class="rp-section-title">角色帽<span class="rp-hat-hint">点击 → 选 AI → 拼 prompt 入输入框</span></div>
      <div class="rp-hat-bar">
        ${hats.map(h => `
          <button class="rp-hat-btn" data-binding="${escapeHtml(h.binding)}" title="${escapeHtml(h.fields[0]?.value || "")}">
            <span class="rp-hat-em">${escapeHtml(h.emoji)}</span>
            <span class="rp-hat-label">${escapeHtml(h.name)}</span>
          </button>
        `).join("")}
      </div>
    `;
    bar.querySelectorAll(".rp-hat-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openAiPickerMenu(btn, btn.dataset.binding);
      });
    });
  }

  // 监听 rp 激活 / 成员变化 / Store 变化时重渲染
  document.addEventListener("rp:activated", (e) => {
    if (e.detail?.tab === "members") {
      // Member render 是异步，等一帧
      setTimeout(renderHatsBar, 0);
    }
  });

  // 兜底：每隔 800ms 检查是否需要插入（处理 popup-members.js 重 render 后 hat bar 被清掉的情况）
  // 简单方案：监听 panel 的 DOM 变化
  function watchMembersPanel() {
    const panel = document.getElementById("rp-panel-members");
    if (!panel) { setTimeout(watchMembersPanel, 300); return; }
    const obs = new MutationObserver(() => {
      if (!panel.querySelector(".rp-hat-section")) {
        renderHatsBar();
      }
    });
    obs.observe(panel, { childList: true });
    // 首次也跑一次
    renderHatsBar();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watchMembersPanel);
  } else {
    watchMembersPanel();
  }

  window.ArenaRoleHats = { renderHatsBar, ROLE_BINDINGS };
})();
