// ppt-prompts.js — PPT 工坊 prompt 构建（共享 module，纯函数，无 DOM 依赖）
// 由 background.js importScripts，popup 通过 message `pptBuildPrompt` 调用。
// v4.3.0 新增：把 sidepanel.js 的 PPT 工坊 prompt 生成迁出，让 popup 也能用。

const PPT_TEMPLATE_META = {
  intro: {
    name: "技术介绍",
    title: "技术介绍｜揭示核心原理",
    thesis: "{对象}：基于{核心机制}实现{量化收益/能力提升}",
    angle: "解释一个技术对象为什么有效，核心是'机制可信 + 证据可验证'。",
    layout: "中部放核心机制/架构拆解图，左侧放问题约束，右侧放实验指标或收益，下方用证据条收束。",
    mustInclude: "必须出现机制拆解、关键公式/伪代码/链路图、至少 2 个指标或验证口径。",
    avoid: "不要做成领域全景或宏观趋势页；不要只罗列概念。",
    huaweiSeed: "请生成一页 16:9 华为内部技术评审 PPT 截图风格的效果图。白底、高信息密度、左上红色结论标题、顶部细线、右上可放黄色推进箭头、底部保留页码 / Huawei Confidential。标题写成结论句不要写营销口号。主体采用'问题约束 → 机制拆解 → 实验/指标证据 → 输出收益'的因果链。2-4 个紧凑区域，每框包含小标题、2-4 条短句、指标数字、方法标签或微型图表，文字/标注占框内 70%-90%。"
  },
  topic: {
    name: "技术专题",
    title: "技术专题介绍｜总分形式",
    thesis: "{专题名称}：围绕{关键抓手}突破{核心约束}，{指标}提升{数值}",
    angle: "围绕一个专题做总分式展开，核心是'一个总判断 + 多个正交抓手'。",
    layout: "顶部为红色总论点；中部 3-5 个并列模块；底部用指标/验证/场景条做闭环。",
    mustInclude: "必须出现 3-5 个正交方向、每个方向的目标/方法/指标，以及一条横向贯穿链路。",
    avoid: "不要做成单机制详解；不要让多个模块重复同一维度。",
    huaweiSeed: "请生成一页 16:9 华为内部技术专题 PPT 截图风格的效果图。'上方总判断 + 下方多方向证据'的总分结构。上方用 1 条横向技术链路概括，下方拆成 3-5 个正交方向，每个方向包含目标、方法、指标、证据图四类信息中的至少 3 类。"
  },
  compare: {
    name: "技术对比",
    title: "技术对比｜As-Is / To-Be",
    thesis: "{对象}：从 As-Is 到 To-Be，通过{关键变化}带来{量化收益}",
    angle: "突出从现状到目标态的变化，核心是'差异、路径、收益'。",
    layout: "左侧 As-Is，右侧 To-Be，中间用红色演进箭头连接；底部放 2-3 个证据对比块。",
    mustInclude: "必须出现基线指标、目标指标、关键变化点、红色收益标尺或 before/after 图。",
    avoid: "不要只列优缺点；不要缺少量化前后对比。",
    huaweiSeed: "16:9 华为内部技术对比 PPT 截图风格。左中右结构：左侧 As-Is 现有链路/痛点/基线指标，中间用粗细结合的演进箭头和红色关键变化标注，右侧 To-Be 目标架构/新机制/目标指标。"
  },
  insight: {
    name: "技术洞察",
    title: "技术洞察｜新技术科普",
    thesis: "{技术方向}：{关键变化}驱动{能力演进}，{指标}提升{数值}",
    angle: "解释一个新趋势/新技术为什么重要，核心是'变化原因 + 机制解释 + 场景启发'。",
    layout: "左上放趋势或痛点，中心放机制解释，右侧放能力演进，下方放场景收益矩阵。",
    mustInclude: "必须出现趋势判断、关键机制、应用场景、风险/边界、至少 1 个趋势图或场景矩阵。",
    avoid: "不要做成纯科普文章；不要缺少技术边界和落地场景。",
    huaweiSeed: "16:9 华为内部技术洞察 PPT 截图风格。'约束/痛点 → 技术变化 → 机制解释 → 场景收益'四段横向链路，下方放 2-3 个证据区。"
  },
  landscape: {
    name: "技术全景",
    title: "技术全景｜领域沙盘与演进",
    thesis: "{领域/系统}：按{维度A}/{维度B}/{维度C}正交拆分，支撑{收益}提升至{目标值}",
    angle: "给出一个领域/系统的全局结构，核心是'分层、演进、能力覆盖'。",
    layout: "横向用阶段轴或链路轴，纵向用能力层/数据层/模型层/场景层泳道，中下部放场景和指标块。",
    mustInclude: "必须出现分层结构、关键链路、演进阶段、场景覆盖和 2-4 个指标/能力标签。",
    avoid: "不要做成单点机制页；不要让全景图只有空框和大箭头。",
    huaweiSeed: "16:9 华为内部技术全景 PPT 截图风格的'领域沙盘/演进地图'。横向体现阶段、链路或时间演进，纵向体现能力层/数据层/模型层/场景层。顶部 3 步关键突破，中部主架构/数据链路，下部 3-4 个场景扩展或能力增强证据块。"
  }
};

