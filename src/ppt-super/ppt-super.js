// ppt-super.js — PPT-SUPER：AI圆桌派主界面内的弹窗式一键 PPT 工作流
// 流程：选版式 → 拼 prompt 发给已打开的 AI 标签页 → 自动抓回 JSON（手动粘贴兜底）
//      → 表单编辑 + 活预览（空背景图 + 字段坐标浮层）→ 浏览器内 JSZip 生成 pptx 下载
// 纯前端，零本地依赖。挂 window.PptSuper。
(function () {
  "use strict";
  if (window.__pptSuperLoaded) return;
  window.__pptSuperLoaded = true;

  var TPL_URL = "ppt-super/templates.json";
  var S = {
    step: 1, topic: "", extra: "",
    templates: [], selected: [], service: "",
    participants: [], cands: [], active: 0, busy: false, loaded: false
  };

  // ---------- utils ----------
  function gurl(p) { return chrome.runtime.getURL(p); }
  function send(msg) {
    return new Promise(function (res) {
      try { chrome.runtime.sendMessage(msg, function (r) { res(r || {}); }); }
      catch (e) { res({ ok: false, error: String(e) }); }
    });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function el(html) { var d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstChild; }
  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  // ---------- JSON 提取（多 ```json 块 + 中文引号/尾逗号/截断修复）----------
  function repair(s) {
    return s.trim().replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
      .replace(/，(\s*[}\]])/g, "$1").replace(/,(\s*[}\]])/g, "$1");
  }
  function parseOne(raw) {
    var s = repair(raw);
    try { return JSON.parse(s); } catch (e) {}
    var a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a >= 0 && b > a) {
      var sub = s.slice(a, b + 1);
      try { return JSON.parse(sub); } catch (e) {}
      var op = (sub.match(/{/g) || []).length, cl = (sub.match(/}/g) || []).length;
      if (op > cl) { try { return JSON.parse(sub + "}".repeat(op - cl)); } catch (e) {} }
    }
    return null;
  }
  function extractBlocks(text) {
    var out = [], re = /```(?:json)?\s*([\s\S]*?)```/gi, m;
    while ((m = re.exec(text))) { var o = parseOne(m[1]); if (o) out.push(o); }
    if (!out.length) { var o = parseOne(text); if (o) out.push(o); }
    return out;
  }

  // ---------- prompt（按版式逐条生成，串行发送更稳健：避免一坨长回答漏块/串位/截断）----------
  // role → 槽位写作契约（PPT高手写稿法：每个槽在整页论证里"负责哪一刀"）。
  //   从模板已有的 role 字段动态派生语义契约，无需在 templates.json 里逐槽手写；
  //   若某 slot 显式带了 semantic_role/copy_recipe/... 字段则优先用它（前向兼容）。
  var ROLE_CONTRACT = {
    label:      { sr: "页面主题锚点", recipe: "提炼 topic 的核心术语/产品名做标签，名词短语", gate: "一眼定位本页主题，不写成句子", keep: "术语本身" },
    title:      { sr: "全页核心判断", recipe: "写「对象+动作+结果/数字」的观点句，给出判断而非堆名词", gate: "只读这一句也能 get 本页结论", keep: "判断动词与关键数字" },
    header:     { sr: "本模块定位·递进链一环", recipe: "一句能力定位，与相邻模块形成递进或对照，忌三个空词并列", gate: "能看出它与相邻模块的关系", keep: "定位词" },
    para:       { sr: "讲清机制链与证据", recipe: "给「动作+对象+约束+产出+量化」，连贯段落，忌空泛形容与宣传语", gate: "有机制、有数据、有边界", keep: "机制动作与数字" },
    body:       { sr: "讲清机制链与证据", recipe: "给「动作+对象+约束+产出+量化」，忌空泛形容与宣传语", gate: "有机制、有数据、有边界", keep: "机制动作与数字" },
    bullets:    { sr: "并列证据点", recipe: "每条一个独立要点，动词开头、尽量含数据，条目互不重复", gate: "条目之间无重复、可独立成立", keep: "动作与数字" },
    kpi:        { sr: "量化证据", recipe: "数字+单位（如 3.2倍 / 81% / 90秒），与正文呼应", gate: "数字可信、不编造，未提供则保守表述", keep: "数字与单位" },
    metric:     { sr: "量化证据", recipe: "数字+单位，与正文呼应", gate: "数字可信、不编造，未提供则保守表述", keep: "数字与单位" },
    caption:    { sr: "口径/说明小字", recipe: "补一句判断口径、来源或条件，不重复正文", gate: "不与正文重复", keep: "口径关键词" },
    conclusion: { sr: "收束贡献/局限/下一步", recipe: "给「所以…」或「下一步…」的指向性收束，忌泛泛总结", gate: "有明确指向", keep: "结论指向" },
    _glyph:     { sr: "编号/符号位", recipe: "按提示填写编号或符号（如 1 / 2），不写文案", gate: "符合位数或符号要求", keep: "原编号/符号" }
  };
  // 精炼 role：模板里不少槽把"小节标题/编号/来源"粗标成 label，按 zh/hint/容量纠偏，让派生契约对得上"负责哪一刀"
  function refineSlotRole(s) {
    var role = s.role || "body";
    var hi = (s.chars && s.chars[1]) || 99;
    var tx = String(s.zh || "") + " " + String(s.hint || "");
    if (hi <= 2) return "_glyph";                                          // 1-2 字：编号/符号位，不套写作契约
    if (/来源|出处|备注/.test(tx)) return "caption";                        // 数据来源等小字（须优先于 header，否则长来源串被 hi>=12 误判标题）
    if (role === "label" && (/标题/.test(tx) || hi >= 12)) return "header"; // 误标成 label 的小节/卡标题
    return role;
  }
  function buildPromptFor(tid, idx, total) {
    var t = tplById(tid);
    var L = [];
    L.push("你是顶级商务汇报 PPT 总编 + 文案专家，用「PPT高手写稿法」给这一页定稿：先把整页想透，再逐槽落字。");
    L.push("（风格：华为商务汇报风——数据密、口吻正式克制、杜绝空话套话；版式与配色已固定，你只写文字。）");
    if (total > 1) L.push("（本主题共 " + total + " 页，这是第 " + (idx + 1) + " 页；本条只输出这 1 页对应的 1 个 JSON 块；与其余页保持术语口径一致、互为支撑、不重复。）");
    L.push("");
    L.push("【主题】" + S.topic);
    if (S.extra.trim()) L.push("【素材/要点】" + S.extra);
    L.push("");
    L.push("【版式：" + t.name_cn + "】" + (t.when_to_use || ""));
    var isArrow = function (s) { return /箭头/.test(String(s.zh || "") + String(s.hint || "")); };  // 装饰箭头是固定符号，剔除不让 AI 填
    var textSlots = t.slots.filter(function (s) { return s.type !== "image" && s.type !== "icon" && !isArrow(s); });
    var imgSlots = t.slots.filter(function (s) { return s.type === "image" || s.type === "icon"; });

    // —— 第一步：先构思整页（story_spine）——
    L.push("");
    L.push("━━ 第一步：先构思整页，把规划写进 JSON 顶层的 \"_plan\" 字段 ━━");
    L.push("不要一上来逐字段填空。先以总编视角把这一页想透：");
    L.push("  · page_task：这一页要完成的汇报任务（一句话）");
    L.push("  · audience_takeaway：听众看完后应当相信/记住的一件事");
    L.push("  · thesis：本页核心判断（一句有对象有结论的观点句，全页都为它服务）");
    L.push("  · topic_anchor_terms：3-6 个来自【主题】的核心术语/机制名，必须贯穿全页正文（不许跑题成别的行业/公司）");
    L.push("  · story_spine：把全页串成一条论证主线（如「判断 → 机制/方法 → 三段证据 → 收束」），并说明每个模块承担哪一步");
    L.push("  · stage_mapping / kpi_plan / evidence_strategy：若本页含阶段/指标/证据，规划它们如何递进、用什么口径、数据从哪来（未提供的指标走保守表述，不编造）");
    L.push("  · slot_story_map：逐个列出下方每个槽位 key 在 story_spine 里「负责哪一刀」（一句话），确保槽与槽互相支撑、不是孤立填空");
    L.push("");

    // —— 第二步：按「角色契约 + 三档容量」逐槽落字 ——
    L.push("━━ 第二步：按每个槽位的「角色契约 + 容量预算」落字（每个槽遵守自己的写作任务，不是统一填空）━━");
    L.push("字段清单（key 必须与下方严格一致，value 为中文文案字符串）：");
    L.push("⚠ 槽位中文名与提示只标示该位在版面中的作用/位置；其中若出现具体行业专名/方案名/指标名（多为版式示例题材），一律视为占位示例，必须改写成当前【主题】的对应内容，严禁照抄进正文。");
    textSlots.forEach(function (s) {
      var rc = ROLE_CONTRACT[refineSlotRole(s)] || ROLE_CONTRACT.body;
      var sr = s.semantic_role || rc.sr;
      var recipe = s.copy_recipe || rc.recipe;
      var gate = s.quality_gate || rc.gate;
      var budget = "";
      if (s.chars) {
        var lo = s.chars[0], hi = s.chars[1];
        // 给 AI 宣称的上限留安全垫：AI 数中英混排字数会系统性低估，给它一个略小于真实上限的 cap；
        //   short 字段固定垫 2-3，长段落按 10% 垫。三档容量：最低密度(min)/目标(target,偏上促写满)/硬上限(cap)
        var margin = hi <= 6 ? 0 : (hi <= 18 ? 2 : (hi <= 40 ? 3 : Math.round(hi * 0.10)));
        var cap = Math.max(lo, hi - margin);
        var minc = lo;
        var target = Math.max(lo, Math.round(lo + (cap - lo) * 0.72));   // 瞄偏上、留余量到 cap：促"写满到合适密度"而非写太少留白
        budget = " 容量[最低 " + minc + " / 目标约 " + target + " / 硬上限 " + cap + " 字]";
      }
      // 清 hint 里和字数打架/诱导写满的旧措辞（自带字数、"按框容量写满"）
      var hint = (s.hint || "")
        .replace(/[,，、]?\s*\d+\s*[-~–到至]\s*\d+\s*字数?/g, "")
        .replace(/[,，、]?\s*\d+\s*字数?/g, "")
        .replace(/[,，、]?\s*\d+\s*[-~–到至]?\s*\d*\s*行/g, "")   // 清"5-7行/7-9行/2行"等行数暗示：与硬上限字数打架、诱导写超
        .replace(/[,，、]?\s*按[框容量]*写满/g, "")
        .replace(/\s{2,}/g, " ").replace(/\s*([,，；;])/g, "$1").replace(/^[\s,，;；]+|[\s,，;；]+$/g, "");
      L.push("  ▸ " + s.key + "（" + (s.zh || "") + "）" + budget);
      L.push("     角色:" + sr + "｜写法:" + recipe + "｜合格线:" + gate + (hint ? "｜提示:" + hint : ""));
    });
    L.push("");

    // —— 图片与文案一体化契约：同时规划配图 ——
    if (imgSlots.length) {
      L.push("━━ 图片与文案一体化契约：同时输出 JSON 顶层的 \"_image_briefs\" ━━");
      L.push("把图/图标当「视觉证据」而非装饰，与文案共用同一套故事线。为下列每个配图位输出一条 brief（以 key 为对象）：");
      L.push("  每条含 role_in_argument（这张图在论证链里的任务）、supports_slot（它支撑上面哪个文字槽 key）、visual_motif（贴合 thesis 的视觉意象，矢量/示意优先）、differs_from_siblings（与相邻图如何区分、避免雷同）。");
      imgSlots.forEach(function (s) {
        L.push("  ▸ " + s.key + "（" + (s.zh || s.key) + (s.type === "icon" ? " · 图标" : " · 配图") + "）");
      });
      L.push("  约束：所有视觉都服务于【主题】与 thesis，禁止无关科技背景、随机城市、人像摆拍、泛光效、文字水印、伪代码。");
      L.push("");
    }

    // —— 输出与字数硬约束 ——
    L.push("━━ 输出要求 ━━");
    L.push("1. 只输出一个 ```json 代码块，不要任何解释文字；JSON 顶层含 \"_plan\"" + (imgSlots.length ? "、\"_image_briefs\"" : "") + " 和上面全部文字槽 key；");
    L.push("2. 槽位 key 必须来自上面的清单：不得编造 key、不得把配图 brief 写进文字槽、不得遗漏任何文字槽（漏填会让该位残留模板样张占位文字）；");
    L.push("3. 字数是硬约束，逐字段遵守：以「目标约 N 字」为准把话写实写满（华为风忌留白，别明显短于「最低」值），空间够就补机制/对比/证据口径/边界，绝不靠形容词凑数；任何字段都不得超过「硬上限」，逼近上限时优先删修饰与重复、保住主题锚点与机制动作；");
    L.push("4. 中文按字符计：汉字/标点/英文字母/数字各算 1 个字（例：「推理效率提升2.5倍」=10 字）；写完逐字段默数，超限即删词重写；");
    L.push("5. 全页正文必须紧扣【主题】的 topic_anchor_terms，数据具体量化、口吻正式；未提供的指标用合理保守表述，绝不编造、绝不跑到与【主题】无关的行业或公司。");
    return L.join("\n");
  }
  function buildAllPrompts() {
    var n = S.selected.length;
    return S.selected.map(function (tid, i) {
      return (n > 1 ? "===== 指令 " + (i + 1) + "/" + n + "：" + tplById(tid).name_cn + " =====\n" : "") + buildPromptFor(tid, i, n);
    }).join("\n\n\n");
  }

  function tplById(id) { return S.templates.find(function (t) { return t.id === id; }); }

  // ---------- 数据加载 ----------
  async function ensureLoaded() {
    if (S.loaded) return;
    var r = await fetch(gurl(TPL_URL));
    var j = await r.json();
    S.templates = j.templates || [];
    S.loaded = true;
  }

  // ========== Modal ==========
  function openModal() {
    if (q("#ppts-overlay")) return;
    var ov = el('<div id="ppts-overlay" class="ppts-overlay"><div class="ppts-modal" role="dialog" aria-label="PPT-SUPER"></div></div>');
    document.body.appendChild(ov);
    ov.addEventListener("mousedown", function (e) { if (e.target === ov) closeModal(); });
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(function () { ov.classList.add("show"); });
    ensureLoaded().then(render).catch(function (e) {
      q(".ppts-modal").innerHTML = '<div class="ppts-err">模板加载失败：' + esc(e.message) + "</div>";
    });
  }
  function closeModal() {
    var ov = q("#ppts-overlay");
    if (!ov) return;
    // v5.0.43: 关闭 / ESC / 点遮罩 = 暂离，不再中止后台抓取 —— grab 继续在 popup 内存里跑，
    //   重新点开 PPT 时恢复进度或直接看结果。真正要停请用进度区的「■ 取消抓取」按钮。
    if (S.timer) { clearInterval(S.timer); S.timer = null; }   // 只清 UI 计时器（DOM 已移除）
    document.removeEventListener("keydown", onKey);
    ov.classList.remove("show");
    setTimeout(function () { ov.remove(); }, 180);
  }
  function onKey(e) { if (e.key === "Escape") closeModal(); }
  // 清空全部、回到第 1 步「新建一页」（保留模板缓存与已检测的 AI 标签页，无需重新加载）
  function resetAll() {
    if (S.topic || S.selected.length || S.cands.length) {
      if (!window.confirm("清空当前主题、已选版式和已生成文案，从头新建一页？")) return;
    }
    S.aborted = true; S.busy = false;
    if (S.timer) { clearInterval(S.timer); S.timer = null; }
    S.step = 1; S.topic = ""; S.extra = "";
    S.selected = []; S.cands = []; S.active = 0;
    render();
  }

  function go(step) { S.step = step; render(); }

  function status(msg, tone) {
    var s = q("#ppts-status");
    if (s) { s.textContent = msg || ""; s.className = "ppts-status" + (tone ? " " + tone : ""); }
  }

  // ---------- 渲染总入口 ----------
  function render() {
    var m = q(".ppts-modal");
    if (!m) return;
    m.innerHTML =
      '<div class="ppts-head">' +
        '<div class="ppts-title"><span class="ppts-dot"></span>PPT-SUPER<small>华为风一键生成</small></div>' +
        '<div class="ppts-steps">' +
          stepTab(1, "选版式") + stepTab(2, "取文案") + stepTab(3, "编辑·预览·下载") +
        '</div>' +
        '<button class="ppts-reset" title="清空全部，从头新建一页">↺ 新建</button>' +
        '<button class="ppts-x" title="关闭">✕</button>' +
      '</div>' +
      '<div class="ppts-body" id="ppts-body"></div>' +
      '<div class="ppts-foot"><div id="ppts-status" class="ppts-status"></div><div id="ppts-actions" class="ppts-actions"></div></div>';
    q(".ppts-x", m).onclick = function () { closeModal(); };
    var rb = q(".ppts-reset", m); if (rb) rb.onclick = resetAll;
    qa(".ppts-step", m).forEach(function (b) {
      b.onclick = function () { var n = +b.dataset.n; if (canGo(n)) { if (S.busy) { S.aborted = true; endBusy(); } go(n); } };
    });
    if (S.step === 1) renderStep1();
    else if (S.step === 2) renderStep2();
    else renderStep3();
  }
  function canGo(n) {
    if (n === 1) return true;
    if (n === 2) return S.selected.length > 0 && S.topic.trim();
    if (n === 3) return S.cands.length > 0;
    return false;
  }
  function stepTab(n, label) {
    return '<button class="ppts-step' + (S.step === n ? " on" : "") + (S.step > n ? " done" : "") +
      '" data-n="' + n + '"><i>' + n + "</i>" + label + "</button>";
  }

  // ---------- Step 1：主题 + 选版式 ----------
  function renderStep1() {
    var body = q("#ppts-body");
    body.innerHTML =
      '<div class="ppts-guide">📋 三步生成华为风 PPT：① 填主题挑版式 → ② 一键发 AI 取文案 → ③ 编辑预览下载。每套版式会单独出一版文案，最后挑满意的下。</div>' +
      '<label class="ppts-lab">汇报主题（一句话说清这页要讲什么）</label>' +
      '<input id="ppts-topic" class="ppts-inp" type="text" placeholder="例：新一代向量数据库在大模型检索场景下的性能优化进展（写清对象+场景+主题，越具体生成越准）" value="' + esc(S.topic) + '">' +
      '<label class="ppts-lab">素材 / 要点（可选，AI 优先采用）<button id="ppts-pull" class="ppts-mini">＋ 带入本场圆桌讨论结论</button></label>' +
      '<textarea id="ppts-extra" class="ppts-inp" rows="2" placeholder="例：训练效率提升3倍；已在3个数据中心部署；MFU 58%">' + esc(S.extra) + '</textarea>' +
      '<label class="ppts-lab">选版式（可多选，看图挑）<span class="ppts-count">已选 <b id="ppts-cn">' + S.selected.length + '</b> / ' + S.templates.length + '</span></label>' +
      '<div class="ppts-grid" id="ppts-grid"></div>';
    var grid = q("#ppts-grid");
    S.templates.forEach(function (t) {
      var sel = S.selected.indexOf(t.id) >= 0;
      var card = el('<div class="ppts-tpl' + (sel ? " sel" : "") + '" data-id="' + t.id + '">' +
        '<span class="ppts-chk">✓</span>' +
        '<img loading="lazy" src="' + gurl(t.thumb) + '" alt="">' +
        '<span class="ppts-tname">' + esc(t.name_cn) + "</span></div>");
      card.onclick = function () { toggleTpl(t.id, card); };
      grid.appendChild(card);
    });
    q("#ppts-topic").oninput = function () { S.topic = this.value; syncActions(); };
    q("#ppts-extra").oninput = function () { S.extra = this.value; };
    q("#ppts-pull").onclick = pullRoundtable;
    renderActions(
      '<button class="ppts-btn" id="ppts-next1">下一步：生成文案指令 →</button>'
    );
    q("#ppts-next1").onclick = function () { if (canGo(2)) go(2); else status("请先填主题并至少选 1 套版式", "warn"); };
    syncActions();
  }
  function toggleTpl(id, card) {
    var i = S.selected.indexOf(id);
    if (i >= 0) { S.selected.splice(i, 1); card.classList.remove("sel"); }
    else { S.selected.push(id); card.classList.add("sel"); }
    q("#ppts-cn").textContent = S.selected.length;
    syncActions();
  }
  function syncActions() {
    var b = q("#ppts-next1");
    if (b) b.disabled = !canGo(2);
  }
  async function pullRoundtable() {
    status("正在取本场圆桌发言…");
    var st = await send({ type: "getState" });
    var parts = (st && st.participants) || [];
    var txt = parts.filter(function (p) { return p.response && p.response.trim(); })
      .map(function (p) { return "【" + (p.name || p.service) + "】" + p.response.trim(); }).join("\n\n");
    if (txt) {
      S.extra = (S.extra ? S.extra + "\n\n" : "") + txt.slice(0, 4000);
      q("#ppts-extra").value = S.extra;
      status("已带入 " + parts.length + " 位 AI 的发言", "ok");
    } else { status("本场暂无可用的圆桌发言", "warn"); }
  }

  // ---------- Step 2：取文案 ----------
  function renderStep2() {
    var body = q("#ppts-body");
    var prompt = buildAllPrompts();
    var svcOpts = S.participants.map(function (p) {
      return '<option value="' + p.id + '">' + esc(p.name || p.service) + "</option>";
    }).join("");
    body.innerHTML =
      '<div class="ppts-guide">点「🚀 发送并自动抓取」后按版式<b>逐套</b>发送（选了 ' + S.selected.length + ' 套就逐次发 ' + S.selected.length + ' 次，每次只问一套、抓回一个 JSON 再问下一套），比一次性长回答更稳、不易漏块串位。也可「⧉ 复制指令」手动逐条发，把回答粘到下方兜底。</div>' +
      '<div class="ppts-row">' +
        '<label class="ppts-lab" style="margin:0">发往：</label>' +
        '<select id="ppts-svc" class="ppts-sel">' + (svcOpts || '<option value="">（未检测到已打开的 AI 标签页）</option>') + '</select>' +
        '<button class="ppts-mini" id="ppts-refresh">↻ 刷新</button>' +
        '<button class="ppts-mini" id="ppts-copy">⧉ 复制指令</button>' +
      '</div>' +
      '<label class="ppts-lab">逐套指令预览（共 ' + S.selected.length + ' 套 · 自动抓取会按版式逐条发送）</label>' +
      '<textarea id="ppts-prompt" class="ppts-inp ppts-mono" rows="7">' + esc(prompt) + '</textarea>' +
      '<details class="ppts-fold"><summary>抓取失败？手动把 AI 回答粘到这里 →</summary>' +
        '<textarea id="ppts-paste" class="ppts-inp ppts-mono" rows="4" placeholder="把含 ```json 代码块的 AI 回答整段粘贴进来，点下方「解析粘贴内容」"></textarea>' +
        '<button class="ppts-mini" id="ppts-parsepaste">解析粘贴内容 →</button>' +
      '</details>';
    q("#ppts-refresh").onclick = loadParticipants;
    q("#ppts-copy").onclick = function () {
      navigator.clipboard.writeText(q("#ppts-prompt").value); status("指令已复制", "ok");
    };
    q("#ppts-parsepaste").onclick = function () { if (S.busy) { S.aborted = true; endBusy(); } ingest(q("#ppts-paste").value, "粘贴内容"); };
    renderActions(
      '<button class="ppts-btn ghost" id="ppts-back2">← 上一步</button>' +
      '<button class="ppts-btn" id="ppts-grab">🚀 发送并自动抓取</button>'
    );
    q("#ppts-back2").onclick = function () { go(1); };
    q("#ppts-grab").onclick = grab;
    if (!S.participants.length) loadParticipants();
    // v5.0.43: 抓取在后台进行中（用户曾暂离又点回来）→ 恢复进度面板 + 计时 + 取消按钮
    if (S.busy) {
      setBusyUI(true);
      showProgress(S.progMeta || "抓取进行中…");
      setProgress(S.progStage || "抓取中…", S.progPct || 5, S.progMeta || "");
      if (S.t0) startTimer(S.t0);
    }
  }
  async function loadParticipants() {
    var st = await send({ type: "getState" });
    S.participants = ((st && st.participants) || []).filter(function (p) { return p.service; });
    var sel = q("#ppts-svc");
    if (sel) {
      sel.innerHTML = S.participants.length
        ? S.participants.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name || p.service) + "</option>"; }).join("")
        : '<option value="">（未检测到已打开的 AI 标签页，请先在圆桌添加）</option>';
    }
    status(S.participants.length ? ("检测到 " + S.participants.length + " 个 AI 标签页") : "未检测到 AI 标签页", S.participants.length ? "" : "warn");
  }
  async function grab() {
    var pid = q("#ppts-svc").value;
    if (!pid) { status("请先在圆桌打开一个 AI 标签页，点 ↻ 刷新", "warn"); return; }
    var svc = (S.participants.find(function (p) { return p.id === pid; }) || {}).service;
    var ids = S.selected.slice();
    var total = ids.length || 1;
    S.busy = true; S.aborted = false; setBusyUI(true);
    S.t0 = Date.now();
    showProgress("准备按版式逐套发送，共 " + total + " 套…"); startTimer(S.t0);
    var results = [];
    for (var k = 0; k < total && !S.aborted; k++) {
      var tid = ids[k], t = tplById(tid), tname = (t && t.name_cn) || ("版式" + (k + 1));
      var base = Math.round(k / total * 100);
      if (k > 0) await sleep(1200);                                    // 给上一套流式收尾，避免输入框未就绪
      if (S.aborted) return;
      setProgress("第 " + (k + 1) + "/" + total + " 套 · " + tname, base + 2, "正在发送指令…");
      var sr = await send({ type: "sendPromptToService", participantId: pid, service: svc, text: buildPromptFor(tid, k, total) });
      if (S.aborted) return;
      if (!sr || sr.ok === false) {
        results.push({ tid: tid, data: null });
        setProgress("第 " + (k + 1) + "/" + total + " 套 · " + tname, base + 2, "⚠ 发送失败，跳过该套（" + (sr && sr.error || "标签页未就绪") + "）");
        continue;
      }
      // 本套需 AI 填的文字槽 key（与 buildPromptFor 的 textSlots 同口径：剔除 image/icon/装饰箭头）
      var textKeys = t.slots.filter(function (s) {
        return s.type !== "image" && s.type !== "icon" && !/箭头/.test((s.zh || "") + (s.hint || ""));
      }).map(function (s) { return s.key; });
      // 字段覆盖率：提取到的 JSON 命中了多少文字槽。半截 JSON（如只出了 _plan、slot 没写）覆盖率低 → 不算完成
      var coverage = function (b) {
        if (!b || typeof b !== "object" || !textKeys.length) return 0;
        var hit = textKeys.filter(function (key) { var v = b[key]; return v != null && String(v).trim() !== ""; }).length;
        return hit / textKeys.length;
      };
      var block = null, last = "", stable = 0, jsonStable = 0, noData = 0, bestBlock = null, bestCov = 0;
      for (var i = 0; i < 90 && !S.aborted; i++) {                      // 上限 ~180s，覆盖 ChatGPT「先答一句→长思考→真答案」
        await sleep(2000);
        if (S.aborted) return;
        var rr = await send({ type: "readOneResponse", participantId: pid });
        if (rr && rr.ok && rr.text) {
          noData = 0;
          var blocks = extractBlocks(rr.text);
          var streaming = !!rr.isStreaming;
          var changed = rr.text !== last; if (changed) last = rr.text;
          var cand = blocks.length ? blocks[blocks.length - 1] : null;
          var cov = cand ? coverage(cand) : 0;
          if (cand && cov >= bestCov) { bestBlock = cand; bestCov = cov; }       // 记录见过最完整的 JSON
          var within = base + Math.min(i / 28, 0.85) * (100 / total);
          setProgress("第 " + (k + 1) + "/" + total + " 套 · " + tname, within,
            "已收到 " + rr.text.length + " 字" + (cand ? "，JSON 字段 " + Math.round(cov * 100) + "%" : "") +
            (streaming ? "（AI 生成中…）" : (cand ? (cov < 0.8 ? "（JSON 未完，继续等…）" : "，已完整 ✓") : "（已停笔，等 JSON…）")));
          // 核心修复（防字段全 0 跳第三步）：必须「JSON 字段覆盖 ≥80%」才算本套完成。
          //   ① AI 生成中(streaming=true)绝不退出；② 半截 JSON / isStreaming 误判 false 时覆盖率不足 → 继续等 slot 写完。
          if (cand && cov >= 0.8) {
            if (!streaming) { block = cand; break; }                              // 完整 + 已停笔 → 完成
            if (!changed) { jsonStable++; if (jsonStable >= 3) { block = cand; break; } } else { jsonStable = 0; }
          } else if (!streaming && !changed) {
            // 已停笔且文本不再变，但覆盖不足 80%（或没 JSON）：多等几轮确认 AI 确实写完 → 用最完整的兜底，太残缺则放弃该套
            stable++; if (stable >= 6) { block = bestCov >= 0.5 ? bestBlock : null; break; }
          } else {
            stable = 0;                                                           // 仍在生成 / 文本还在变 → 继续等，不退出
          }
        } else {
          noData++;
          if (noData === 8) setProgress("第 " + (k + 1) + "/" + total + " 套 · " + tname, base + 3,
            "等待 AI 开始输出（约 " + (i * 2) + "s）· 可点「取消」改手动粘贴");
          if (noData >= 25) break;                                       // ~50s 完全读不到回答 → 放弃这套
        }
      }
      if (!block && bestCov >= 0.5) block = bestBlock;                            // 超时兜底：用见过最完整的(≥50%)进编辑页手动补，强于丢空
      results.push({ tid: tid, data: block });
    }
    if (S.aborted) return;
    endBusy();
    var okN = results.filter(function (r) { return r.data; }).length;
    if (!okN) { status("未抓到任何有效 JSON，请展开下方「手动粘贴」兜底，或重试", "warn"); return; }
    S.cands = results.map(function (r) { return { tid: r.tid, data: r.data || {} }; });
    S.active = 0;
    status("逐套抓取完成：成功 " + okN + "/" + total + " 套" + (okN < total ? "（失败的套可在编辑页手动补字或回上一步重试）" : "") + "，进入编辑", okN === total ? "ok" : "warn");
    go(3);
  }
  function endBusy() { S.busy = false; if (S.timer) { clearInterval(S.timer); S.timer = null; } hideProgress(); setBusyUI(false); }
  function cancelGrab() { S.aborted = true; endBusy(); status("已取消，可重新发送或展开下方手动粘贴", ""); }
  function setBusyUI(b) {
    qa(".ppts-step").forEach(function (x) { x.disabled = false; });   // 步骤永远可点（切步=逃生通道）
    var g = q("#ppts-grab");
    if (g) { g.disabled = false; g.textContent = b ? "■ 取消抓取" : "🚀 发送并自动抓取"; g.onclick = b ? cancelGrab : grab; }
  }
  // ---------- 抓取进度可视化（防误判卡死：计时器+进度条+阶段+动画）----------
  function showProgress(initMsg) {
    var body = q("#ppts-body"); if (!body) return;
    if (!q("#ppts-prog")) {
      var p = el('<div id="ppts-prog" class="ppts-prog">' +
        '<div class="ppts-prog-top"><span class="ppts-spin"></span>' +
        '<b id="ppts-prog-stage">发送中…</b><span id="ppts-prog-time" class="ppts-prog-time">0s</span></div>' +
        '<div class="ppts-prog-bar"><div id="ppts-prog-fill" class="ppts-prog-fill"></div></div>' +
        '<div id="ppts-prog-meta" class="ppts-prog-meta"></div>' +
        '<div class="ppts-prog-hint">⏳ AI 生成通常 20–90 秒，进度实时更新中；可随时「取消」或关闭返回，不丢已填内容</div></div>');
      body.insertBefore(p, body.firstChild);
    }
    if (q("#ppts-prog-meta")) q("#ppts-prog-meta").textContent = initMsg || "";
  }
  function setProgress(stage, pct, meta) {
    S.progStage = stage; S.progPct = pct; if (meta != null) S.progMeta = meta;   // v5.0.43: 存进度，供暂离后重开恢复
    var s = q("#ppts-prog-stage"), f = q("#ppts-prog-fill"), m = q("#ppts-prog-meta");
    if (s) s.textContent = stage;
    if (f) f.style.width = Math.max(3, Math.min(99, pct)) + "%";
    if (m && meta != null) m.textContent = meta;
  }
  function hideProgress() { var p = q("#ppts-prog"); if (p) p.remove(); }
  function startTimer(t0) {
    if (S.timer) clearInterval(S.timer);
    S.timer = setInterval(function () {
      var t = q("#ppts-prog-time");
      if (t) t.textContent = Math.round((Date.now() - t0) / 1000) + "s";
      else { clearInterval(S.timer); S.timer = null; }
    }, 1000);
  }
  function ingest(text, srcLabel) {
    var blocks = extractBlocks(text);
    if (!blocks.length) { status("未能从" + srcLabel + "解析出 JSON，请检查内容或重试", "warn"); return; }
    S.cands = S.selected.map(function (tid, i) {
      return { tid: tid, data: blocks[i] || blocks[blocks.length - 1] || {} };
    });
    S.active = 0;
    status("已解析 " + blocks.length + " 套文案，进入编辑", "ok");
    go(3);
  }

  // ---------- Step 3：编辑 + 活预览 + 下载 ----------
  function renderStep3() {
    var body = q("#ppts-body");
    var tabs = S.cands.map(function (c, i) {
      var t = tplById(c.tid);
      return '<button class="ppts-ctab' + (i === S.active ? " on" : "") + '" data-i="' + i + '">候选' + (i + 1) + '·' + esc(t.name_cn) + "</button>";
    }).join("");
    body.innerHTML =
      '<div class="ppts-ctabs">' + tabs + '</div>' +
      '<div class="ppts-split"><div class="ppts-editor" id="ppts-editor"></div>' +
      '<div class="ppts-pv"><div class="ppts-canvas" id="ppts-canvas"></div>' +
      '<div class="ppts-pvnote">⚠ 预览为浏览器近似渲染，字体/对齐与真实效果有<b>一定偏差</b>；请<b>下载 PPTX 打开查看准确版本效果</b>。左侧改字即时更新。</div></div></div>';
    qa(".ppts-ctab").forEach(function (b) { b.onclick = function () { S.active = +b.dataset.i; renderStep3(); }; });
    renderEditor();
    renderPreview();
    renderActions(
      '<button class="ppts-btn ghost" id="ppts-back3">← 重新取文案</button>' +
      '<button class="ppts-btn sec" id="ppts-dl">⬇ 仅下载</button>' +
      '<button class="ppts-btn" id="ppts-dlopen">⬇⤴ 下载并打开</button>' +
      (S.cands.length > 1 ? '<button class="ppts-btn sec" id="ppts-dlall">下载全部 ' + S.cands.length + ' 套</button>' : "")
    );
    q("#ppts-back3").onclick = function () { go(2); };
    q("#ppts-dl").onclick = function () { downloadCand(S.active); };
    q("#ppts-dlopen").onclick = function () { downloadAndOpen(S.active); };
    if (q("#ppts-dlall")) q("#ppts-dlall").onclick = downloadAll;
    var oc = S.cands[S.active], ot = tplById(oc.tid);
    var over = ot.slots.filter(function (s) { return s.type !== "image" && s.chars && String(oc.data[s.key] == null ? "" : oc.data[s.key]).length > s.chars[1]; }).length;
    status(over ? (over + " 个字段超长（活预览红框标注）· 下载时自动缩字号适配 · 也可手动精简") : "可直接编辑 · 红框=超长字段 · 满意后点下载", over ? "warn" : "");
  }
  function renderEditor() {
    var c = S.cands[S.active], t = tplById(c.tid), box = q("#ppts-editor");
    box.innerHTML = "";
    var iconList = t.slots.filter(function (s) { return s.type === "icon"; });
    if (iconList.length) iconBatchRow(iconList, c, box);     // 图标批量区（置顶，一次生成全部）
    t.slots.forEach(function (s) {
      if (s.type === "icon") return;                          // icon 由上方批量区统一处理
      if (s.type === "image") { imageSlotRow(s, c, box); return; }
      var v = c.data[s.key] == null ? "" : String(c.data[s.key]);
      var hi = s.chars ? s.chars[1] : 0;
      var over = hi && v.length > hi;
      var row = el('<div class="ppts-er">' +
        '<label>' + esc(s.zh || s.key) + '<span class="ppts-cnt' + (over ? " bad" : "") + '">' + v.length + (hi ? " / " + hi : "") + "</span></label>" +
        (s.single_line === false
          ? '<textarea class="ppts-ein" data-k="' + s.key + '" rows="2">' + esc(v) + "</textarea>"
          : '<input class="ppts-ein" data-k="' + s.key + '" type="text" value="' + esc(v) + '">') +
        "</div>");
      var inp = q(".ppts-ein", row);
      inp.oninput = function () {
        c.data[s.key] = inp.value;
        var cnt = q(".ppts-cnt", row);
        cnt.textContent = inp.value.length + (hi ? " / " + hi : "");
        cnt.classList.toggle("bad", hi && inp.value.length > hi);
        updateOverlay(s.key, inp.value);
      };
      box.appendChild(row);
    });
  }
  // ---------- 配图（生图指令 + 发 ChatGPT + 抓取/上传）----------
  function buildImagePrompt(s, c) {
    var brief = c && c.data && c.data._image_briefs && c.data._image_briefs[s.key];
    var plan = c && c.data && c.data._plan;
    var L = [];
    L.push("【图片与文案一体化契约】请用 DALL-E 生成一张商务汇报 PPT 配图（华为商务科技风、专业大气、画面干净、无任何文字与水印）。");
    L.push("汇报主题：" + S.topic);
    if (plan && plan.thesis) L.push("本页核心判断：" + plan.thesis);
    if (plan && plan.story_spine) L.push("本页故事线：" + plan.story_spine);
    if (brief) {
      if (brief.role_in_argument) L.push("这张图在论证链里的任务：" + brief.role_in_argument);
      if (brief.supports_slot) {
        var sv = c.data[brief.supports_slot];
        L.push("它要支撑的文字：" + (sv ? ("「" + sv + "」") : brief.supports_slot));
      }
      if (brief.visual_motif) L.push("视觉意象：" + brief.visual_motif);
      if (brief.differs_from_siblings) L.push("与相邻配图的区分：" + brief.differs_from_siblings);
    } else {
      L.push("画面内容：" + (s.hint || "与主题相关、能作为视觉证据支撑论点的高端商务科技场景"));
    }
    if (s.bbox && s.bbox[3]) L.push("构图：横版，宽高比约 " + (Math.round(s.bbox[2] / s.bbox[3] * 100) / 100) + " : 1。");
    L.push("画面作为「视觉证据」服务于主题与上述论点；禁止无关科技背景、随机城市、人像摆拍、泛光效、文字水印、伪代码。只输出图片本身，不要文字解说。");
    return L.join("\n");
  }
  function imageSlotRow(s, c, box) {
    c.images = c.images || {};
    var has = !!c.images[s.key];
    var row = el('<div class="ppts-er ppts-imgslot">' +
      '<label>🖼 ' + esc(s.zh || s.key) + '（配图）<span class="ppts-cnt ' + (has ? "okc" : "warn") + '">' + (has ? "已配 ✓" : "待配图") + '</span></label>' +
      '<div class="ppts-imgrow">' +
        '<div class="ppts-imgthumb">' + (has ? '<img src="' + c.images[s.key] + '">' : '<span>未配图</span>') + '</div>' +
        '<div class="ppts-imgbtns">' +
          '<button class="ppts-mini" data-a="send">🎨 发 ChatGPT 生图</button>' +
          '<button class="ppts-mini" data-a="grab">⬇ 抓取生成图</button>' +
          '<label class="ppts-mini ppts-up">📁 上传<input type="file" accept="image/*" hidden></label>' +
          '<button class="ppts-mini" data-a="copy">⧉ 复制指令</button>' +
        '</div></div>' +
      '<details class="ppts-fold"><summary>生图指令（发给 ChatGPT，可编辑）</summary>' +
        '<textarea class="ppts-imgprompt ppts-inp ppts-mono" rows="3">' + esc(buildImagePrompt(s, c)) + '</textarea></details>' +
      '</div>');
    var getP = function () { return q(".ppts-imgprompt", row).value; };
    q('[data-a="copy"]', row).onclick = function () { navigator.clipboard.writeText(getP()); status("生图指令已复制，粘到 ChatGPT 生图", "ok"); };
    q('[data-a="send"]', row).onclick = async function () {
      var st = await send({ type: "getState" });
      var gpt = ((st && st.participants) || []).find(function (p) { return p.service === "chatgpt"; });
      if (!gpt) { status("请先在圆桌打开 ChatGPT 标签页", "warn"); return; }
      var r = await send({ type: "sendPromptToService", participantId: gpt.id, service: "chatgpt", text: getP() });
      status(r && r.ok !== false ? "已发送到 ChatGPT，出图后点「抓取生成图」" : "发送失败，请确认 ChatGPT 已打开", r && r.ok !== false ? "ok" : "warn");
    };
    q('[data-a="grab"]', row).onclick = function () { grabImage(s, c); };
    q(".ppts-up input", row).onchange = function () {
      var f = this.files && this.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () { c.images[s.key] = rd.result; renderEditor(); renderPreview(); status("已上传配图 ✓", "ok"); };
      rd.readAsDataURL(f);
    };
    box.appendChild(row);
  }
  async function grabImage(s, c) {
    var st = await send({ type: "getState" });
    var gpt = ((st && st.participants) || []).find(function (p) { return p.service === "chatgpt"; });
    if (!gpt) { status("请先在圆桌打开 ChatGPT 标签页生成图", "warn"); return; }
    status("正在从 ChatGPT 抓取最新生成图…");
    var r = await send({ type: "readLastImage", participantId: gpt.id });
    if (r && r.ok && r.dataUrl) { c.images[s.key] = r.dataUrl; renderEditor(); renderPreview(); status("已抓取 ChatGPT 配图 ✓", "ok"); }
    else { status("没抓到生成图（确认 ChatGPT 已出图），可改用「📁 上传」手动配图", "warn"); }
  }

  // ---------- 图标批量（目标2 升级：LLM 出 SVG → 浏览器 canvas 渲染高清 PNG → 贴图；矢量清晰/风格统一/秒级/免切割）----------
  function iconSemantics(s) {
    var z = String(s.zh || "");
    ["图标", "卡片", "区", "值", "图"].forEach(function (t) { z = z.replace(new RegExp(t + "$"), ""); });
    z = z.trim();
    return z || s.hint || s.key;
  }
  // 按业界图标库规范（Lucide/Heroicons：24x24 / 1.6 stroke / round / duotone 华为蓝红 / ≤5 元素）让 AI 出一组 SVG
  function buildIconSvgPrompt(iconList, c) {
    var n = iconList.length, L = [];
    var plan = c && c.data && c.data._plan;
    var briefs = (c && c.data && c.data._image_briefs) || null;
    L.push("你是资深前端/SVG 工程师。请【编写代码】：输出 " + n + " 个 SVG 矢量图标的源代码，用于商务汇报 PPT（华为风）。");
    L.push("⚠ 这是写代码任务（SVG 是 XML 文本代码），不是生成图片——你只需像写代码一样把 SVG 文本打出来，无需也不要尝试创建/生成任何图片或调用绘图功能。");
    if (plan && (plan.thesis || plan.topic_anchor_terms)) {
      L.push("");
      L.push("【本页主题语境（图标与文案同一套故事线、整体风格统一）】");
      if (plan.thesis) L.push("核心判断：" + plan.thesis);
      if (plan.topic_anchor_terms) L.push("核心术语：" + (Array.isArray(plan.topic_anchor_terms) ? plan.topic_anchor_terms.join("、") : plan.topic_anchor_terms));
    }
    L.push("");
    L.push("【输出格式】只输出一个 JSON 数组（不要 markdown 代码块包裹、不要任何解释），每项两个键：{\"name\":\"图标名\",\"svg\":\"<svg ...>...</svg>\"}，顺序与下方语义列表严格一一对应。");
    L.push("");
    L.push("【设计规范 · 严格遵守】");
    L.push("1. 每个图标写明 width=\"24\" height=\"24\" viewBox=\"0 0 24 24\"；");
    L.push("2. 双色调 duotone 华为风：主体描边 stroke=\"#1F4E79\"（深蓝）；体块叠一层 fill=\"#1F4E79\" opacity=\"0.12\" 的浅蓝填充塑形；最关键一处细节用 stroke 或 fill=\"#C8102E\"（华为红）点缀；");
    L.push("3. 线宽统一 stroke-width=\"1.6\"，全部 stroke-linecap=\"round\" stroke-linejoin=\"round\"；");
    L.push("4. 除 duotone 填充层外 fill=\"none\"；优先用 <circle>/<rect>/<line>/<polyline>，<path> 尽量简洁；每个图标 ≤5 个子元素；");
    L.push("5. 坐标尽量取整数或 0.5 的倍数，留约 1px 外边距，保证 48px 下仍清晰可辨；");
    L.push("6. 禁止：<text>/文字/数字/字母、<script>/<filter>/<defs>/gradient/外部 href；不要硬编码 black。");
    L.push("");
    L.push("【" + n + " 个图标语义（按此顺序；为每个语义设计贴切直观的符号意象，如『容量/吞吐提升』→向上箭头或数据流、『稳定/可靠』→盾牌加对勾、『降低/收敛』→由波动转平稳的曲线、『挑战/风险』→灯塔或三角警示、『收益/增长』→上扬曲线或仪表；附「意象参考」则优先采纳）】：");
    iconList.forEach(function (s, i) {
      var b = briefs && briefs[s.key];
      var motif = b && b.visual_motif;
      L.push("  " + (i + 1) + ". " + iconSemantics(s) + (motif ? "（意象参考:" + motif + "）" : ""));
    });
    L.push("");
    L.push("现在直接输出这 " + n + " 个 SVG 图标的代码（JSON 数组，每个 svg 值是完整的 <svg>…</svg> 文本）。");
    return L.join("\n");
  }
  function sanitizeSvg(svg) {
    var s = String(svg || "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
      .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
      .replace(/(xlink:href|href)\s*=\s*"(?!#)[^"]*"/gi, "");
    // 防御：AI 偶尔漏写 xmlns → <svg> 作为 <img> 加载会被浏览器拒渲染，svgToPng 静默返回 null
    //   → 图标空白且只报"渲染失败"。缺则补（xmlns 检测不依赖引号，兼容单/双引号属性写法）。
    if (/^\s*<svg\b/i.test(s) && !/\sxmlns\s*=/i.test(s)) {
      s = s.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    return s;
  }
  // SVG 字符串 → canvas 渲染 → 高清 PNG dataURL（blob 同源不污染 canvas；image 上下文不执行 script）
  function svgToPng(svg, size, cb) {
    try {
      var blob = new Blob([sanitizeSvg(svg)], { type: "image/svg+xml;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        try {
          var cv = document.createElement("canvas");
          cv.width = size; cv.height = size;
          var ctx = cv.getContext("2d");
          ctx.clearRect(0, 0, size, size);
          ctx.drawImage(img, 0, 0, size, size);
          URL.revokeObjectURL(url);
          cb(cv.toDataURL("image/png"));
        } catch (e) { URL.revokeObjectURL(url); cb(null); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); cb(null); };
      img.src = url;
    } catch (e) { cb(null); }
  }
  // 从 AI 回复里提取 SVG。优先直接抓 <svg>...</svg> 块——网页 DOM 抓取的文本里 SVG 引号已反转义成普通 "，
  // 用 JSON.parse 必然失败（SVG 属性的引号提前结束 JSON 字符串）；正则提块不依赖 JSON 结构，两种来源都稳。
  function parseSvgArray(text) {
    var raw = String(text || "");
    // 反转义 HTML 实体（gemini 把 SVG 显示在代码块时，DOM 抓取常呈 &lt;svg&gt; 形式）
    raw = raw.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
    var svgs = raw.match(/<svg[\s\S]*?<\/svg>/gi);
    if (svgs && svgs.length) {
      return svgs.map(function (s) {
        return { svg: s.replace(/\\"/g, '"').replace(/\\\//g, "/").replace(/\\n/g, " ") };
      });
    }
    // 兜底：标准 JSON 数组（手动粘贴的规范 JSON，SVG 引号已正确转义为 \"）
    var m = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (m) raw = m[1];
    raw = raw.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    var a = raw.indexOf("["), b = raw.lastIndexOf("]");
    if (a >= 0 && b > a) {
      try {
        var arr = JSON.parse(raw.slice(a, b + 1));
        if (Array.isArray(arr)) return arr.filter(function (x) { return x && x.svg; });
      } catch (e) {}
    }
    return null;
  }
  // 把 [{name,svg}]（顺序对应 iconList）逐个渲染成 PNG 填进 c.images
  function applyIconSvgs(c, iconList, arr, done) {
    if (!arr || !arr.length) { done(false); return; }
    c.images = c.images || {};
    var pending = 0, any = false;
    iconList.forEach(function (s, i) {
      var svg = arr[i] && arr[i].svg;
      if (!svg) return;
      pending++;
      svgToPng(svg, 256, function (png) {
        if (png) { c.images[s.key] = png; any = true; }
        if (--pending === 0) done(any);
      });
    });
    if (pending === 0) done(false);
  }
  // SVG=写代码任务：优先派给对"出代码"稳的 AI；gemini 免登录易把"生成 SVG"误当成生图任务
  //   （2026-06-16 playwright 实测：claude/deepseek 稳定吐 SVG 代码，gemini 时好时坏），故降到最后。
  function pickIconAi(parts, preferId) {
    if (!parts || !parts.length) return null;
    if (preferId) { var hit = parts.find(function (p) { return p.id === preferId; }); if (hit) return hit; }
    var PREF = ["claude", "deepseek", "chatgpt", "doubao", "qwen", "kimi", "yuanbao", "grok", "gemini"];
    for (var i = 0; i < PREF.length; i++) {
      var p = parts.find(function (x) { return x.service === PREF[i]; });
      if (p) return p;
    }
    return parts[0];
  }
  async function generateIconSheet(iconList, c, prompt, onManual) {
    var st = await send({ type: "getState" });
    var parts = (st && st.participants) || [];
    var ai = pickIconAi(parts, null);
    if (!ai) { status("圆桌里没有可用 AI。请点「⧉ 复制 SVG 指令」发给任意 AI，再把回复 JSON 粘到下方「② 粘贴」框", "warn"); if (onManual) onManual(); return; }
    status("正在请 " + (ai.name || ai.service) + " 生成 " + iconList.length + " 个 SVG 矢量图标…");
    var r = await send({ type: "sendPromptToService", participantId: ai.id, service: ai.service, text: prompt });
    if (!r || r.ok === false) { status("发送给 " + (ai.name || ai.service) + " 失败。请改手动：复制指令→发给 AI→把 JSON 粘到「② 粘贴」框", "warn"); if (onManual) onManual(); return; }
    var last = "";
    for (var i = 0; i < 60; i++) {
      await sleep(2000);
      var rr = await send({ type: "readOneResponse", participantId: ai.id });
      if (rr && rr.ok && rr.text) {
        var changed = rr.text !== last; if (changed) last = rr.text;
        var arr = parseSvgArray(rr.text), streaming = !!rr.isStreaming;
        status("AI 生成中…（已收到 " + rr.text.length + " 字" + (arr ? "，捕获 " + arr.length + " 个图标" : "") + "）");
        if (arr && arr.length >= Math.min(iconList.length, 2) && (!streaming || !changed)) {
          var nFill = Math.min(arr.length, iconList.length);
          applyIconSvgs(c, iconList, arr, function (ok) {
            if (ok) { renderEditor(); renderPreview(); status("已自动生成并渲染 " + nFill + " / " + iconList.length + " 个图标 ✓", "ok"); }
            else { status("SVG 渲染失败。请改用下方「② 粘贴」框手动兜底", "warn"); if (onManual) onManual(); }
          });
          return;
        }
      }
    }
    status("自动没抓到 " + (ai.name || ai.service) + " 的 SVG（可能它把 SVG 当成生图、或输出过慢）。请改手动：复制指令→发给 AI→把回复 JSON 粘到下方「② 粘贴」框 ✋", "warn");
    if (onManual) onManual();
  }
  function iconBatchRow(iconList, c, box) {
    c.images = c.images || {};
    var doneN = iconList.filter(function (s) { return c.images[s.key]; }).length;
    var row = el('<div class="ppts-er ppts-iconbatch">' +
      '<label>🎨 图标集（' + iconList.length + ' 个 · AI 出 SVG 矢量，统一风格）<span class="ppts-cnt ' + (doneN === iconList.length ? "okc" : "warn") + '">' + doneN + ' / ' + iconList.length + '</span></label>' +
      '<div class="ppts-imgrow">' +
        '<div class="ppts-iconpv"></div>' +
        '<div class="ppts-imgbtns">' +
          '<button class="ppts-mini" data-a="gen">🅰 AI 一键生成全部</button>' +
          '<button class="ppts-mini" data-a="copy">⧉ 复制 SVG 指令</button>' +
        '</div></div>' +
      '<div class="ppts-iconmanual">' +
        '<div class="ppts-mhint">✋ <b>手动兜底（最稳）</b>：① 点上方「⧉ 复制 SVG 指令」发给任意 AI（claude / deepseek 出 SVG 最稳）→ ② 把 AI 回复的 JSON <b>整段</b>粘到下框 → 点「解析填入」</div>' +
        '<textarea class="ppts-iconpaste ppts-inp ppts-mono" rows="4" placeholder="② 把 AI 回复的 JSON 整段粘到这里，例如 [{&quot;name&quot;:&quot;…&quot;,&quot;svg&quot;:&quot;&lt;svg…&gt;&lt;/svg&gt;&quot;}, …]"></textarea>' +
        '<div class="ppts-iconmrow">' +
          '<button class="ppts-mini" data-a="parse">✓ 解析并填入 ' + iconList.length + ' 个图标</button>' +
        '</div>' +
        '<details class="ppts-fold"><summary>查看 / 编辑发给 AI 的指令</summary>' +
          '<textarea class="ppts-iconcmd ppts-inp ppts-mono" rows="6">' + esc(buildIconSvgPrompt(iconList, c)) + '</textarea>' +
        '</details>' +
      '</div>' +
      '</div>');
    var pv = q(".ppts-iconpv", row);
    iconList.forEach(function (s) {
      var sp = document.createElement("span"); sp.className = "ppts-iconchip"; sp.title = s.zh || s.key;
      if (c.images[s.key]) { var im = document.createElement("img"); im.src = c.images[s.key]; sp.appendChild(im); } else sp.textContent = "·";
      pv.appendChild(sp);
    });
    var getCmd = function () { return q(".ppts-iconcmd", row).value; };
    var flashManual = function () {
      var m = q(".ppts-iconmanual", row);
      if (!m) return;
      m.classList.remove("flash"); void m.offsetWidth; m.classList.add("flash");
      var ta = q(".ppts-iconpaste", row); if (ta) { try { ta.focus(); ta.scrollIntoView({ block: "nearest" }); } catch (_) {} }
    };
    q('[data-a="copy"]', row).onclick = function () { navigator.clipboard.writeText(getCmd()); status("SVG 指令已复制 → 去任意 AI（claude/deepseek 最稳）粘贴发送 → 把回复 JSON 粘回「② 粘贴」框", "ok"); };
    q('[data-a="gen"]', row).onclick = function () { generateIconSheet(iconList, c, getCmd(), flashManual); };
    q('[data-a="parse"]', row).onclick = function () {
      var arr = parseSvgArray(q(".ppts-iconpaste", row).value);
      if (!arr) { status("没解析出 SVG 数组。请确认粘贴的是 AI 返回的 [{name,svg}] 完整 JSON（含 <svg>…</svg>）", "warn"); flashManual(); return; }
      applyIconSvgs(c, iconList, arr, function (ok) {
        if (ok) { renderEditor(); renderPreview(); status("已从粘贴内容渲染 " + Math.min(arr.length, iconList.length) + " / " + iconList.length + " 个图标 ✓", "ok"); }
        else status("SVG 渲染失败，请检查粘贴内容是否完整", "warn");
      });
    };
    // 异步标注"将用哪个 AI 自动生成"，让用户提前发现选错 → 可直接走手动兜底
    send({ type: "getState" }).then(function (st) {
      var b = q('[data-a="gen"]', row); if (!b) return;
      var ai = pickIconAi((st && st.participants) || [], null);
      b.textContent = ai ? ("🅰 用 " + (ai.name || ai.service) + " 生成") : "🅰 AI 生成（先开个 AI）";
    }).catch(function () {});
    box.appendChild(row);
  }
  function alignToCss(a) { return a === "ctr" ? "center" : a === "r" ? "right" : a === "just" ? "justify" : "left"; }
  function anchorToJustify(a) { return a === "ctr" ? "center" : a === "b" ? "flex-end" : "flex-start"; }
  function renderPreview() {
    var c = S.cands[S.active], t = tplById(c.tid), cv = q("#ppts-canvas");
    var W = cv.clientWidth || 460, H = W * 1080 / 1920, sc = W / 1920;
    cv.style.height = H + "px";
    cv.style.backgroundImage = "url(" + gurl(t.blank) + ")";
    cv.innerHTML = "";
    t.slots.forEach(function (s) {
      if (s.type === "image" || s.type === "icon") {
        if (c.images && c.images[s.key]) {
          var ib = s.bbox || [0, 0, 100, 100];
          var im = document.createElement("img");
          im.className = "ppts-ovimg";
          im.src = c.images[s.key];
          im.style.left = (ib[0] * sc) + "px"; im.style.top = (ib[1] * sc) + "px";
          im.style.width = (ib[2] * sc) + "px"; im.style.height = (ib[3] * sc) + "px";
          cv.appendChild(im);
        }
        return;
      }
      var bb = s.bbox || [0, 0, 100, 40], st = s.style || {};
      var o = document.createElement("div");
      o.className = "ppts-ov";
      o.dataset.k = s.key;
      o.style.left = (bb[0] * sc) + "px";
      o.style.top = (bb[1] * sc) + "px";
      o.style.width = (bb[2] * sc) + "px";
      o.style.height = (bb[3] * sc) + "px";
      o.style.padding = "0 " + (7.2 * sc) + "px";               // 近似 PPT 文本框横向内边距
      o.style.justifyContent = anchorToJustify(st.anchor);      // 垂直对齐：顶/居中/底
      var szpt = st.sz_pt || s.font_pt || 12;
      o.style.fontSize = Math.max(szpt * 2 * sc, 6) + "px";
      o.style.fontWeight = (st.bold || s.role === "title" || s.role === "label" || s.role === "kpi") ? "700" : "400";
      if (st.color) o.style.color = "#" + st.color;             // 真实文字色：红底白字 / 华为红 / 深灰
      var inner = document.createElement("div");
      inner.className = "ppts-ovt";
      inner.style.textAlign = alignToCss(st.align);             // 水平对齐：左/居中/右
      var pv = c.data[s.key] == null ? "" : String(c.data[s.key]);
      inner.textContent = pv;
      o.appendChild(inner);
      var phi = s.chars && s.chars[1];
      if (phi && pv.length > phi) o.classList.add("ppts-ov-over");
      cv.appendChild(o);
    });
  }
  function updateOverlay(key, val) {
    var o = q('.ppts-ov[data-k="' + (window.CSS && CSS.escape ? CSS.escape(key) : key) + '"]', q("#ppts-canvas"));
    if (!o) return;
    var inner = q(".ppts-ovt", o); if (inner) inner.textContent = val;
    var t = tplById(S.cands[S.active].tid);
    var s = t.slots.filter(function (x) { return x.key === key; })[0];
    var hi = s && s.chars && s.chars[1];
    if (hi) o.classList.toggle("ppts-ov-over", String(val || "").length > hi);
  }

  // ---------- 下载（浏览器内 JSZip 填充）----------
  async function buildBlob(c) {
    var t = tplById(c.tid);
    var buf = await (await fetch(gurl(t.pptx))).arrayBuffer();
    return window.PptFill.build(buf, t.slots, c.data, c.images || null);
  }
  function saveBlob(blob, name) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function fileName(c) {
    var base = (S.topic.slice(0, 16) || "ppt-super").replace(/[\\/:*?"<>|\n\r\t]/g, "_");
    return base + "_" + tplById(c.tid).id + ".pptx";
  }
  async function downloadCand(i) {
    var c = S.cands[i], t = tplById(c.tid);
    status("正在生成 PPTX…");
    try {
      var blob = await buildBlob(c);
      saveBlob(blob, fileName(c));
      status("已下载：" + t.name_cn, "ok");
    } catch (e) { status("生成失败：" + e.message, "warn"); }
  }
  // 下载 + 尝试用系统 PowerPoint 自动打开（chrome.downloads.open，需 downloads.open 权限 + user gesture）
  async function downloadAndOpen(i) {
    var c = S.cands[i], t = tplById(c.tid), name = fileName(c);
    status("正在生成 PPTX…");
    var blob;
    try { blob = await buildBlob(c); } catch (e) { status("生成失败：" + e.message, "warn"); return; }
    if (!(chrome.downloads && chrome.downloads.download)) { saveBlob(blob, name); status("已下载（此浏览器不支持自动打开，请手动打开）", "ok"); return; }
    var url = URL.createObjectURL(blob);
    chrome.downloads.download({ url: url, filename: name, saveAs: false }, function (id) {
      if (chrome.runtime.lastError || id == null) {
        saveBlob(blob, name); status("已下载（自动打开不可用，请到下载栏打开）", "warn");
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000); return;
      }
      function onChg(d) {
        if (d.id !== id || !d.state || d.state.current !== "complete") return;
        chrome.downloads.onChanged.removeListener(onChg);
        try { chrome.downloads.open(id); } catch (e) {}                 // 用系统 PowerPoint 打开
        status("已下载：" + t.name_cn + " · 已尝试用 PowerPoint 打开（若没自动弹出，到浏览器下载栏点一下即可）", "ok");
        setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
      }
      chrome.downloads.onChanged.addListener(onChg);
    });
  }
  async function downloadAll() {
    for (var i = 0; i < S.cands.length; i++) { await downloadCand(i); await sleep(400); }
    status("全部 " + S.cands.length + " 套已下载", "ok");
  }

  // ---------- actions 容器 ----------
  function renderActions(html) { var a = q("#ppts-actions"); if (a) a.innerHTML = html; }

  // ---------- 入口 ----------
  function bind() {
    var btn = q("#btn-ppt-super");
    if (btn && !btn.__bound) { btn.__bound = true; btn.addEventListener("click", openModal); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
  document.addEventListener("DOMContentLoaded", bind);

  window.PptSuper = { open: openModal };
})();
