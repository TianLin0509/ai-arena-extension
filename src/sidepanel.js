// AI Arena — Side Panel v3.0.0

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const logEl = $("#log"), listEl = $("#participant-list"), countEl = $("#participant-count");
const judgeSelect = $("#judge-select");
const broadcastInput = $("#broadcast-input"), btnSend = $("#btn-send");
const btnDebate = $("#btn-debate"), btnSummary = $("#btn-summary"), btnDebateRetry = $("#btn-debate-retry");
const guidanceInput = $("#guidance-input"), roundBadge = $("#round-badge");
const pptPromptBox = $("#ppt-prompt-box"), btnPptCopy = $("#btn-ppt-copy"), btnPptImageMenu = $("#btn-ppt-image-menu");
const pptTemplateMenu = $("#ppt-template-menu"), btnPptStart = $("#btn-ppt-start"), btnPptxPrompt = $("#btn-pptx-prompt");
const btnPptSaveMenu = $("#btn-ppt-save-menu"), pptSaveMenu = $("#ppt-save-menu");

let participants = [], debateSession = {}, flowState = "idle", streamingPollTimer = null;
let pptPromptKind = null;
const PPT_CUSTOM_PROMPTS_KEY = "aiArenaPptCustomPromptsV1";
let pptCustomPrompts = { copy: "", image: "", pptx: "" };

function mergeParticipants(remote) {
  if (!remote) return;
  const localMap = {};
  for (const p of participants) localMap[p.id] = p;
  participants = remote.map(rp => {
    const local = localMap[rp.id];
    // 保留本地瞬时字段（远端 StateMachine 不存这些）
    return {
      ...rp,
      _pollStatus: local?._pollStatus || null,
      _textLength: local?._textLength || (rp.response ? rp.response.length : 0),
    };
  });
}
let injectResults = {}; // { participantId: "ok" | "failed" }

// ── 状态标签映射 ──
const STATE_LABELS = {
  idle: "", waiting: "等待中", streaming: "生成中", ready: "已完成"
};
const STATE_ICONS = {
  idle: "", waiting: "🤔", streaming: "⏳", ready: "✅"
};

function setEditorText(text) {
  broadcastInput.innerText = text;
  const range = document.createRange();
  range.selectNodeContents(broadcastInput);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  broadcastInput.focus();
}
function getDebateRound() { return debateSession?.rounds?.length || 0; }

const PPT_TEMPLATE_META = {
  intro: {
    name: "技术介绍",
    title: "技术介绍｜揭示核心原理",
    thesis: "{对象}：基于{核心机制}实现{量化收益/能力提升}",
    structure: "问题约束 → 机制拆解 → 实验/指标证据 → 输出收益",
    slots: "2-4 个紧凑区域；每区包含小标题、2-4 条短句、指标数字、方法标签或微型图表",
    visuals: "公式、伪代码、结构小图、热力图、曲线、小表格中至少 3 类",
    angle: "解释一个技术对象为什么有效，核心是“机制可信 + 证据可验证”。",
    layout: "中部放核心机制/架构拆解图，左侧放问题约束，右侧放实验指标或收益，下方用证据条收束。",
    mustInclude: "必须出现机制拆解、关键公式/伪代码/链路图、至少 2 个指标或验证口径。",
    avoid: "不要做成领域全景或宏观趋势页；不要只罗列概念。",
    huaweiSeed: "请生成一页 16:9 华为内部技术评审 PPT 截图风格的效果图，用于介绍“{技术/机制}”的核心原理。整体必须像真实工程汇报页：白底、高信息密度、左上红色结论标题、顶部细线、右上可放黄色推进箭头、底部保留页码 / Huawei Confidential / HUAWEI 标识。标题写成“{对象}：基于{核心机制}实现{量化收益/能力提升}”，不要写成营销口号。主体采用“问题约束 → 机制拆解 → 实验/指标证据 → 输出收益”的因果链。页面分 2-4 个紧凑区域，使用黑色虚线框、浅灰底板、细箭头和红色虚线强调关键路径。每个框都要像华为工程页一样被内容填满：框内包含小标题、2-4 条短句、指标数字、方法标签或微型图表，使文字/标注占据框内约 70%-90%，不要出现只放一个词或大量留白的空心框。必须包含真实技术汇报的视觉纹理：至少出现公式/伪代码/结构小图/热力图/曲线/小表格中的 3 类；每个模块用短标签说明“输入、机制、指标、结论”。红色只强调结论、关键增益和风险点，蓝色承载技术模块，灰色承载分区。避免大插画、大图标、渐变背景、圆角卡片堆叠和空泛段落。"
  },
  topic: {
    name: "技术专题",
    title: "技术专题介绍｜总分形式",
    thesis: "{专题名称}：围绕{关键抓手}突破{核心约束}，{指标}提升{数值}",
    structure: "上方总判断 + 下方多方向证据；横向链路概括输入、关键方向、验证、应用、收益",
    slots: "下方拆成 3-5 个正交方向；每个方向至少包含目标、方法、指标、证据图中的 3 类",
    visuals: "细表格、柱状图、热力图、矩阵、流程小图、红框重点标注",
    angle: "围绕一个专题做总分式展开，核心是“一个总判断 + 多个正交抓手”。",
    layout: "顶部为红色总论点；中部 3-5 个并列模块；底部用指标/验证/场景条做闭环。",
    mustInclude: "必须出现 3-5 个正交方向、每个方向的目标/方法/指标，以及一条横向贯穿链路。",
    avoid: "不要做成单机制详解；不要让多个模块重复同一维度。",
    huaweiSeed: "请生成一页 16:9 华为内部技术专题 PPT 截图风格的效果图，主题为“{专题名称}”。页面必须先给出红色结论标题和量化目标，标题格式接近“{专题名称}：围绕{关键抓手}突破{核心约束}，{指标}提升{数值}”。白底、严格网格、顶部细线、右上小黄箭头、底部页码和 Huawei Confidential / HUAWEI 标识。主体采用“上方总判断 + 下方多方向证据”的总分结构。上方用 1 条横向技术链路或阶段轴概括：数据/输入 → 关键技术方向 → 训练/验证 → 场景应用 → 收益。下方拆成 3-5 个正交方向，每个方向放在浅灰/白色紧凑分区中，包含“目标、方法、指标、证据图”四类信息中的至少 3 类。所有分区和模块框必须内容饱满：每个框至少有小标题、2-4 条短句、指标/约束/方法标签或微型证据图，文字与标注占框内约 70%-90%，避免大 padding、空白卡片和只列名词。多使用细表格、柱状图、热力图、矩阵、流程小图、红框重点标注和短句标签；不要只排大卡片。红色用于关键收益和结论，蓝色用于技术主体，灰色用于分区，黄色只用于推进箭头或局部高亮。整体像研发例会进展页，不像营销宣传页。"
  },
  compare: {
    name: "技术对比",
    title: "技术对比｜As-Is / To-Be",
    thesis: "{对象}：从 As-Is 到 To-Be，通过{关键变化}带来{量化收益}",
    structure: "左侧 As-Is 现有链路/痛点/基线指标，中间演进箭头，右侧 To-Be 目标架构/新机制/目标指标",
    slots: "下方 2-3 个证据块；每个对比框写清基线、变化、结果",
    visuals: "柱状对比、曲线、表格、热力图、公式推导、红色增益标尺",
    angle: "突出从现状到目标态的变化，核心是“差异、路径、收益”。",
    layout: "左侧 As-Is，右侧 To-Be，中间用红色演进箭头连接；底部放 2-3 个证据对比块。",
    mustInclude: "必须出现基线指标、目标指标、关键变化点、红色收益标尺或 before/after 图。",
    avoid: "不要只列优缺点；不要缺少量化前后对比。",
    huaweiSeed: "请生成一页 16:9 华为内部技术对比 PPT 截图风格的效果图。标题必须是红色结论句，格式接近“{对象}：从 As-Is 到 To-Be，通过{关键变化}带来{量化收益}”。白底、顶部细线、右上小黄箭头、底部页码与 Huawei Confidential / HUAWEI 标识，整体像真实评审材料截图。主体让“差异为什么产生收益”一眼可见。推荐左中右结构：左侧 As-Is 现有链路/痛点/基线指标，中间用粗细结合的演进箭头和红色关键变化标注，右侧 To-Be 目标架构/新机制/目标指标；下方再放 2-3 个证据块，包括柱状对比、曲线、表格、热力图或公式推导。As-Is 可用灰/黑线框，To-Be 用蓝色模块，收益跃迁用红色数字、红框、红色虚线箭头或增益标尺。每个对比框和证据框都要填满：小标题下放 2-4 条短句、基线/目标数字、约束说明、方法标签或微型图表，内容占框内约 70%-90%，不要出现空洞大框。每个区域用短标签写清“基线、变化、结果”，禁止做成两个大圆角卡片或抽象插画。"
  },
  insight: {
    name: "技术洞察",
    title: "技术洞察｜新技术科普",
    thesis: "{技术方向}：{关键变化}驱动{能力演进}，{指标}提升{数值}",
    structure: "约束/痛点 → 技术变化 → 机制解释 → 场景收益，下面放 2-3 个证据区",
    slots: "每个机制框、证据框、场景框包含标题、2-4 条短句、指标/约束/结论标签",
    visuals: "公式或机制框图、趋势曲线或柱状图、场景小矩阵、红色 callout、蓝灰架构框至少 4 类",
    angle: "解释一个新趋势/新技术为什么重要，核心是“变化原因 + 机制解释 + 场景启发”。",
    layout: "左上放趋势或痛点，中心放机制解释，右侧放能力演进，下方放场景收益矩阵。",
    mustInclude: "必须出现趋势判断、关键机制、应用场景、风险/边界、至少 1 个趋势图或场景矩阵。",
    avoid: "不要做成纯科普文章；不要缺少技术边界和落地场景。",
    huaweiSeed: "请生成一页 16:9 华为内部技术洞察 PPT 截图风格的效果图，用于解释“{新技术/新方向}”为何重要。标题必须是红色判断句，包含驱动因素和量化影响，如“{技术方向}：{关键变化}驱动{能力演进}，{指标}提升{数值}”。白底、顶部细线、右上小黄箭头、底部页码和 Huawei Confidential / HUAWEI 标识。主体不要做科幻插画，要做工程化推演页。推荐分成“约束/痛点 → 技术变化 → 机制解释 → 场景收益”四段横向链路，并在下方放 2-3 个证据区。所有机制框、证据框和场景框都要内容密实：每框包含标题、2-4 条短句、指标/约束/结论标签、微型图表或公式片段，文字和标注占框内约 70%-90%，避免留出大块空白。必须出现可验证的技术纹理：公式或机制框图、趋势曲线或柱状图、场景小矩阵、红色 callout、蓝灰架构框中的至少 4 类。用黑色/灰色承载解释，蓝色承载新技术机制，红色标出关键判断、增益和风险边界。文本短句化，像内部专家给研发团队讲清楚“为什么现在有效”，不要像公众号封面、科技海报或趋势宣传页。"
  },
  landscape: {
    name: "技术全景",
    title: "技术全景｜领域沙盘与演进",
    thesis: "{领域/系统}：按{维度A}/{维度B}/{维度C}正交拆分，支撑{收益}提升至{目标值}",
    structure: "高密度领域沙盘/演进地图；横向体现阶段/链路/时间演进，纵向体现能力层/数据层/模型层/场景层",
    slots: "顶部 3 步关键突破，中部主架构/数据链路，下部 3-4 个场景扩展或能力增强证据块",
    visuals: "虚线分区、红色突破点、蓝灰模块、黄色推进箭头、细表格、柱状指标、热力图、架构小图",
    angle: "给出一个领域/系统的全局结构，核心是“分层、演进、能力覆盖”。",
    layout: "横向用阶段轴或链路轴，纵向用能力层/数据层/模型层/场景层泳道，中下部放场景和指标块。",
    mustInclude: "必须出现分层结构、关键链路、演进阶段、场景覆盖和 2-4 个指标/能力标签。",
    avoid: "不要做成单点机制页；不要让全景图只有空框和大箭头。",
    huaweiSeed: "请生成一页 16:9 华为内部技术全景 PPT 截图风格的效果图，主题为“{领域/系统}全景”。标题用红色结论句指出拆分维度和收益，如“{领域/系统}：按{维度A}/{维度B}/{维度C}正交拆分，支撑{收益}提升至{目标值}”。白底、顶部细线、右上小黄箭头、底部页码与 Huawei Confidential / HUAWEI 标识。主体做成高密度“领域沙盘/演进地图”，不要做宽松概念图。横向体现阶段、链路或时间演进，纵向体现能力层、数据层、模型层、场景层或业务层；每个交叉点用小模块、图标化技术块、指标标签或证据缩略图表达。推荐结构：顶部 3 步关键突破，中部一条主架构/数据链路，下部 3-4 个场景扩展或能力增强证据块。每个能力块、场景块、证据块内部必须填充标题、2-4 条短句、指标/方法/约束标签或微型图表，内容占框内约 70%-90%，避免只放一个概念词导致空白。使用虚线分区、红色突破点、蓝灰模块、黄色推进箭头、细表格、柱状指标、热力图、架构小图和红色增益标尺。只有一个主结论，信息可以密但必须有清晰层次；禁止概念堆砌、抽象 3D 沙盘、炫光背景和大面积空白。"
  }
};