function buildDiscussionFromContext(ctx) {
  const question = ctx.question || "";
  const responses = (ctx.responses || [])
    .map(r => `【${r.name}】\n${(r.text || "").trim()}`)
    .filter(Boolean)
    .join("\n\n");
  if (question || responses) {
    return [
      question ? `【原始问题】\n${question}` : "",
      responses ? `【AI 讨论摘录】\n${responses}` : ""
    ].filter(Boolean).join("\n\n").slice(0, 24000);
  }
  return "请基于我们前面在本网页中的讨论内容整理 PPT 文案；如果你看不到前文，请先向我索要讨论材料。";
}

function buildCopyPrompt(ctx) {
  const source = buildDiscussionFromContext(ctx || {});
  // v4.5.1: 主体从模板库取，含 {{SOURCE}} 占位符 → 用 ctx 讨论摘录替换
  const store = (typeof self !== "undefined" ? self : globalThis).ArenaTemplateStore;
  const tpl = store ? store.resolve("ppt", "copy") : "";
  if (tpl) {
    const result = tpl.replace(/\{\{SOURCE\}\}/g, source);
    // P1 fix: 用户编辑模板时若误删 {{SOURCE}} 占位，ctx 讨论上下文会静默丢失 → warn
    if (source && source.length > 20 && result === tpl) {
      console.warn("[PptPrompts] buildCopyPrompt: 模板中 {{SOURCE}} 占位符缺失，讨论上下文未被插入。请到右栏 📋 模板 → 📊 PPT 风格 → 文案生成 字段恢复 {{SOURCE}} 或重置该字段。");
    }
    return result;
  }
  // 兜底（store 未 ready）：保留旧硬编码
  return `你是华为风格企业技术汇报 PPT 的内容编译器。请把我们在本 AI Web 网页中已经展开的长期讨论，整理成后续"生成单页 PPT 效果图"可直接使用的"材料池 + 单页视觉 brief"。

当前阶段：第 1 步 / 3 步：文案生成 → 图片生成 → PPT生成
本步只做内容编译，不生成图片，不生成 PPTX，不写代码。

补充摘录：
${source}

请输出 material-pool + slide theses + content slots + 图片生成输入文案。`;
}

