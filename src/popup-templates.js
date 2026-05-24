// popup-templates.js — 📋 模板 Tab：内置任务模板 + 用户自定义模板
// 依赖：window.ArenaBuiltinTemplates / window.ArenaTemplateStore（template-store.js 已 init）

(function () {
  const Store = window.ArenaTemplateStore;
  if (!Store) {
    console.warn("[Templates] ArenaTemplateStore not available");
    return;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  let editorCtx = null;

  // ============== 渲染 ==============
  function render() {
    const root = document.getElementById("rp-panel-templates");
    if (!root) return;

    // v4.5.2 / v4.6.0: 内置模板按 category 拆 3 区
    //   - 任务模板（辩论/总结/PPT，绑定到任务按钮，单击展开预览）
    //   - 场景预设（场景，clickAction="insert"，单击插入输入框）
    //   - 角色帽（角色帽，主入口在成员栏；模板库这里仅供编辑/重置）
    const allBuiltins = Store.listBuiltinTemplates();
    const taskBuiltins = allBuiltins.filter(t => t.category !== "场景" && t.category !== "角色帽");
    const scenarioBuiltins = allBuiltins.filter(t => t.category === "场景");
    const roleBuiltins = allBuiltins.filter(t => t.category === "角色帽");
    const users = Store.listUserTemplates().slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    root.innerHTML = `
      <div class="rp-section-title">
        <span>任务模板</span>
        <span class="tpl-count" id="tpl-builtin-count">${taskBuiltins.length}</span>
      </div>
      <div class="tpl-list" id="tpl-builtin-list">
        ${taskBuiltins.map(renderBuiltinItem).join("")}
      </div>

      <div class="rp-section-title" style="margin-top:14px">
        <span>场景预设</span>
        <span class="tpl-count" id="tpl-scenario-count">${scenarioBuiltins.length}</span>
      </div>
      <div class="tpl-list" id="tpl-scenario-list">
        ${scenarioBuiltins.map(renderBuiltinItem).join("")}
      </div>

      <div class="rp-section-title" style="margin-top:14px">
        <span>角色帽</span>
        <span class="tpl-count" id="tpl-role-count">${roleBuiltins.length}</span>
        <span class="tpl-spacer"></span>
        <span class="tpl-hint-text">使用入口：成员 Tab</span>
      </div>
      <div class="tpl-list" id="tpl-role-list">
        ${roleBuiltins.map(renderBuiltinItem).join("")}
      </div>

      <div class="rp-section-title" style="margin-top:14px">
        <span>我的模板</span>
        <span class="tpl-count" id="tpl-user-count">${users.length}</span>
        <span class="tpl-spacer"></span>
        <button class="tpl-mini-btn" id="tpl-btn-add" title="新建自定义模板">➕ 新建</button>
      </div>
      <div class="tpl-list" id="tpl-user-list">
        ${users.length === 0
          ? `<div class="tpl-empty">还没有自定义模板，点上方 ➕ 新建</div>`
          : users.map(renderUserItem).join("")}
      </div>

      <div class="tpl-action-row">
        <button class="tpl-action-btn tpl-action-danger" id="tpl-btn-reset-all">↻ 全部重置内置</button>
      </div>
    `;
    bind(root);
  }

  function renderBuiltinItem(tpl) {
    return `
      <div class="tpl-item" data-binding="${escapeHtml(tpl.binding)}">
        <div class="tpl-row ${tpl.anyModified ? "tpl-modified" : ""}">
          <span class="tpl-em">${tpl.emoji}</span>
          <span class="tpl-name">${escapeHtml(tpl.name)}</span>
          <span class="tpl-dot" title="已编辑"></span>
          <span class="tpl-actions">
            <button class="tpl-mini-btn" data-act="edit" title="编辑">✎</button>
            <button class="tpl-mini-btn" data-act="reset" title="重置为默认" ${tpl.anyModified ? "" : 'disabled style="opacity:0.3;cursor:default"'}>↻</button>
          </span>
        </div>
        <div class="tpl-preview"></div>
      </div>
    `;
  }

  function renderUserItem(t) {
    return `
      <div class="tpl-item" data-user-id="${escapeHtml(t.id)}">
        <div class="tpl-row">
          <span class="tpl-em">📝</span>
          <span class="tpl-name">${escapeHtml(t.name) || "(未命名)"}</span>
          <span class="tpl-actions">
            <button class="tpl-mini-btn" data-act="edit" title="编辑">✎</button>
            <button class="tpl-mini-btn" data-act="delete" title="删除">🗑</button>
          </span>
        </div>
      </div>
    `;
  }

  // ============== 绑定事件 ==============
  function bind(root) {
    // 内置任务模板：单击行 = 展开预览；按钮 = edit/reset
    root.querySelector("#tpl-builtin-list").addEventListener("click", (e) => {
      handleBuiltinClick(e, "preview");
    });

    // v4.5.2: 场景预设：单击行 = 插入输入框；按钮 = edit/reset
    root.querySelector("#tpl-scenario-list").addEventListener("click", (e) => {
      handleBuiltinClick(e, "insert");
    });

    // v4.6.0: 角色帽：单击行 = 展开预览（编辑入口在这里；触发入口在成员 Tab）
    root.querySelector("#tpl-role-list").addEventListener("click", (e) => {
      handleBuiltinClick(e, "preview");
    });

    // 用户模板：单击行 = 插入输入框；按钮 = edit/delete
    root.querySelector("#tpl-user-list").addEventListener("click", (e) => {
      const item = e.target.closest(".tpl-item");
      if (!item) return;
      const id = item.dataset.userId;
      const tpl = Store.getUserTemplate(id);
      if (!tpl) return;
      const actBtn = e.target.closest("[data-act]");
      if (actBtn) {
        e.stopPropagation();
        const act = actBtn.dataset.act;
        if (act === "edit") openEditor({ kind: "user", id });
        else if (act === "delete") onDeleteUser(id);
        return;
      }
      insertToInput(tpl.body);
    });

    root.querySelector("#tpl-btn-add").addEventListener("click", () => openEditor({ kind: "user" }));
    root.querySelector("#tpl-btn-reset-all").addEventListener("click", onResetAll);
  }

  // 内置模板单击通用 handler
  // defaultAction: "preview" = 展开预览（任务模板）；"insert" = 插入输入框（场景预设）
  function handleBuiltinClick(e, defaultAction) {
    const item = e.target.closest(".tpl-item");
    if (!item) return;
    const binding = item.dataset.binding;
    const actBtn = e.target.closest("[data-act]");
    if (actBtn) {
      e.stopPropagation();
      const act = actBtn.dataset.act;
      if (act === "edit") openEditor({ kind: "builtin", binding });
      else if (act === "reset") onResetBuiltin(binding);
      return;
    }
    if (defaultAction === "insert") {
      // 场景预设单击行 → 插入输入框（取第一个字段的当前值，含 override）
      const tpl = Store.resolveTemplate(binding);
      if (!tpl || !tpl.fields.length) return;
      insertToInput(tpl.fields[0].value);
    } else {
      togglePreview(item, binding);
    }
  }

  function togglePreview(item, binding) {
    const wasOpen = item.classList.contains("tpl-expanded");
    // v4.6.1 P1 fix: 收起涵盖任务模板 + 角色帽两区（场景预设单击 = insert 不展开，不需要收起）
    document.querySelectorAll("#tpl-builtin-list .tpl-item, #tpl-role-list .tpl-item").forEach(x => x.classList.remove("tpl-expanded"));
    if (wasOpen) return;
    item.classList.add("tpl-expanded");
    const tpl = Store.resolveTemplate(binding);
    if (!tpl) return;
    const preview = item.querySelector(".tpl-preview");
    preview.innerHTML = tpl.fields.map(f => `
      <div class="tpl-pf">
        <div class="tpl-pf-label">${escapeHtml(f.label)}${f.modified ? ' <span class="tpl-pf-mod">●已编辑</span>' : ""}</div>
        <div class="tpl-pf-body">${escapeHtml(f.value)}</div>
      </div>
    `).join("");
  }

  async function onResetBuiltin(binding) {
    const tpl = Store.resolveTemplate(binding);
    if (!tpl || !tpl.anyModified) return;
    if (!confirm(`确认把"${tpl.name}"重置为默认？`)) return;
    await Store.resetOverride(binding);
    toast("已重置");
    // notify 监听会自动 render
  }

  async function onDeleteUser(id) {
    const t = Store.getUserTemplate(id);
    if (!t) return;
    if (!confirm(`删除"${t.name || "(未命名)"}"？`)) return;
    await Store.deleteUserTemplate(id);
    toast("已删除");
  }

  async function onResetAll() {
    if (!confirm("将所有内置模板的编辑全部丢弃（自定义模板不动）？")) return;
    await Store.resetAllOverrides();
    toast("全部内置模板已重置");
  }

  // ============== 编辑器 ==============
  function openEditor(ctx) {
    editorCtx = ctx;
    const mask = document.getElementById("tpl-modal-mask");
    const body = document.getElementById("tpl-modal-body");
    const footer = document.getElementById("tpl-modal-footer");
    const titleEl = document.getElementById("tpl-modal-title");
    const emojiEl = document.getElementById("tpl-modal-emoji");
    const badgeEl = document.getElementById("tpl-modal-badge");

    if (ctx.kind === "builtin") {
      const tpl = Store.resolveTemplate(ctx.binding);
      if (!tpl) return;
      emojiEl.textContent = tpl.emoji;
      titleEl.textContent = `编辑：${tpl.name}`;
      badgeEl.textContent = tpl.anyModified ? "已编辑" : "内置";
      badgeEl.className = "tpl-modal-badge " + (tpl.anyModified ? "tpl-badge-modified" : "tpl-badge-builtin");

      if (tpl.fields.length === 1) {
        const f = tpl.fields[0];
        body.innerHTML = `
          <div class="tpl-field-row">
            <label>${escapeHtml(f.label)}</label>
            <textarea data-field-key="${escapeHtml(f.key)}">${escapeHtml(f.value)}</textarea>
            <div class="tpl-help">改完点保存，下次该任务会用新版 prompt</div>
          </div>
        `;
      } else {
        body.innerHTML = `
          <div class="tpl-field-tabs">
            ${tpl.fields.map((f, i) => `
              <button class="tpl-field-tab ${i === 0 ? "tpl-active" : ""}" data-field-idx="${i}">
                ${escapeHtml(f.label)}${f.modified ? '<span class="tpl-tab-dot"></span>' : ""}
              </button>
            `).join("")}
          </div>
          <div id="tpl-field-panels">
            ${tpl.fields.map((f, i) => `
              <div class="tpl-field-row" data-field-panel="${i}" style="${i === 0 ? "" : "display:none"}">
                <label>${escapeHtml(f.label)}</label>
                <textarea data-field-key="${escapeHtml(f.key)}">${escapeHtml(f.value)}</textarea>
              </div>
            `).join("")}
          </div>
        `;
        body.querySelectorAll(".tpl-field-tab").forEach((tab, i) => {
          tab.addEventListener("click", () => {
            body.querySelectorAll(".tpl-field-tab").forEach(x => x.classList.remove("tpl-active"));
            tab.classList.add("tpl-active");
            body.querySelectorAll("[data-field-panel]").forEach(p => p.style.display = "none");
            body.querySelector(`[data-field-panel="${i}"]`).style.display = "";
          });
        });
      }

      footer.innerHTML = `
        <button class="tpl-modal-btn tpl-modal-danger" id="tpl-editor-reset" ${tpl.anyModified ? "" : 'style="display:none"'}>↻ 重置为默认</button>
        <span class="tpl-spacer"></span>
        <button class="tpl-modal-btn" id="tpl-editor-cancel">取消</button>
        <button class="tpl-modal-btn tpl-modal-primary" id="tpl-editor-save">保存</button>
      `;
      document.getElementById("tpl-editor-reset")?.addEventListener("click", async () => {
        if (!confirm(`确认重置"${tpl.name}"？`)) return;
        await Store.resetOverride(ctx.binding);
        closeEditor();
        toast("已重置");
      });
    } else {
      const tpl = ctx.id ? Store.getUserTemplate(ctx.id) : null;
      emojiEl.textContent = "📝";
      titleEl.textContent = tpl ? "编辑自定义模板" : "新建自定义模板";
      badgeEl.textContent = "自定义";
      badgeEl.className = "tpl-modal-badge";
      body.innerHTML = `
        <div class="tpl-field-row">
          <label>名字</label>
          <input id="tpl-u-name" type="text" value="${escapeHtml(tpl?.name || "")}" placeholder="如：5G 优化方向评估">
        </div>
        <div class="tpl-field-row">
          <label>正文</label>
          <textarea id="tpl-u-body" placeholder="如：请站在华为 5G 产品规划的角度，对比下面 N 个候选优化方向（按 [业务价值] / [技术复杂度] / [落地风险] 三维度评分），用表格输出，最后给一句话推荐。&#10;&#10;候选方向：&#10;1. ...&#10;2. ...">${escapeHtml(tpl?.body || "")}</textarea>
        </div>
      `;
      footer.innerHTML = `
        ${tpl ? '<button class="tpl-modal-btn tpl-modal-danger" id="tpl-editor-delete">删除</button>' : ""}
        <span class="tpl-spacer"></span>
        <button class="tpl-modal-btn" id="tpl-editor-cancel">取消</button>
        <button class="tpl-modal-btn tpl-modal-primary" id="tpl-editor-save">${tpl ? "保存" : "创建"}</button>
      `;
      document.getElementById("tpl-editor-delete")?.addEventListener("click", async () => {
        if (!confirm(`删除"${tpl.name || "(未命名)"}"？`)) return;
        await Store.deleteUserTemplate(ctx.id);
        closeEditor();
        toast("已删除");
      });
    }

    document.getElementById("tpl-editor-cancel").addEventListener("click", closeEditor);
    document.getElementById("tpl-editor-save").addEventListener("click", saveEditor);
    mask.hidden = false;
  }

  function closeEditor() {
    const mask = document.getElementById("tpl-modal-mask");
    if (mask) mask.hidden = true;
    editorCtx = null;
  }

  async function saveEditor() {
    if (!editorCtx) return;
    if (editorCtx.kind === "builtin") {
      const binding = editorCtx.binding;
      const builtin = window.ArenaBuiltinTemplates[binding];
      // v4.5.1 P0 fix: 批量一次写，避免并发 Promise.all 触发多次 storage.set + N 次重渲染
      const patches = {};
      document.querySelectorAll("#tpl-modal-body textarea[data-field-key]").forEach(ta => {
        const key = ta.dataset.fieldKey;
        const orig = builtin.fields.find(f => f.key === key)?.value;
        const val = ta.value;
        // val === orig 视为重置（null 在 batch API 里表示删 override）
        patches[key] = (val === orig) ? null : val;
      });
      await Store.applyOverridesBatch(binding, patches);
    } else {
      const name = document.getElementById("tpl-u-name").value.trim();
      const body = document.getElementById("tpl-u-body").value.trim();
      if (!name && !body) { toast("名字和正文都为空，已忽略"); closeEditor(); return; }
      if (editorCtx.id) {
        await Store.updateUserTemplate(editorCtx.id, { name, body });
      } else {
        await Store.addUserTemplate({ name, body });
      }
    }
    closeEditor();
    toast("已保存");
  }

  // 点击 mask 关闭
  document.getElementById("tpl-modal-mask")?.addEventListener("click", (e) => {
    if (e.target.id === "tpl-modal-mask") closeEditor();
  });

  // ============== 插入到输入框 ==============
  function insertToInput(text) {
    const box = document.getElementById("chat-input");
    if (!box) return;
    const cur = box.textContent || "";
    box.textContent = cur ? cur + "\n" + text : text;
    box.classList.add("tpl-input-flash");
    setTimeout(() => box.classList.remove("tpl-input-flash"), 600);
    // 光标到末尾
    box.focus();
    try {
      const range = document.createRange();
      range.selectNodeContents(box);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {}
    // 触发 input 事件，让 popup.js / popup-task-menu 监听到
    box.dispatchEvent(new Event("input", { bubbles: true }));
    toast("已插入输入框");
  }

  // ============== Toast ==============
  let toastTimer = null;
  function toast(msg) {
    const t = document.getElementById("tpl-toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("tpl-toast-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("tpl-toast-show"), 1800);
  }

  // ============== 触发渲染 ==============
  // a) 切到 templates Tab 时
  document.addEventListener("rp:activated", (e) => {
    if (e.detail?.tab === "templates") render();
  });
  // b) 启动时如果已经在 templates Tab，确保渲染
  function ensureInitialRender() {
    const panel = document.getElementById("rp-panel-templates");
    if (!panel) return;
    if (panel.classList.contains("active") || !panel.innerHTML.trim()) render();
  }
  // c) Store 变化时（其他端 / 编辑后）重新渲染
  Store.subscribe(() => {
    const panel = document.getElementById("rp-panel-templates");
    if (panel && panel.classList.contains("active")) render();
  });

  // 等 Store init 完成再渲染（init 是异步）
  if (Store.isReady()) {
    ensureInitialRender();
  } else {
    Store.init().then(ensureInitialRender);
  }

  // 暴露给 E2E / 调试
  window.ArenaTemplatesUI = { render, openEditor, closeEditor };
})();