function getDiscussionSource() {
  const question = broadcastInput?.innerText?.trim();
  const responses = participants
    .filter(p => (p.response || p.responsePreview || "").trim())
    .map(p => `【${p.name}】\n${(p.response || p.responsePreview || "").trim()}`)
    .join("\n\n");
  if (question || responses) {
    return [
      question ? `【原始问题】\n${question}` : "",
      responses ? `【AI 讨论摘录】\n${responses}` : ""
    ].filter(Boolean).join("\n\n").slice(0, 24000);
  }
  return "请基于我们前面在本网页中的讨论内容整理 PPT 文案；如果你看不到前文，请先向我索要讨论材料。";
}

function loadPptCustomPrompts() {
  chrome.storage.local.get(PPT_CUSTOM_PROMPTS_KEY, (data) => {
    const saved = data?.[PPT_CUSTOM_PROMPTS_KEY] || {};
    pptCustomPrompts = {
      copy: typeof saved.copy === "string" ? saved.copy : "",
      image: typeof saved.image === "string" ? saved.image : "",
      pptx: typeof saved.pptx === "string" ? saved.pptx : ""
    };
  });
}

function renderPromptTemplate(text, context = {}) {
  const safe = {
    discussion: context.discussion || getDiscussionSource(),
    imageBrief: context.imageBrief || "",
    templateTitle: context.templateTitle || "",
    templateName: context.templateName || "",
    huaweiSeed: context.huaweiSeed || "",
    templateAngle: context.templateAngle || "",
    templateLayout: context.templateLayout || "",
    templateMustInclude: context.templateMustInclude || "",
    templateAvoid: context.templateAvoid || ""
  };
  return (text || "")
    .replaceAll("{{discussion}}", safe.discussion)
    .replaceAll("{{discussion_excerpt}}", safe.discussion)
    .replaceAll("${discussion}", safe.discussion)
    .replaceAll("{{image_brief}}", safe.imageBrief)
    .replaceAll("{{copy}}", safe.imageBrief)
    .replaceAll("${copy}", safe.imageBrief)
    .replaceAll("{{template_title}}", safe.templateTitle)
    .replaceAll("${t.title}", safe.templateTitle)
    .replaceAll("{{template_name}}", safe.templateName)
    .replaceAll("${t.name}", safe.templateName)
    .replaceAll("{{template_seed}}", safe.huaweiSeed)
    .replaceAll("{{huawei_seed}}", safe.huaweiSeed)
    .replaceAll("${t.huaweiSeed}", safe.huaweiSeed)
    .replaceAll("{{template_angle}}", safe.templateAngle)
    .replaceAll("${t.angle}", safe.templateAngle)
    .replaceAll("{{template_layout}}", safe.templateLayout)
    .replaceAll("${t.layout}", safe.templateLayout)
    .replaceAll("{{template_must_include}}", safe.templateMustInclude)
    .replaceAll("${t.mustInclude}", safe.templateMustInclude)
    .replaceAll("{{template_avoid}}", safe.templateAvoid)
    .replaceAll("${t.avoid}", safe.templateAvoid);
}

function buildPptCopyPrompt() {
  if (pptCustomPrompts.copy?.trim()) {
    return renderPromptTemplate(pptCustomPrompts.copy.trim(), { discussion: getDiscussionSource() });
  }
  const source = getDiscussionSource();
  return `你是华为风格企业技术汇报 PPT 的内容编译器。请把我们在本 AI Web 网页中已经展开的长期讨论，整理成后续“生成单页 PPT 效果图”可直接使用的“材料池 + 单页视觉 brief”。

当前阶段：第 1 步 / 3 步：文案生成 → 图片生成 → PPT生成
本步只做内容编译，不生成图片，不生成 PPTX，不写代码。

上下文使用方式：
- 默认你已经能看到本网页上方几十轮讨论、AI 回复和我补充的追问，请优先基于“我们的讨论内容”进行整理。
- 下面的“补充摘录”只是为了防止网页上下文遗漏；如果它和上文不一致，以上文最近讨论为准。
- 不要把本条 prompt、按钮名称、工作流说明当成 PPT 内容主题；它们只是操作指令。
- 如果你完全看不到上文，也无法从补充摘录判断主题，请先向我索要讨论材料，不要凭空编造。

补充摘录：
${source}

核心目标：
1. 先建立高密度 material-pool，再确定 slide thesis、template fit、content slots、word-budget、negative constraints。
2. 把几十轮讨论压缩成“单页华为式技术评审图”需要的高密度材料，避免下一步生图时内容空、框空、指标空。
3. 为后续 5 类模板都准备可选择的论点和内容槽，但最后给出一段最推荐的【图片生成输入文案】。

内容编译原则：
- User brief：先明确用户真正要证明的主题、受众、汇报目的和输出形态。
- Material pool：过量收集并保留事实、指标、术语、机制、约束、分歧、场景、反例和视觉素材；最终单页只用其中 1000-2000 字。
- Slide thesis：生成 3-5 个候选结论型标题，标题必须说清对象、关键动作、因果机制和收益，不只是命名主题。
- Template fit：分别判断技术介绍、技术专题、技术对比、技术洞察、技术全景哪种最适合当前讨论，不要强行套模板。
- Content slots：为单页准备 3-5 个主模块、1-3 个 mini figure / metric strip / timeline / matrix / architecture element。
- Density target：每个模块都要有小标题、2-4 条短句、指标/证据/方法标签或微型图，框内信息填充率目标 70%-90%。
- Negative constraints：明确避免太空、太海报、太概念、太大卡片、太少证据、模板错配、把讨论过程画进页面。

生成要求：
1. 先生成 5000-10000 字【material-pool 内容素材池】。如果单次输出受限，请先输出尽可能完整的第一版，并在末尾明确“可继续补全素材池”；不要只输出提纲。
2. material-pool 至少覆盖：背景与问题、用户目标、对象定义、关键机制、技术路线、对比维度、数据指标、证据链、风险约束、应用场景、落地路径、反方观点、可视化元素。
3. 生成【template fit / scenario pick】：对 5 个模板逐一评分，说明推荐模板和备用模板。
4. 生成【word-budget / density target】：标题、模块数、每模块文字量、图形量、指标条数量、预计框内填充率。
5. 生成【candidate slide theses】：3-5 个结论型标题，每个说明适合的模板：技术介绍 / 技术专题 / 技术对比 / 技术洞察 / 技术全景。
6. 生成【recommended content slots】：3-5 个主模块，每个模块必须包含模块标题、核心观点、2-4 条短 bullet、证据/指标、推荐图形、是否适合 native PPT 重建。
7. 最后输出【图片生成输入文案】：500-900 字，必须能被下一步直接用于生成一页高密度华为式 PPT 效果图。

请严格按以下结构输出，不要省略标题：

【0. User brief】
主题 / 受众 / 汇报目的 / 希望证明的核心判断 / 推荐输出页型。

【1. material-pool 内容素材池：5000-10000字】
按小标题组织，不要散文堆砌。每个小节都要包含可用于 PPT 的观点、证据、指标或可视化元素。

【2. 共识 / 分歧 / 待验证假设】
分别列出 AI 讨论中的共识、分歧、互补观点和待验证假设。

【3. template fit / scenario pick】
分别评价技术介绍、技术专题、技术对比、技术洞察、技术全景 5 类模板与当前讨论的匹配度，给出推荐模板和备用模板。

【4. candidate slide theses】
输出 3-5 个结论型标题，并标注推荐模板和推荐理由。

【5. content slots + word-budget】
输出 3-5 个主模块；每个模块按“模块标题 / 核心观点 / bullet / 证据指标 / 推荐图形 / 字数密度”组织。

【6. negative constraints】
列出本主题最容易生成失败的 5-8 条负面约束，例如太空、太概念、缺少证据、模板错配、指标不足等。

【7. 图片生成输入文案】
用 500-900 字输出下一步生图可直接使用的浓缩 brief。必须包含：结论标题、推荐模板、页面结构、模块内容、关键指标、建议图形、密度目标、负面约束。`;
}