function buildImagePrompt(ctx, templateKey) {
  const t = PPT_TEMPLATE_META[templateKey] || PPT_TEMPLATE_META.intro;
  const copy = ctx.imageBrief || buildDiscussionFromContext(ctx || {});
  // v4.5.0: huaweiSeed 优先从用户模板 override 取（templates-builtin.js / template-store.js）
  const store = (typeof self !== "undefined" ? self : globalThis).ArenaTemplateStore;
  const fieldKey = PPT_TEMPLATE_META[templateKey] ? templateKey : "intro";
  const userSeed = store ? store.resolve("ppt", fieldKey) : "";
  const seed = userSeed || t.huaweiSeed;
  return `你是华为风格企业技术汇报 PPT 的视觉生成器。请把前面已经形成的 PPT 文案，转化为一页 16:9 华为内部技术评审 PPT 效果图。

当前阶段：第 2 步 / 3 步：文案生成 → 图片生成 → PPT生成

补充生图内容：
${copy}

选定模板：${t.title}

模板风格与版式规则：
${seed}

本模板的差异化任务：
- 叙事角度：${t.angle}
- 版式骨架：${t.layout}
- 必须包含：${t.mustInclude}
- 避免误用：${t.avoid}

视觉硬约束：
- 页眉：左上红色结论标题（参考标题格式：${t.thesis}），顶部红/灰细线，右上可放小黄色推进箭头。
- 页脚：左下小页码，中间可放 Huawei Confidential 或 HUAWEI TECHNOLOGIES CO., LTD.。
- 结构：页面由 2-4 个主要区域组成，使用细灰线、浅灰底板、黑色虚线框分区，保持模板 ${t.name} 的版式骨架。
- 信息纹理：混合使用小型图表、公式、热力图、矩阵、微型架构图、表格、标注、箭头。
- 配色：华为红 #CC0000 用于标题/结论/增益；中蓝 #005691 用于技术模块；浅灰 #F2F2F2 用于底板；黄色只用于推进箭头或局部高亮。

最终只生成图像，不要输出解释文字。`;
}

// v5.2.4: "我全都要" — 让 AI 一次输出 5 种风格的 5 张华为风 PPT 预览图
function buildAllImagePrompt(ctx) {
  const copy = ctx.imageBrief || buildDiscussionFromContext(ctx || {});
  const styleLines = Object.entries(PPT_TEMPLATE_META).map(([key, t], i) => {
    return `${i + 1}. **${t.title}**\n   - 叙事角度：${t.angle}\n   - 版式骨架：${t.layout}\n   - 必须包含：${t.mustInclude}`;
  }).join("\n\n");
  return `你是华为风格企业技术汇报 PPT 的视觉生成器。请把前面已经形成的 PPT 文案，**一口气生成 5 张 16:9 华为内部技术评审 PPT 效果图**，每张对应以下 5 种不同的风格 / 版式：

${styleLines}

补充生图内容：
${copy}

视觉硬约束（5 张图通用）：
- 页眉：左上红色结论标题，顶部红/灰细线，右上可放小黄色推进箭头
- 页脚：左下小页码，中间放 Huawei Confidential 或 HUAWEI TECHNOLOGIES CO., LTD.
- 配色：华为红 #CC0000 / 中蓝 #005691 / 浅灰 #F2F2F2，黄色仅作推进箭头或局部高亮
- 信息纹理：每张图混合使用小型图表、公式、热力图、矩阵、微型架构图、表格、标注、箭头；文字/标注占框内 70%-90%
- 5 张图风格<strong>必须显著不同</strong>，不能用同一套版式贴 5 次标签

输出要求：
- 按风格 1 → 风格 5 顺序依次输出 5 张图，每张独立成块
- 每张图前用一行小字标注"风格 N · 模板名"
- 最终只生成图像，不要输出解释文字`;
}

function buildPptxPrompt() {
  // v4.5.1: 从模板库取（用户可在 📋 模板 → 📊 PPT 风格 → PPT 生成 字段编辑）
  const store = (typeof self !== "undefined" ? self : globalThis).ArenaTemplateStore;
  const tpl = store ? store.resolve("ppt", "pptx") : "";
  if (tpl) return tpl;
  // 兜底
  return `你是图片转 PowerPoint 的语义重建工程师。请将我们刚生成的 PPT 效果图，或我随后上传的 PNG/JPG，重建为一份可编辑的 PowerPoint PPTX。视觉 1:1 优先 + 文字/表格/图表用 native 对象覆盖。`;
}

// 全局暴露给 background.js importScripts 后使用
self.PptPrompts = {
  TEMPLATE_META: PPT_TEMPLATE_META,
  buildCopyPrompt,
  buildImagePrompt,
  buildAllImagePrompt,
  buildPptxPrompt,
  buildDiscussionFromContext,
};