function looksLikePptWorkflowPrompt(text) {
  return [
    "你是华为风格技术汇报 PPT 的内容编译器",
    "你是华为风格企业技术汇报 PPT 的内容编译器",
    "你是华为风格技术汇报 PPT 的视觉生成提示词执行器",
    "你是华为风格企业技术汇报 PPT 的视觉生成器",
    "你是图片转 PowerPoint 的重建工程师",
    "你是图片转 PowerPoint 的语义重建工程师",
    "当前阶段：第 1 步 / 3 步",
    "当前阶段：第 2 步 / 3 步",
    "当前阶段：第 3 步 / 3 步",
    "模板风格与版式规则",
    "版式编译：",
    "重建目标：",
    "讨论文案："
  ].some(marker => text.includes(marker));
}

function extractImageBriefFromCopy(text) {
  const source = (text || "").trim();
  if (!source) return "";
  const marker = source.includes("【7. 图片生成输入文案】")
    ? "【7. 图片生成输入文案】"
    : source.includes("【6. 图片生成输入文案】")
      ? "【6. 图片生成输入文案】"
      : "【5. 图片生成输入文案】";
  const idx = source.indexOf(marker);
  if (idx >= 0) {
    const after = source.slice(idx + marker.length).trim();
    const nextSection = after.search(/\n【\d+[\s\S]*?】|\n【[^\n】]+】/);
    return (nextSection > 0 ? after.slice(0, nextSection) : after).trim();
  }
  return source;
}

function currentPptCopy() {
  const responseCandidates = [
    ...participants.filter(p => p.service === "chatgpt"),
    ...participants.filter(p => p.service !== "chatgpt")
  ].map(p => (p.response || p.responsePreview || "").trim()).filter(Boolean);

  for (const text of responseCandidates) {
    if (!looksLikePptWorkflowPrompt(text)) return extractImageBriefFromCopy(text);
  }

  const text = pptPromptBox?.value?.trim() || "";
  if (text && pptPromptKind === "manual" && !looksLikePptWorkflowPrompt(text)) {
    return extractImageBriefFromCopy(text);
  }

  return "请先点击“文案生成”并发送给 ChatGPT；等 ChatGPT 回复讨论文案后，再点击“图片生成”。不要把文案生成、图片生成或 PPT生成按钮产生的 prompt 当作讨论文案。";
}

function buildHuaweiImagePrompt(templateKey) {
  const t = PPT_TEMPLATE_META[templateKey] || PPT_TEMPLATE_META.intro;
  const copy = currentPptCopy();
  if (pptCustomPrompts.image?.trim()) {
    return renderPromptTemplate(pptCustomPrompts.image.trim(), {
      imageBrief: copy,
      templateTitle: t.title,
      templateName: t.name,
      huaweiSeed: t.huaweiSeed,
      templateAngle: t.angle,
      templateLayout: t.layout,
      templateMustInclude: t.mustInclude,
      templateAvoid: t.avoid
    });
  }
  return `你是华为风格企业技术汇报 PPT 的视觉生成器。请把我们前面已经形成的 PPT 文案和讨论上下文，转化为一页 16:9 华为内部技术评审 PPT 效果图。

当前阶段：第 2 步 / 3 步：文案生成 → 图片生成 → PPT生成
本步只生成单页 PPT 效果图，不生成 PPTX，不解释过程，不输出长文案。

上下文使用方式：
- 默认你已经能看到本网页上方的文案生成结果和讨论历史，请优先使用上文最新的 PPT 文案。
- 下面的“补充生图内容”是从上一步【图片生成输入文案】提取的浓缩 brief；如果你能看到更完整的上文，请以上文的材料池为内容来源、以下方 brief 为画面准绳。
- 不要把本条 prompt、模板 seed、按钮名称或工作流说明画进图里；它们只用于控制风格和版式。
- 如果你看不到上文，也无法从补充 brief 判断主题，请先要求我提供文案，不要把本 prompt 当作主题内容。

补充生图内容：
${copy}

选定模板：${t.title}

模板风格与版式规则（必须优先复用其结构、层级、密度和视觉语法，不要只复用几个风格词）：
${t.huaweiSeed}

本模板的差异化任务：
- 叙事角度：${t.angle}
- 版式骨架：${t.layout}
- 必须包含：${t.mustInclude}
- 避免误用：${t.avoid}

请按以下顺序在内部完成画面编译：
1. Canvas and style：16:9，白底或极浅灰底，华为内部企业技术报告截图风格，红/蓝/灰/黄配色，中文微软雅黑观感，英文和数字 Arial 观感，禁止营销海报风。
2. Slide thesis：从上文 material-pool / 图片生成输入文案中提炼一个“结论先行”的红色标题，标题必须说清观点、对象、关键动作和收益，不要只命名主题。标题格式参考：${t.thesis}
3. Template recipe：优先采用上面的模板风格与版式规则，以及选定模板差异化任务；复用其结构、层级、密度、证据组织方式和视觉语法，不照抄规则中的占位词。
4. Content slots：从材料池中选择 3-5 个具体模块，包含标题、短 bullet、指标/证据、方法标签、微型图形；至少 1-3 个 mini figures / metric strips / timelines / flows / matrices / architecture elements。
5. Word budget：总文字观感约 1000-1500 中文字；模块内使用 7-10pt 紧凑短标签，标题 18-22pt，分区标题 11-14pt；不要写长段落。
6. Density target：每个容器内部必须被内容填满，文字/标注/图表占框内 70%-90%；只要画框，就必须有证据、指标、方法或微型图。
7. Negative constraints：避免空白框、大圆角卡片、渐变海报、3D 炫光、大图标堆砌、浏览器边框、聊天窗口、mockup frame、lorem ipsum、伪造 logo、把 prompt 指令画进图。
8. Output requirements：调用当前聊天的图像生成能力，只输出一张单页 PPT 效果图；不要输出解释文字；不要生成 PPTX。

视觉硬约束：
- 页眉：左上红色结论标题，顶部红/灰细线，右上可放小黄色推进箭头。
- 页脚：左下小页码，中间可放 Huawei Confidential 或 HUAWEI TECHNOLOGIES CO., LTD.，右下可放 HUAWEI 标识风格占位。
- 结构：页面由 2-4 个主要区域组成，使用细灰线、浅灰底板、黑色虚线框或分区标题切分；保持模板 ${t.name} 的主要版式骨架。
- 信息纹理：混合使用小型图表、公式、热力图、矩阵、微型架构图、表格、标注、箭头、红色虚线路径和指标柱。
- 配色：华为红 #CC0000 用于标题、结论、收益、关键箭头和虚线高亮；中蓝 #005691 / 浅蓝用于技术模块；浅灰 #F2F2F2 用于底板；黑/灰用于证据文字；黄色/橙色只用于推进箭头或局部高亮。
- PPTX 友好：尽量让主要文字、表格、流程节点、指标条、图表和箭头看起来可被后续 native PowerPoint 对象重建；复杂纹理和小图标可以简化。

最终只生成图像。`;
}

function buildImageToPptPrompt() {
  if (pptCustomPrompts.pptx?.trim()) {
    return renderPromptTemplate(pptCustomPrompts.pptx.trim());
  }
  return `你是图片转 PowerPoint 的语义重建工程师。请将我们刚生成的 PPT 效果图，或我随后上传的 PNG/JPG，重建为一份可编辑的 PowerPoint PPTX。

当前阶段：第 3 步 / 3 步：文案生成 → 图片生成 → PPT生成
上下文使用方式：
- 默认你已经能看到本网页上方刚生成的 PPT 效果图，请把那张图作为转换对象。
- 如果你看不到上方图片，或当前网页无法直接读取图片，请直接要求我上传 PNG/JPG。
- 不要重新生成文案，不要重新设计图片；本步只做图片到 PPTX 的语义重建。

重建原则：
- 视觉 1:1 优先：先保持上一步效果图的整体视觉、布局、层级、配色、密度和 Huawei 技术评审页质感。
- 再恢复可编辑性：标题、正文、表格、图表标签、流程节点、指标数字、箭头、矩形模块和主要形状尽量使用 PowerPoint 原生对象。
- 可采用“视觉优先 + 可编辑对象覆盖”的混合重建：必要时用小面积 PNG/SVG fallback 保住复杂纹理、细小 logo、阴影、复杂图标或低编辑价值装饰，但不能把整页或大块文字区栅格化。
- 如果可以执行文件生成，请按闭环思路完成：源图 → 结构化页面规格 / 语义对象清单 → PPTX → 渲染预览 → 评分 → 差异修正。
- 优化对象是结构化页面规格或对象清单，不要直接堆 PPTX 字节或把整页图贴进去。

重建目标：
1. 视觉优先：PPTX 渲染后应尽量接近原图的布局、颜色、层级、字号、间距和对齐。
2. 可编辑优先级：标题、正文、表格、图表标签、流程节点、指标数字、箭头、矩形模块和主要形状尽量使用 PowerPoint 原生对象。
3. 禁止偷懒：不要把整页作为一张大图贴进 PPT；不要把重要文字、表格、图表整体栅格化。
4. 允许 fallback：复杂纹理、细小 logo、阴影、复杂图标或低编辑价值装饰，可以用小 PNG/SVG fallback。

重建流程：
1. 先识别语义结构：标题区、页眉页脚、主模块、证据图、表格/图表、流程箭头、指标标签、注释说明。
2. 为每个语义单元建立对象清单，标注 role、bbox、style、native text / native shape / native chart-table / small fallback。
3. 元素路由：标题、正文、表格单元格、图表轴/标签/数据为 whitelist，必须 native；小箭头、徽标、装饰点为 greylist，可 native 或小 fallback；复杂纹理、微小 logo、低编辑价值装饰为 blacklist，可早期 fallback。
4. 按视觉层级重建：背景与分区 → 主体模块 → 图表/流程 → 文字与指标 → 标注与细节。
5. 中文字体优先使用微软雅黑或相近字体；英文和数字使用 Arial 或相近字体。
6. fallback 图片总面积尽量控制在 5% 以内，单个 fallback 尽量不超过 1.5%，不得 rasterize 白名单内容。
7. 如果可渲染和评分，请报告视觉还原分、可编辑性分、综合分、相似度、shape count、text shape count、picture area ratio；目标是视觉接近原图且可编辑对象占比足够高。若无法评分，明确说明限制并至少报告对象统计和 fallback 策略。

交付要求：
- 如果可以直接生成文件，请输出 PPTX。
- 同时说明：哪些元素是原生可编辑，哪些元素用了 fallback，以及为什么。
- 必须检查中文文本是否乱码或异常问号；发现乱码时先修复，不要交付。
- 如果当前环境不能直接产出 PPTX，请先输出可执行的重建方案、对象清单、页面尺寸、颜色/字体规范、fallback 策略，并明确需要我上传哪张图片。`;
}


// ── 日志 ──
function addLog(msg, type = "info") {
  const e = document.createElement("div");
  e.className = `entry ${type}`;
  e.textContent = `[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${msg}`;
  logEl.prepend(e);
  while (logEl.children.length > 50) logEl.lastChild.remove();
}

// ── 渲染参与者（状态卡片） ──
function renderParticipants() {
  countEl.textContent = participants.length;
  const rounds = debateSession?.rounds?.length || 0;
  if (rounds > 0) { roundBadge.style.display = ""; roundBadge.textContent = `第${rounds}轮`; }
  else { roundBadge.style.display = "none"; }
  updateTaskState();

  if (!participants.length) {
    listEl.innerHTML = `<div class="empty-hint">
      <div class="empty-icon">⚡</div>
      <div class="empty-title">添加 AI 参与者</div>
      <div class="empty-desc">支持 Claude、GPT、Gemini 等 9 种 AI，在同一窗口中同步提问并展开多轮辩论</div>
      <div class="empty-actions">
        <span class="empty-chip claude" data-service="claude">+ Claude</span>
        <span class="empty-chip chatgpt" data-service="chatgpt">+ GPT</span>
        <span class="empty-chip gemini" data-service="gemini">+ Gemini</span>
      </div>
    </div>`;
    // 空状态芯片可点击
    listEl.querySelectorAll('.empty-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const screen = {
          width: window.screen.availWidth, height: window.screen.availHeight,
          left: window.screen.availLeft || 0, top: window.screen.availTop || 0,
        };
        chrome.runtime.sendMessage({ type: "addParticipant", service: chip.dataset.service, screen });
      });
    });
  } else {
    listEl.innerHTML = participants.map(p => {
      // 轮询状态是唯一 UI 状态源
      const pState = p._pollStatus || "idle";
      const sc = (pState === "streaming" || pState === "waiting") ? "streaming" : (p.tabId ? "ready" : "offline");
      const stateLabel = STATE_LABELS[pState] || "";
      const stateIcon = STATE_ICONS[pState] || "";

      // 门控1：发送失败时显示操作按钮
      let gateActions = "";
      if (injectResults[p.id] === "failed" && flowState === "broadcasting") {
        gateActions = `<div class="p-gate-actions">
          <button class="p-gate-btn" data-action="retry" data-id="${p.id}">重试</button>
          <button class="p-gate-btn" data-action="manual-send" data-id="${p.id}">已手动发送</button>
          <button class="p-gate-btn" data-action="skip" data-id="${p.id}">跳过</button>
        </div>`;
      }

      // 流式进度条
      const isStreamingNow = pState === "streaming" || pState === "waiting";
      const progressBar = isStreamingNow
        ? `<div class="stream-progress"><div class="stream-progress-bar" style="width:${Math.min(90, Math.max(15, (p._textLength || 0) / 10))}%"></div></div>`
        : '';

      // 实时字数显示
      const charCount = p._textLength || 0;
      const charDisplay = charCount > 0 ? `<span class="p-chars">${charCount}字</span>` : '';

      // 有效回答状态（StateMachine 中已存储回复）
      const hasResponse = !!p.responsePreview;
      const readyBadge = hasResponse
        ? `<span class="p-ready-badge ready">✓</span>`
        : `<span class="p-ready-badge not-ready">✗</span>`;

      // 手动操作按钮
      const actionBtns = !gateActions ? [
        `<button class="p-action-btn p-send" data-id="${p.id}" title="重新发送提问给该AI">↻</button>`,
        `<button class="p-action-btn p-extract" data-id="${p.id}" title="手动提取该AI的回复">⇣</button>`
      ].join('') : '';

      const metaParts = [
        p.tabId ? "已打开" : "离线",
        stateLabel ? `${stateIcon} ${stateLabel}` : "",
        charCount > 0 ? `${charCount}字` : ""
      ].filter(Boolean).join(" · ");

      return `<div class="participant-item ${p.service}" data-tab-id="${p.tabId || ''}" style="cursor:pointer">
        <div class="p-main">
          <div class="p-title-row">
            <span class="p-status ${sc}"></span>
            ${brandIcon(p.service)}
            <span class="p-name">${p.name}</span>
            ${readyBadge}
          </div>
          <div class="p-meta-row">
            <span>${metaParts || "等待操作"}</span>
          </div>
          ${progressBar}
          ${gateActions}
        </div>
        <div class="p-actions">
          ${actionBtns}
          <button class="p-btn p-remove" data-id="${p.id}" title="移除">✕</button>
        </div>
      </div>`;
    }).join("");

    // 事件绑定
    listEl.querySelectorAll(".p-remove").forEach(b => b.addEventListener("click", () => chrome.runtime.sendMessage({ type: "removeParticipant", id: b.dataset.id })));
    // 手动发送按钮
    listEl.querySelectorAll(".p-send").forEach(b => b.addEventListener("click", async () => {
      const id = b.dataset.id;
      const p = participants.find(p => p.id === id);
      b.textContent = "⏳"; b.disabled = true;
      addLog(`手动发送给 ${p?.name || id}...`, "info");
      const resp = await chrome.runtime.sendMessage({ type: "sendToOne", participantId: id });
      if (resp?.ok) {
        if (p) { p._pollStatus = null; p._textLength = 0; }
        addLog(`已发送给 ${p?.name || id}`, "success");
        renderParticipants();
        if (!streamingPollTimer) startStreamingPoll();
      } else {
        addLog(`发送失败: ${resp?.error || '未知错误'}`, "error");
      }
      b.textContent = "↻"; b.disabled = false;
    }));
    // 手动提取按钮
    listEl.querySelectorAll(".p-extract").forEach(b => b.addEventListener("click", async () => {
      const id = b.dataset.id;
      const p = participants.find(p => p.id === id);
      b.textContent = "⏳"; b.disabled = true;
      addLog(`手动提取 ${p?.name || id} 的回复...`, "info");
      const resp = await chrome.runtime.sendMessage({ type: "readOneResponse", participantId: id });
      if (resp?.ok && resp.text) {
        if (p) { p._pollStatus = "ready"; p._textLength = resp.text.length; }
        trackChars(resp.text.length, p?.service);
        addLog(`${p?.name || id} 回复已提取 (${resp.text.length}字)`, "success");
        renderParticipants();
        // 检查是否所有人都 ready 了
        checkAllReadyAndConfirm();
      } else {
        addLog(`提取失败: ${resp?.error || '未读取到内容'}`, "error");
        b.textContent = "⇣"; b.disabled = false;
      }
    }));

    // 门控1 按钮
    listEl.querySelectorAll(".p-gate-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const { action, id } = btn.dataset;
        if (action === "retry") {
          addLog("重试注入...", "info");
          const r = await chrome.runtime.sendMessage({ type: "retryInject", id });
          if (r?.ok) {
            injectResults[id] = "ok";
          }
        } else if (action === "manual-send") {
          injectResults[id] = "ok";
          addLog("已标记为手动发送", "info");
        } else if (action === "skip") {
          delete injectResults[id];
          addLog("已跳过", "info");
        }
        // 检查是否所有门控1都已处理
        renderParticipants();
        checkGate1Complete();
      });
    });

    // 点击参与者卡片 → 聚焦对应 tab
    listEl.querySelectorAll(".participant-item").forEach(card => {
      card.addEventListener("click", async (e) => {
        if (e.target.closest("button")) return;
        const tabId = parseInt(card.dataset.tabId);
        if (!tabId) return;
        try {
          const tab = await chrome.tabs.get(tabId);
          await chrome.windows.update(tab.windowId, { focused: true });
          await chrome.tabs.update(tabId, { active: true });
        } catch {}
      });
    });
  }

  // 更新裁判下拉
  [judgeSelect].forEach(sel => {
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">选择裁判...</option>' + participants.map(p => `<option value="${p.id}">${p.name}</option>`).join("");
    if (cur && participants.find(p => p.id === cur)) sel.value = cur;
  });

  // 辩论按钮状态：至少 2 个有效回答才能辩论
  const readyCount = participants.filter(p => !!p.responsePreview).length;
  if (btnDebate) {
    btnDebate.disabled = readyCount < 2;
    if (readyCount < 2) {
      btnDebate.title = `需要至少 2 个有效回答（当前 ${readyCount} 个）`;
    } else {
      btnDebate.title = `${readyCount} 个有效回答，可以开始辩论`;
    }
  }
}

// 门控1完成检查：injectResults 中无 failed → 自动进入 AWAITING_RESPONSES
function checkGate1Complete() {
  if (flowState !== "broadcasting") return;
  const hasFailure = Object.values(injectResults).some(v => v === "failed");
  if (!hasFailure) {
    flowState = "awaiting_responses";
    startStreamingPoll();
    addLog("所有参与者已就绪，开始等待回复...", "success");
  }
}

// 检查是否所有参与者都 ready
function checkAllReadyAndConfirm() {
  const allReady = participants.length > 0 && participants.every(p => p._pollStatus === "ready");
  if (allReady) {
    stopStreamingPoll();
    addLog("所有 AI 回复已就绪，可以开始辩论", "success");
  }
}

// ── 无标记轮询（文本稳定 + streaming 状态） ──
let pollStartTime = 0, pollErrorCount = 0, pollReadyCount = 0;
let pollDelayTimer = null;
let prevLengths = {}; // { participantId: number }
let stableCounts = {}; // { participantId: consecutiveStablePolls }
let hasStreamedMap = {}; // { participantId: bool } — 必须观察到一次"流过"才允许判 ready
let pollActiveIds = null; // null = 全部在线参与者；Set = 只轮询本轮发送目标
const POLL_MAX_DURATION = 10 * 60 * 1000;
const POLL_MAX_ERRORS = 10;
const POLL_READY_THRESHOLD = 3; // 连续3次稳定才判定完成
const POLL_INITIAL_DELAY = 2000;
const POLL_INTERVAL = 500; // 0.5秒轮询（无标记后适当放慢）

function startStreamingPoll(activeIds = null) {
  stopStreamingPoll();
  pollStartTime = Date.now();
  pollErrorCount = 0;
  pollReadyCount = 0;
  prevLengths = {};
  stableCounts = {};
  hasStreamedMap = {};
  pollActiveIds = Array.isArray(activeIds) ? new Set(activeIds) : null;
  pollDelayTimer = setTimeout(() => {
    pollDelayTimer = null;
    schedulePollTick();
  }, POLL_INITIAL_DELAY);
}

function schedulePollTick() {
  streamingPollTimer = setTimeout(async () => {
      if (Date.now() - pollStartTime > POLL_MAX_DURATION) {
        addLog("轮询超时（10分钟），已自动停止", "error");
        stopStreamingPoll();
        return;
      }
      try {
        const s = await chrome.runtime.sendMessage({ type: "checkAllCompletion" });
        pollErrorCount = 0;

        let allDone = true;
        let hasOnline = false;
        for (const [id, v] of Object.entries(s)) {
          if (pollActiveIds && !pollActiveIds.has(id)) continue;
          if (v.status === "offline") continue;
          hasOnline = true;
          const prevLen = prevLengths[id] || 0;
          const lengthChanged = v.textLength !== prevLen;
          prevLengths[id] = v.textLength;

          const p = participants.find(p => p.id === id);
          if (p) {
            p._textLength = v.textLength;

            // 判定（v4.0.3-beta）：isStreaming 作为软信号——selector 有效时强约束（不允许在 streaming 中误判完成），
            // selector 失效时（永远 false）自动退化为只看 lengthChanged。
            if (v.textLength > 0) hasStreamedMap[id] = true;
            // isStreaming=true 时强制重置稳定计数：哪怕长度暂时不变，仍在流式中（AI 思考停顿等）
            if (v.isStreaming) {
              stableCounts[id] = 0;
            }

            if (v.textLength > 0 && !lengthChanged && !v.isStreaming) {
              // 文本非空 + 长度不变 + 非流式中 → 累计稳定次数
              stableCounts[id] = (stableCounts[id] || 0) + 1;
              if (stableCounts[id] >= POLL_READY_THRESHOLD && p._pollStatus !== "ready") {
                p._pollStatus = "ready";
                // 防 chat-bus 已完成同步过来：若 StateMachine 已有 response（chat-bus 抢先调过 readOneResponse），
                // 跳过自己的 readOneResponse 调用，避免 sanity check 因 prevResp 已存在而误判为"上轮残留"，导致状态回退
                if (p.response && p.response.trim().length > 0) {
                  addLog(`${p.name} 已由 popup 同步 (${p.response.length}字)`, "info");
                  p._textLength = p.response.length;
                  renderParticipants();
                  return;
                }
                chrome.runtime.sendMessage({ type: "readOneResponse", participantId: id }).then(resp => {
                  if (resp?.ok) {
                    if (resp.text) {
                      trackChars(resp.text.length, p.service);
                      // 同步更新本地 _textLength 以最终回复长度为准
                      const localP = participants.find(x => x.id === id);
                      if (localP) localP._textLength = resp.text.length;
                    }
                    addLog(`${p.name} 回复已自动提取`, "success");
                    chrome.runtime.sendMessage({ type: "getState" }).then(state => {
                      if (state) { mergeParticipants(state.participants); renderParticipants(); }
                    });
                  } else if (resp?.error) {
                    // sanity check 拒绝：回退状态、清稳定计数，让轮询继续观察
                    addLog(`${p.name}: ${resp.error}`, "error");
                    p._pollStatus = "waiting";
                    stableCounts[id] = 0;
                    hasStreamedMap[id] = false;
                    renderParticipants();
                  }
                }).catch(() => {});
              }
            } else if (lengthChanged || v.isStreaming) {
              // 长度变化 或 isStreaming=true → 仍在生成中
              stableCounts[id] = 0;
              p._pollStatus = v.textLength > 0 ? "streaming" : "waiting";
            } else {
              // textLength=0 且不变 → 还没开始，waiting
              stableCounts[id] = 0;
              p._pollStatus = "waiting";
            }
          }
          if (p?._pollStatus !== "ready") allDone = false;
        }
        renderParticipants();

        if (allDone && hasOnline) {
          pollReadyCount++;
          if (pollReadyCount >= 2) {
            addLog("所有 AI 已回答完毕，读取回复...", "success");
            const doneIds = pollActiveIds ? Array.from(pollActiveIds) : null;
            stopStreamingPoll();
            await readAllResponses(doneIds);
            if (Notification.permission === "granted") {
              try { new Notification("AI Arena", { body: "所有 AI 已回答完毕", icon: "icons/icon128.png" }); } catch {}
            }
          }
        } else { pollReadyCount = 0; }
      } catch (e) {
        pollErrorCount++;
        if (pollErrorCount >= POLL_MAX_ERRORS) {
          addLog(`轮询连续失败 ${POLL_MAX_ERRORS} 次，已停止`, "error");
          stopStreamingPoll();
          return;
        }
      }
      if (streamingPollTimer !== null) schedulePollTick();
    }, POLL_INTERVAL);
}

function stopStreamingPoll() {
  if (pollDelayTimer) { clearTimeout(pollDelayTimer); pollDelayTimer = null; }
  if (streamingPollTimer) { clearTimeout(streamingPollTimer); }
  streamingPollTimer = null;
  pollActiveIds = null;
}

// 读取本轮目标参与者的回复；未传 activeIds 时读取全部参与者
async function readAllResponses(activeIds = null) {
  const activeSet = Array.isArray(activeIds) ? new Set(activeIds) : activeIds;
  for (const p of participants) {
    if (activeSet && !activeSet.has(p.id)) continue;
    try {
      await chrome.runtime.sendMessage({ type: "readOneResponse", participantId: p.id });
    } catch (e) {
      addLog(`读取 ${p.name} 失败: ${e.message}`, "error");
    }
  }
  // 刷新状态
  const state = await chrome.runtime.sendMessage({ type: "getState" });
  if (state) { mergeParticipants(state.participants); debateSession = state.debateSession; flowState = state.flowState; }
  renderParticipants();
}

// ── 消息监听 ──
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "status") addLog(msg.message);
  if (msg.type === "stateUpdate") {
    mergeParticipants(msg.participants);
    debateSession = msg.debateSession || {};
    flowState = msg.flowState || "idle";
    renderParticipants();
  }
  if (msg.type === "selectorWarning") {
    addLog(msg.message, "info");
  }
  if (msg.type === "contextMenuText") {
    const text = msg.text || "";
    if (text) { setEditorText(text); addLog("已从网页获取选中文本 (" + text.length + " 字)", "info"); }
  }
});

// 初始化
(async () => {
  try {
    const r = await chrome.runtime.sendMessage({ type: "getState" });
    if (r) { mergeParticipants(r.participants); debateSession = r.debateSession || {}; flowState = r.flowState || "idle"; renderParticipants(); }
  } catch {}
})();

// 定期刷新
setInterval(async () => {
  try {
    const r = await chrome.runtime.sendMessage({ type: "getState" });
    if (r) {
      mergeParticipants(r.participants); debateSession = r.debateSession || {};
      flowState = r.flowState || "idle";
      if (!streamingPollTimer) renderParticipants();
    }
  } catch {}
}, 5000);

// ── 窗口模式切换 ──
$$(".mode-opt").forEach(btn => {
  btn.addEventListener("click", async () => {
    $$(".mode-opt").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const mode = btn.dataset.mode;
    await chrome.runtime.sendMessage({ type: "setWindowMode", mode });
    addLog(`切换到${mode === "tiled" ? "并列" : "Tab"}模式`, "info");
    // 并列模式下自动排列已有窗口
    if (mode === "tiled" && participants.length > 0) {
      const screen = {
        width: window.screen.width,
        height: window.screen.availHeight,
        left: 0,
        top: window.screen.availTop || 0,
      };
      const r = await chrome.runtime.sendMessage({ type: "arrangeWindows", screen });
      if (r?.ok) addLog("窗口已排列", "success");
    }
  });
});


// ── 当前任务 tabs ──
function setActiveTask(task) {
  $$(".task-tab").forEach(btn => btn.classList.toggle("active", btn.dataset.task === task));
  $$(".task-panel").forEach(panel => panel.classList.toggle("active", panel.dataset.taskPanel === task));
}

$$(".task-tab").forEach(btn => {
  btn.addEventListener("click", () => setActiveTask(btn.dataset.task));
});

// ── 添加参与者 ──
// 报告 sidepanel 当前所在 chrome window 的 bounds 给 background（用于推断真实物理屏）
async function getCurrentScreenInfo() {
  // 优先用 chrome.windows.getCurrent，因为 sidepanel 的 window.screen 在某些 chrome 版本会
  // 返回全 desktop union 而非真实所在屏；getCurrent 拿到 sidepanel 附着的 chrome window
  // 的 left/top/width/height，background 再据此找物理屏。
  try {
    const w = await chrome.windows.getCurrent();
    if (w && typeof w.left === "number") {
      return {
        width: w.width,
        height: w.height,
        left: w.left,
        top: w.top,
        // 同时报告 window.screen 作为 fallback 信号
        screenAvailWidth: window.screen.availWidth,
        screenAvailHeight: window.screen.availHeight,
        screenAvailLeft: window.screen.availLeft || 0,
        screenAvailTop: window.screen.availTop || 0,
      };
    }
  } catch {}
  // fallback：用 window.screen
  return {
    width: window.screen.availWidth,
    height: window.screen.availHeight,
    left: window.screen.availLeft || 0,
    top: window.screen.availTop || 0,
  };
}

$$(".btn-add").forEach(b => b.addEventListener("click", async () => {
  if (participants.length >= 3) { addLog("最多 3 个参与者", "error"); return; }
  addLog(`添加 ${b.dataset.service}...`);
  const screen = await getCurrentScreenInfo();
  await chrome.runtime.sendMessage({ type: "addParticipant", service: b.dataset.service, screen });
}));

// ── 文件管理 ──
let pendingImages = [], pendingFiles = [];
const imagePreviews = $("#image-previews");
const fileInput = $("#file-input");

function addImage(dataUrl) { pendingImages.push(dataUrl); renderFilePreviews(); }
function addTextFile(name, content) { pendingFiles.push({ name, content }); renderFilePreviews(); }
function removeAttachment(type, index) {
  if (type === "img") pendingImages.splice(index, 1);
  else pendingFiles.splice(index, 1);
  renderFilePreviews();
}

function renderFilePreviews() {
  let html = "";
  pendingImages.forEach((dataUrl, i) => { html += `<div class="img-preview"><img src="${dataUrl}"><button class="img-remove" data-type="img" data-idx="${i}">✕</button></div>`; });
  pendingFiles.forEach((f, i) => { html += `<div class="img-preview file-preview"><span class="file-icon">📄</span><span class="file-name">${f.name.length > 12 ? f.name.slice(0, 10) + '...' : f.name}</span><button class="img-remove" data-type="file" data-idx="${i}">✕</button></div>`; });
  imagePreviews.innerHTML = html;
  imagePreviews.querySelectorAll(".img-remove").forEach(btn => { btn.addEventListener("click", () => removeAttachment(btn.dataset.type, parseInt(btn.dataset.idx))); });
}

function fileToDataUrl(file) { return new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsDataURL(file); }); }
function fileToText(file) { return new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsText(file); }); }
function isImageFile(file) { return file.type.startsWith("image/"); }

broadcastInput.addEventListener("paste", async (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) { addImage(await fileToDataUrl(file)); addLog("已粘贴图片", "info"); }
    }
  }
});

fileInput.addEventListener("change", async () => {
  for (const file of fileInput.files) {
    if (isImageFile(file)) { addImage(await fileToDataUrl(file)); }
    else {
      try {
        const content = await fileToText(file);
        addTextFile(file.name, content);
        addLog(`已添加文件: ${file.name} (${(content.length / 1024).toFixed(1)}KB)`, "info");
      } catch { addLog(`无法读取文件: ${file.name}`, "error"); }
    }
  }
  fileInput.value = "";
});

broadcastInput.addEventListener("input", () => {
  broadcastInput.querySelectorAll("img").forEach(img => { if (img.src.startsWith("data:")) { addImage(img.src); img.remove(); } });
});

// ── 广播 ──
async function doBroadcast() {
  if (btnSend.disabled) return;
  let text = broadcastInput.innerText.trim();
  const hasImages = pendingImages.length > 0;
  const hasFiles = pendingFiles.length > 0;
  if (!text && !hasImages && !hasFiles) return;
  if (!participants.length) { addLog("请先添加参与者", "error"); return; }
  if (hasFiles) {
    text += pendingFiles.map(f => `\n\n---\n📄 文件: ${f.name}\n\`\`\`\n${f.content}\n\`\`\``).join("");
  }
  btnSend.disabled = true; btnSend.innerHTML = '<span class="btn-spinner btn-dark-spinner"></span> 发送中...';
  // 重置所有参与者的轮询状态
  participants.forEach(p => { p._pollStatus = null; p._textLength = 0; });
  renderParticipants();
  const attachInfo = [];
  if (hasImages) attachInfo.push(`${pendingImages.length}张图`);
  if (hasFiles) attachInfo.push(`${pendingFiles.length}个文件`);
  addLog("广播: " + text.slice(0, 50) + (text.length > 50 ? "..." : "") + (attachInfo.length ? ` (+${attachInfo.join(", ")})` : ""));
  trackConversation(participants.length);

  try {
    const r = await chrome.runtime.sendMessage({ type: "broadcast", text, images: hasImages ? pendingImages : undefined });
    if (r) {
      injectResults = {};
      for (const [id, v] of Object.entries(r)) {
        injectResults[id] = (v.status === "sent" || v.status === "inputted") ? "ok" : "failed";
        addLog(`${v.name}: ${v.status}${v.error ? " - " + v.error : ""}`, v.status === "sent" || v.status === "inputted" ? "success" : "error");
      }
    }
    broadcastInput.innerHTML = "";
    pendingImages = [];
    pendingFiles = [];
    renderFilePreviews();
    // 刷新状态
    const state = await chrome.runtime.sendMessage({ type: "getState" });
    if (state) { mergeParticipants(state.participants); flowState = state.flowState; }
    renderParticipants();
    // 如果自动进入了 awaiting，开始轮询
    if (flowState === "awaiting_responses") {
      startStreamingPoll();
    }
  } catch (e) { addLog("失败: " + e.message, "error"); }
  btnSend.disabled = false; btnSend.innerHTML = '发送给全部';
}
btnSend.addEventListener("click", doBroadcast);
broadcastInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); doBroadcast(); } });

// ── PPT 制作 block ──
function setPptPrompt(text, kind = "manual") {
  if (!pptPromptBox) return;
  pptPromptBox.value = text;
  pptPromptKind = kind;
  pptPromptBox.focus();
}

async function sendPptPromptToChatGPT() {
  const text = pptPromptBox?.value?.trim() || "";
  if (!text) { addLog("请先生成或填写 PPT prompt", "error"); return; }
  if (btnPptStart.disabled) return;
  btnPptStart.disabled = true;
  btnPptStart.innerHTML = '<span class="btn-spinner btn-dark-spinner"></span> 发送中...';
  try {
    const r = await chrome.runtime.sendMessage({ type: "sendPromptToService", service: "chatgpt", text });
    if (!r?.ok) {
      addLog(`发送给 ChatGPT 失败: ${r?.error || "未知错误"}`, "error");
      return;
    }
    addLog(`已发送给 ChatGPT：${r.name || "GPT"}`, "success");
    participants.forEach(p => {
      if (p.id === r.participantId) {
        p._pollStatus = null;
        p._textLength = 0;
      } else {
        p._pollStatus = "ready";
      }
    });
    renderParticipants();
    startStreamingPoll([r.participantId]);
  } catch (e) {
    addLog("发送给 ChatGPT 失败: " + e.message, "error");
  } finally {
    btnPptStart.disabled = false;
    btnPptStart.textContent = "开始生成";
  }
}

function updateTaskState() {
  const el = $("#task-state");
  if (!el) return;
  const readyCount = participants.filter(p => !!p.responsePreview).length;
  const labels = {
    idle: participants.length ? `${participants.length} 个参与者` : "准备就绪",
    broadcasting: "正在发送",
    awaiting_responses: `等待回复 ${readyCount}/${participants.length}`,
    debating: "辩论中",
    summary: "总结中"
  };
  el.textContent = labels[flowState] || "准备就绪";
}

btnPptCopy?.addEventListener("click", () => {
  setPptPrompt(buildPptCopyPrompt(), "copy-prompt");
  addLog("已生成讨论文案 prompt", "info");
});

btnPptImageMenu?.addEventListener("click", (e) => {
  e.stopPropagation();
  pptSaveMenu?.classList.remove("open");
  pptTemplateMenu?.classList.toggle("open");
});

pptTemplateMenu?.querySelectorAll(".ppt-template-item").forEach(btn => {
  btn.addEventListener("click", () => {
    const key = btn.dataset.template || "intro";
    setPptPrompt(buildHuaweiImagePrompt(key), "image-prompt");
    pptTemplateMenu.classList.remove("open");
    addLog(`已生成「${PPT_TEMPLATE_META[key]?.name || "图片生成"}」prompt`, "info");
  });
});

btnPptxPrompt?.addEventListener("click", () => {
  setPptPrompt(buildImageToPptPrompt(), "pptx-prompt");
  addLog("已生成图片转 PPTX prompt", "info");
});

let pptPromptInputTimer = null;
pptPromptBox?.addEventListener("input", () => {
  clearTimeout(pptPromptInputTimer);
  pptPromptInputTimer = setTimeout(() => { pptPromptKind = "manual"; }, 0);
});

btnPptStart?.addEventListener("click", sendPptPromptToChatGPT);

btnPptSaveMenu?.addEventListener("click", (e) => {
  e.stopPropagation();
  pptTemplateMenu?.classList.remove("open");
  pptSaveMenu?.classList.toggle("open");
});

pptSaveMenu?.querySelectorAll("[data-save-prompt]").forEach(btn => {
  btn.addEventListener("click", () => {
    const kind = btn.dataset.savePrompt;
    const text = pptPromptBox?.value?.trim() || "";
    if (!text) {
      addLog("请先在输入框中填写要保存的 prompt", "error");
      return;
    }
    if (!["copy", "image", "pptx"].includes(kind)) return;
    pptCustomPrompts = { ...pptCustomPrompts, [kind]: text };
    chrome.storage.local.set({ [PPT_CUSTOM_PROMPTS_KEY]: pptCustomPrompts }, () => {
      const label = kind === "copy" ? "文案" : kind === "image" ? "图片" : "PPT";
      addLog(`已保存${label} prompt，下次点击对应按钮会优先使用`, "success");
    });
    pptSaveMenu.classList.remove("open");
  });
});

document.addEventListener("click", (e) => {
  if (pptTemplateMenu?.classList.contains("open")) {
    if (e.target !== btnPptImageMenu && !pptTemplateMenu.contains(e.target)) {
      pptTemplateMenu.classList.remove("open");
    }
  }
  if (pptSaveMenu?.classList.contains("open")) {
    if (e.target !== btnPptSaveMenu && !pptSaveMenu.contains(e.target)) {
      pptSaveMenu.classList.remove("open");
    }
  }
});

// ── 辩论模式切换 ──
let debateMode = "free";
$$(".mode-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    $$(".mode-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    debateMode = btn.dataset.mode;
  });
});

// ── 辩论 ──
btnDebate.addEventListener("click", async () => {
  if (btnDebate.disabled) return;
  if (participants.length < 2) { addLog("至少需要 2 个参与者", "error"); return; }
  const nextRound = getDebateRound() + 1;
  btnDebate.disabled = true; btnDebate.innerHTML = `<span class="btn-spinner"></span> 第${nextRound}轮...`;
  // 重置所有参与者的轮询状态（新一轮开始）
  participants.forEach(p => { p._pollStatus = null; p._textLength = 0; });
  renderParticipants();
  const guidance = guidanceInput?.value?.trim() || "";
  addLog(`第${nextRound}轮辩论${guidance ? " (引导: " + guidance.slice(0, 30) + ")" : ""}`, "info");
  trackDebateRound();
  try {
    const concise = $("#concise-mode")?.checked || false;
    // v4.8.38: needsConfirm 路径 — handleDebateRound 探测到 polling 中的 AI 会先返回提示
    let r = await chrome.runtime.sendMessage({ type: "debateRound", style: debateMode, guidance, concise });
    if (r?.needsConfirm) {
      if (window.confirm(r.message)) {
        r = await chrome.runtime.sendMessage({ type: "debateRound", style: debateMode, guidance, concise, force: true });
      } else {
        addLog(`已取消（${r.pollingNames?.length || 0} 个 AI 仍在回答中）`, "info");
        btnDebate.disabled = false; btnDebate.innerHTML = `开始辩论（第${getDebateRound() + 1}轮）`;
        return;
      }
    }
    if (r?.ok) {
      addLog(`第${nextRound}轮已发送`, "success");
      // Mark non-active participants as ready so poll doesn't hang waiting for them
      if (r.activeIds) {
        participants.forEach(p => {
          if (!r.activeIds.includes(p.id)) {
            p._pollStatus = "ready";
            p._textLength = 0;
          }
        });
      }
      // 刷新状态
      const state = await chrome.runtime.sendMessage({ type: "getState" });
      if (state) { mergeParticipants(state.participants); flowState = state.flowState; }
      renderParticipants();
      if (flowState === "awaiting_responses") startStreamingPoll(r.activeIds || null);
      if (guidance && guidanceInput) guidanceInput.value = "";
    } else addLog(`失败: ${r?.error}`, "error");
  } catch (e) { addLog("失败: " + e.message, "error"); }
  btnDebate.disabled = false; btnDebate.innerHTML = `开始辩论（第${getDebateRound() + 1}轮）`;
});

// ── 辩论重试 ──
btnDebateRetry.addEventListener("click", async () => {
  stopStreamingPoll();
  btnDebate.disabled = false;
  btnDebate.textContent = `开始辩论（第${getDebateRound() + 1}轮）`;
  btnSend.disabled = false;
  btnSend.textContent = "发送给全部";
  await chrome.runtime.sendMessage({ type: "resetSession" });
  addLog("已重置辩论状态，可以重试", "info");
});

// ── 辩论总结 ──
btnSummary.addEventListener("click", async () => {
  const judgeId = judgeSelect.value;
  if (!judgeId) { addLog("请先选择裁判", "error"); return; }
  btnSummary.disabled = true; btnSummary.innerHTML = '<span class="btn-spinner"></span> 总结中...';
  addLog("生成总结...", "info");
  try {
    const r = await chrome.runtime.sendMessage({ type: "summary", judgeId });
    if (r?.ok) { addLog("总结已发送", "success"); startStreamingPoll(); }
    else addLog(`失败: ${r?.error}`, "error");
  } catch (e) { addLog("失败: " + e.message, "error"); }
  btnSummary.disabled = false; btnSummary.innerHTML = '输出总结';
});

// ── 导出 ──
$("#btn-export").addEventListener("click", async () => {
  try {
    const r = await chrome.runtime.sendMessage({ type: "exportSession" });
    if (!r?.ok || !r.markdown) { addLog("无辩论记录可导出", "error"); return; }
    await navigator.clipboard.writeText(r.markdown);
    addLog("辩论记录已复制到剪贴板", "success");
    const blob = new Blob([r.markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai-arena-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    addLog("Markdown 文件已下载", "success");
  } catch (e) { addLog("导出失败: " + e.message, "error"); }
});

// ── 重置 ──
$("#btn-hard-reset").addEventListener("click", async () => {
  for (const p of participants) {
    if (p.tabId) { try { await chrome.tabs.remove(p.tabId); } catch {} }
  }
  await chrome.runtime.sendMessage({ type: "hardReset" });
  stopStreamingPoll();
  participants = [];
  debateSession = {};
  flowState = "idle";
  injectResults = {};
  pendingImages = [];
  pendingFiles = [];
  renderFilePreviews();
  broadcastInput.innerHTML = "";
  btnDebate.textContent = "开始辩论";
  btnSend.disabled = false;
  btnSend.textContent = "发送给全部";
  btnSummary.disabled = false;
  btnSummary.textContent = "输出总结";
  renderParticipants();
  addLog("已彻底重置，所有状态已清除", "success");
});


// ── 统计（本次 + 历史累计） ──
const STATS_KEY = "arena_lifetime_stats";
let lifetimeStats = { conversations: 0, debates: 0, totalChars: 0, models: {} };
let sessionStats = { conversations: 0, debates: 0, totalChars: 0, models: {} };

// 模型品牌色映射
const SERVICE_COLORS = {
  claude: "#d4a574", gemini: "#4285f4", chatgpt: "#10a37f",
  deepseek: "#4d6bfe", doubao: "#ff6a3d", qwen: "#6236ff",
  kimi: "#5b6af0", yuanbao: "#0052d9", grok: "#888888"
};
const SERVICE_NAMES = {
  claude: "Claude", gemini: "Gemini", chatgpt: "GPT",
  deepseek: "DeepSeek", doubao: "豆包", qwen: "千问",
  kimi: "Kimi", yuanbao: "元宝", grok: "Grok"
};
const BRAND_ICONS = {
  claude: "icons/brands/claude.svg", gemini: "icons/brands/gemini.svg",
  chatgpt: "icons/brands/openai.svg", deepseek: "icons/brands/deepseek.svg",
  doubao: "icons/brands/doubao.svg", qwen: "icons/brands/qwen.svg",
  kimi: "icons/brands/kimi.svg", yuanbao: "icons/brands/yuanbao.svg",
  grok: "icons/brands/grok.svg"
};
function brandIcon(service) {
  const src = BRAND_ICONS[service] || "";
  return src ? `<img class="brand-icon" src="${src}" alt="">` : "";
}

// 字数→Token 估算（中文~1.5 token/字，英文~1.3 token/word，取 1.4 均值）
function charsToTokens(chars) { return Math.round(chars * 1.4); }
function fmtTokens(tokens) { return tokens >= 10000 ? (tokens / 10000).toFixed(1) + '万' : tokens.toLocaleString(); }

async function loadStats() {
  const data = await chrome.storage.local.get(STATS_KEY);
  if (data[STATS_KEY]) {
    lifetimeStats = data[STATS_KEY];
    // 兼容旧数据（无 models 字段）
    if (!lifetimeStats.models) lifetimeStats.models = {};
  }
  renderStats();
}

function saveStats() {
  chrome.storage.local.set({ [STATS_KEY]: lifetimeStats });
  renderStats();
}

function renderStats() {
  // 本次
  $("#stat-s-conversations").textContent = sessionStats.conversations;
  $("#stat-s-debates").textContent = sessionStats.debates;
  $("#stat-s-tokens").textContent = fmtTokens(charsToTokens(sessionStats.totalChars));
  // 历史累计
  $("#stat-l-conversations").textContent = lifetimeStats.conversations;
  $("#stat-l-debates").textContent = lifetimeStats.debates;
  $("#stat-l-tokens").textContent = fmtTokens(charsToTokens(lifetimeStats.totalChars));
  // 分模型
  renderPerModelStats();
}

function renderPerModelStats() {
  const listEl = $("#models-list");
  const models = lifetimeStats.models;
  const entries = Object.entries(models);
  if (!entries.length) {
    listEl.innerHTML = '<div class="empty-hint">暂无模型统计数据</div>';
    return;
  }
  // 按 Token 量降序
  entries.sort((a, b) => (b[1].chars || 0) - (a[1].chars || 0));
  const totalChars = entries.reduce((sum, [, v]) => sum + (v.chars || 0), 0);

  listEl.innerHTML = entries.map(([service, data], i) => {
    const tokenCount = charsToTokens(data.chars || 0);
    const rounds = data.rounds || 0;
    const avgPerRound = rounds > 0 ? Math.round(charsToTokens(data.chars || 0) / rounds) : 0;
    const color = SERVICE_COLORS[service] || "#888";
    const name = SERVICE_NAMES[service] || service;
    const pct = totalChars > 0 ? ((data.chars || 0) / totalChars * 100).toFixed(0) : 0;
    const rankClass = i === 0 ? "rank-1" : i === 1 ? "rank-2" : i === 2 ? "rank-3" : "";
  return `<div class="model-row">
      <span class="model-rank ${rankClass}">#${i + 1}</span>
      ${brandIcon(service)}
      <span class="model-name">${name}</span>
      <span class="model-stat"><span class="val">${fmtTokens(tokenCount)}</span> <span class="lbl">总Token</span></span>
      <span class="model-stat"><span class="val">${avgPerRound.toLocaleString()}</span> <span class="lbl">均/轮</span></span>
      <span class="model-stat" style="min-width:34px"><span class="val">${pct}%</span></span>
    </div>`;
  }).join("");
}

// 广播：对话次数 = 参与者数量（每个AI算一次对话）
function trackConversation(participantCount) {
  sessionStats.conversations += participantCount;
  lifetimeStats.conversations += participantCount;
  saveStats();
}
// 辩论：+1 轮（与参与者数无关）
function trackDebateRound() {
  sessionStats.debates++;
  lifetimeStats.debates++;
  saveStats();
}
// 回复字数累加（per-model）
function trackChars(charCount, service) {
  sessionStats.totalChars += charCount;
  lifetimeStats.totalChars += charCount;
  if (service) {
    if (!sessionStats.models[service]) sessionStats.models[service] = { chars: 0, rounds: 0 };
    sessionStats.models[service].chars += charCount;
    sessionStats.models[service].rounds++;
    if (!lifetimeStats.models[service]) lifetimeStats.models[service] = { chars: 0, rounds: 0 };
    lifetimeStats.models[service].chars += charCount;
    lifetimeStats.models[service].rounds++;
  }
  saveStats();
}

// Tab 切换
$$(".stats-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    $$(".stats-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    $("#stats-session").style.display = tab === "session" ? "" : "none";
    $("#stats-lifetime").style.display = tab === "lifetime" ? "" : "none";
    $("#stats-models").style.display = tab === "models" ? "" : "none";
  });
});

loadStats();
loadPptCustomPrompts();

// ── 通知权限 ──
if ("Notification" in window) Notification.requestPermission();

// ── 动态预览浮窗 ──
const dynamicTip = $("#dynamic-tip");

function truncateMiddle(text, maxLen = 300) {
  if (text.length <= maxLen) return text;
  const half = Math.floor((maxLen - 3) / 2);
  return text.slice(0, half) + "\n…\n" + text.slice(-half);
}

function buildBroadcastPreview() {
  let text = broadcastInput.innerText.trim();
  if (!text && !pendingImages.length && !pendingFiles.length) return "（空内容）";
  if (pendingFiles.length > 0) text += pendingFiles.map(f => `\n\n📄 文件: ${f.name}`).join("");
  if (pendingImages.length > 0) text += `\n\n🖼️ ${pendingImages.length}张图片`;
  return truncateMiddle(text, 500);
}

function buildDebatePreview() {
  const round = getDebateRound() + 1;
  const style = debateMode === "free" ? "⚔️ 自由辩论" : "🤝 群策群力";
  const guidance = guidanceInput?.value?.trim();
  const concise = $("#concise-mode")?.checked;
  const readyNames = participants.filter(p => !!p.responsePreview).map(p => p.name);
  let text = `第${round}轮 ${style}\n参与者: ${readyNames.join(", ") || "（无就绪回答）"}`;
  if (guidance) text += `\n引导: ${guidance}`;
  if (concise) text += "\n📏 简洁模式（≤1000字）";
  text += "\n\n各AI将收到其他参与者的回答，并按辩论风格回应";
  return text;
}

let dynamicTipTimer = null;

function showDynamicTip(target, content) {
  clearTimeout(dynamicTipTimer);
  dynamicTip.textContent = content;
  const rect = target.getBoundingClientRect();
  dynamicTip.style.left = Math.max(4, rect.left) + "px";
  dynamicTip.style.top = (rect.top - dynamicTip.offsetHeight - 8) + "px";
  dynamicTip.classList.add("visible");
  requestAnimationFrame(() => {
    dynamicTip.style.top = (rect.top - dynamicTip.offsetHeight - 8) + "px";
  });
}

function hideDynamicTipDelayed() {
  dynamicTipTimer = setTimeout(() => dynamicTip.classList.remove("visible"), 300);
}

function hideDynamicTipNow() {
  clearTimeout(dynamicTipTimer);
  dynamicTip.classList.remove("visible");
}

dynamicTip.addEventListener("mouseenter", () => clearTimeout(dynamicTipTimer));
dynamicTip.addEventListener("mouseleave", hideDynamicTipNow);

btnSend.addEventListener("mouseenter", () => showDynamicTip(btnSend, buildBroadcastPreview()));
btnSend.addEventListener("mouseleave", hideDynamicTipDelayed);
btnDebate.addEventListener("mouseenter", () => showDynamicTip(btnDebate, buildDebatePreview()));
btnDebate.addEventListener("mouseleave", hideDynamicTipDelayed);

// ── 打开群聊窗口 ──
document.getElementById("btn-open-chat")?.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "openChatPopup" }, (resp) => {
    if (chrome.runtime.lastError || !resp?.ok) {
      console.warn("打开群聊失败:", chrome.runtime.lastError);
    }
  });
});

// ── 快捷键 ──
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === "D") { e.preventDefault(); btnDebate.click(); }
});

// ── 主题切换 ──
(function initTheme() {
  const btnTheme = $("#btn-theme");
  const themeMenu = $("#theme-menu");
  if (!btnTheme || !themeMenu) return;

  chrome.storage.local.get("uiTheme", (d) => {
    const theme = d.uiTheme || "C";
    document.body.setAttribute("data-theme", theme);
    updateThemeActive(theme);
  });

  btnTheme.addEventListener("click", (e) => {
    e.stopPropagation();
    themeMenu.classList.toggle("open");
  });

  themeMenu.querySelectorAll(".theme-menu-item").forEach(item => {
    item.addEventListener("click", () => {
      const theme = item.dataset.theme;
      document.body.setAttribute("data-theme", theme);
      chrome.storage.local.set({ uiTheme: theme });
      updateThemeActive(theme);
      themeMenu.classList.remove("open");
    });
  });

  document.addEventListener("click", () => themeMenu.classList.remove("open"));

  function updateThemeActive(theme) {
    themeMenu.querySelectorAll(".theme-menu-item").forEach(i => {
      i.classList.toggle("active", i.dataset.theme === theme);
    });
  }
})();
