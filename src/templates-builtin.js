// templates-builtin.js — 内置任务模板的默认数据（纯数据，无依赖）
// 被 background.js importScripts 和 popup.html 直接 <script> 加载
// 用户的覆盖存在 chrome.storage.local["arena_templates_v1"].overrides[binding][fieldKey]
// resolve 顺序：override?.[fieldKey] ?? builtin field.value

(function (root) {
  const BUILTIN = {
    "debate.free": {
      binding: "debate.free",
      emoji: "⚔️",
      name: "辩论 · 自由",
      category: "辩论",
      fields: [
        {
          key: "main",
          label: "主提示",
          value: "以下是其他 AI 对同一问题的回答，请分析他们的观点，指出你认同和不认同的地方，并给出你的改进回答。"
        },
        {
          key: "r1",
          label: "第 1 轮引导",
          value: "这是第1轮辩论。请仔细阅读其他参与者的初始回答，找出核心分歧和共识。"
        },
        {
          key: "r2",
          label: "第 2 轮引导",
          value: "这是第2轮辩论。经过上一轮交锋，请聚焦于仍存在分歧的关键点，深化你的论证或修正你的观点。"
        },
        {
          key: "r3",
          label: "第 3 轮引导",
          value: "这是第3轮辩论。辩论已进入深水区，请避免重复已达成共识的内容，集中攻克剩余分歧点，给出最终立场。"
        }
      ]
    },
    "debate.collab": {
      binding: "debate.collab",
      emoji: "🤝",
      name: "辩论 · 群策群力",
      category: "辩论",
      fields: [
        {
          key: "main",
          label: "主提示",
          value: "以下是你的队友们对同一问题的回答。你们是协作关系，目标是共同得出最优方案。请：1) 吸收队友回答中的亮点和你没想到的角度；2) 补充你认为队友遗漏的重要内容；3) 整合所有人的优势，给出一个更完善的综合回答。不要攻击或否定队友，而是取长补短。"
        },
        {
          key: "r1",
          label: "第 1 轮引导",
          value: "这是第1轮协作。请仔细阅读队友们的回答，找出各自的亮点和你没想到的角度。"
        },
        {
          key: "r2",
          label: "第 2 轮引导",
          value: "这是第2轮协作。队友们已经互相补充了一轮，请在此基础上进一步整合，查漏补缺。"
        },
        {
          key: "r3",
          label: "第 3 轮引导",
          value: "这是第3轮协作。方案已趋于成熟，请做最终打磨——精简冗余，强化核心结论，形成一份完整方案。"
        }
      ]
    },
    "summary": {
      binding: "summary",
      emoji: "⚖️",
      name: "裁判总结",
      category: "总结",
      // 说明：buildSummaryPrompt / buildSummaryPromptText 会在此字段前自动拼接
      //       "你是一场多 AI 辩论的最终裁判 + 问题 + 历史 + 各 AI 观点"的固定 header。
      // 用户编辑这里 = 调整裁判的输出格式 / schema / 严格要求。
      // 两个字段对应两种总结模式：JSON（学术 HTML 报告）+ Text（散文 markdown）
      fields: [
        {
          key: "instruction_json",
          label: "JSON 总结（学术 HTML 报告）",
          value: `请你作为裁判，**直接输出一份 JSON**（不要任何前言/后言/markdown 标记，仅 JSON）按以下 schema：

\`\`\`json
{
  "topic": "辩论的核心命题（精炼成一句话）",
  "core_conclusion": "整场辩论得出的一句话核心结论（150 字以内，是这次辩论最值得带走的认知）",
  "consensus": [
    "共识 1（各方都同意的具体观点，30-80 字）",
    "共识 2"
  ],
  "disagreements": [
    "分歧 1（仍有明确不同立场的点，30-80 字）",
    "分歧 2"
  ],
  "open_questions": [
    "待证 1（辩论中提出但未答的问题，30-80 字）"
  ],
  "key_arguments": [
    {
      "title": "关键论点 1 的命题（如 'Scaling Law 已撞墙'）",
      "supports": [
        { "ai": "Claude", "text": "Claude 支持该论点的核心理由（30-60 字）" }
      ],
      "opposes": [
        { "ai": "Gemini", "text": "Gemini 反对/不同视角的核心理由" }
      ]
    }
  ],
  "highlights": [
    { "ai": "Claude", "text": "整场最精彩的一句引用（原话或浓缩）", "round": 4 }
  ],
  "next_steps": [
    "后续可继续思考的方向 1（具体可行动，30-80 字）"
  ],
  "rounds": [
    {
      "num": 1,
      "title": "本轮的子主题（如 '初始立场' / 'Scaling Law 之争'）",
      "voices": [
        { "ai": "Claude", "text": "Claude 在本轮的核心观点（30-60 字浓缩）" },
        { "ai": "Gemini", "text": "..." }
      ]
    }
  ]
}
\`\`\`

**严格要求**：
1. **整个输出必须是一段合法 JSON**，不要加 \`\`\`json 围栏、不要前言"好的"/"以下是"、不要后续解释
2. AI 名字用前面给出的参与者名字（数组里就用这些字符串）
3. consensus / disagreements / open_questions 数组各 1-5 条
4. key_arguments 数组 2-4 条（最有代表性的论点）
5. highlights 数组 2-4 条（最精彩的引用）
6. next_steps 数组 2-5 条（具体可行动方向）
7. rounds 数组对应实际辩论的每一轮，voices 数组覆盖该轮发言的所有 AI
8. 所有字段必须填充，没有内容就给空数组 []`
        },
        {
          key: "instruction_text",
          label: "文本总结（老版散文 markdown）",
          value: `请你作为裁判，给出结构化的最终总结：

## 共识结论
各方一致认同的核心观点

## 分歧焦点
仍存在争议的地方，列出各方立场

## 最终裁定
综合各方观点后，你认为最准确、最完整的结论是什么

## 实操建议
基于以上讨论，给出可落地的建议

## 标注规则
请对每个结论标注共识度：
- 🟢 全员共识：所有参与者都明确支持此观点
- 🟡 多数认同：多数参与者支持，少数持保留意见
- 🔴 存在争议：参与者之间有明确分歧，列出各方立场
- 💡 独家洞察：仅一方提出但有价值的独特视角

要求：客观公正，不偏袒任何一方，重点是综合各家之长得出最优答案。`
        }
      ]
    },
    "ppt": {
      binding: "ppt",
      emoji: "📊",
      name: "PPT 风格",
      category: "PPT",
      // 说明：前 5 个字段（intro/topic/compare/insight/landscape）= 第 2 步"图片生成"的 huaweiSeed
      //       copy = 第 1 步"文案生成"完整 prompt（含 {{SOURCE}} 占位符表示讨论上下文插入点）
      //       pptx = 第 3 步"PPT 生成"完整 prompt（纯静态，无占位符）
      fields: [
        {
          key: "intro",
          label: "图片生成 · 技术介绍",
          value: "请生成一页 16:9 华为内部技术评审 PPT 截图风格的效果图。白底、高信息密度、左上红色结论标题、顶部细线、右上可放黄色推进箭头、底部保留页码 / Huawei Confidential。标题写成结论句不要写营销口号。主体采用'问题约束 → 机制拆解 → 实验/指标证据 → 输出收益'的因果链。2-4 个紧凑区域，每框包含小标题、2-4 条短句、指标数字、方法标签或微型图表，文字/标注占框内 70%-90%。"
        },
        {
          key: "topic",
          label: "图片生成 · 技术专题",
          value: "请生成一页 16:9 华为内部技术专题 PPT 截图风格的效果图。'上方总判断 + 下方多方向证据'的总分结构。上方用 1 条横向技术链路概括，下方拆成 3-5 个正交方向，每个方向包含目标、方法、指标、证据图四类信息中的至少 3 类。"
        },
        {
          key: "compare",
          label: "图片生成 · 技术对比",
          value: "16:9 华为内部技术对比 PPT 截图风格。左中右结构：左侧 As-Is 现有链路/痛点/基线指标，中间用粗细结合的演进箭头和红色关键变化标注，右侧 To-Be 目标架构/新机制/目标指标。"
        },
        {
          key: "insight",
          label: "图片生成 · 技术洞察",
          value: "16:9 华为内部技术洞察 PPT 截图风格。'约束/痛点 → 技术变化 → 机制解释 → 场景收益'四段横向链路，下方放 2-3 个证据区。"
        },
        {
          key: "landscape",
          label: "图片生成 · 技术全景",
          value: "16:9 华为内部技术全景 PPT 截图风格的'领域沙盘/演进地图'。横向体现阶段、链路或时间演进，纵向体现能力层/数据层/模型层/场景层。顶部 3 步关键突破，中部主架构/数据链路，下部 3-4 个场景扩展或能力增强证据块。"
        },
        {
          key: "copy",
          label: "文案生成（材料池）",
          // {{SOURCE}} 占位符：buildCopyPrompt 会替换为讨论摘录
          value: `你是华为风格企业技术汇报 PPT 的内容编译器。请把我们在本 AI Web 网页中已经展开的长期讨论，整理成后续"生成单页 PPT 效果图"可直接使用的"材料池 + 单页视觉 brief"。

当前阶段：第 1 步 / 3 步：文案生成 → 图片生成 → PPT生成
本步只做内容编译，不生成图片，不生成 PPTX，不写代码。

上下文使用方式：
- 默认你已经能看到本网页上方几十轮讨论、AI 回复和我补充的追问，请优先基于"我们的讨论内容"进行整理。
- 下面的"补充摘录"只是为了防止网页上下文遗漏；如果它和上文不一致，以上文最近讨论为准。
- 不要把本条 prompt、按钮名称、工作流说明当成 PPT 内容主题；它们只是操作指令。
- 如果你完全看不到上文，也无法从补充摘录判断主题，请先向我索要讨论材料，不要凭空编造。

补充摘录：
{{SOURCE}}

核心目标：
1. 先建立高密度 material-pool，再确定 slide thesis、template fit、content slots、word-budget、negative constraints。
2. 把几十轮讨论压缩成"单页华为式技术评审图"需要的高密度材料。
3. 为后续 5 类模板都准备可选择的论点和内容槽，但最后给出一段最推荐的【图片生成输入文案】。

生成要求：
1. 先生成 5000-10000 字【material-pool 内容素材池】。
2. material-pool 至少覆盖：背景与问题、用户目标、对象定义、关键机制、技术路线、对比维度、数据指标、证据链、风险约束、应用场景、落地路径、反方观点、可视化元素。
3. 生成【template fit / scenario pick】：对 5 个模板逐一评分，说明推荐模板和备用模板。
4. 生成【candidate slide theses】：3-5 个结论型标题。
5. 生成【recommended content slots】：3-5 个主模块。
6. 最后输出【图片生成输入文案】：500-900 字。

请严格按以下结构输出：
【0. User brief】
【1. material-pool 内容素材池：5000-10000字】
【2. 共识 / 分歧 / 待验证假设】
【3. template fit / scenario pick】
【4. candidate slide theses】
【5. content slots + word-budget】
【6. negative constraints】
【7. 图片生成输入文案】`
        },
        {
          key: "pptx",
          label: "PPT 生成（语义重建）",
          value: `你是图片转 PowerPoint 的语义重建工程师。请将我们刚生成的 PPT 效果图，或我随后上传的 PNG/JPG，重建为一份可编辑的 PowerPoint PPTX。

当前阶段：第 3 步 / 3 步：文案生成 → 图片生成 → PPT生成

重建原则：
- 视觉 1:1 优先：先保持上一步效果图的整体视觉、布局、层级、配色、密度和 Huawei 技术评审页质感。
- 再恢复可编辑性：标题、正文、表格、图表标签、流程节点、指标数字、箭头尽量使用 PowerPoint 原生对象。
- 可采用"视觉优先 + 可编辑对象覆盖"的混合重建：必要时用小面积 PNG/SVG fallback 保住复杂纹理。
- 如果可以执行文件生成，请按闭环思路完成：源图 → 结构化页面规格 → PPTX → 渲染预览 → 评分 → 差异修正。

重建流程：
1. 识别语义结构：标题区、页眉页脚、主模块、证据图、表格/图表、流程箭头、指标标签。
2. 为每个语义单元建立对象清单，标注 role、bbox、style、native text / native shape / native chart / small fallback。
3. 元素路由：标题、正文、表格、图表轴/标签为 whitelist 必须 native；小箭头、徽标可 native 或小 fallback；复杂纹理、微小 logo 可 fallback。
4. 按视觉层级重建：背景与分区 → 主体模块 → 图表/流程 → 文字与指标 → 标注与细节。
5. 中文字体优先使用微软雅黑；英文和数字使用 Arial。
6. fallback 图片总面积尽量控制在 5% 以内。

交付要求：
- 如果可以直接生成文件，请输出 PPTX。
- 必须检查中文文本是否乱码或异常问号。
- 如果当前环境不能直接产出 PPTX，请先输出可执行的重建方案、对象清单、页面尺寸、颜色/字体规范。`
        }
      ]
    },

    // ============================================================
    // v4.5.2: 场景预设 — 不绑定任务按钮，单击直接插入输入框（clickAction="insert"）
    // 用户可编辑 / 重置 / 不可删
    // ============================================================
    "scenario.literature": {
      binding: "scenario.literature",
      emoji: "📚",
      name: "文献调研",
      category: "场景",
      clickAction: "insert",
      fields: [
        {
          key: "main",
          label: "文献调研开场",
          value: `请帮我做一次文献调研。

研究主题：[在这里填写你想调研的主题]
时间范围：近 3 年
我的背景：[简述你的领域 / 角色 / 已知什么]

请覆盖：
1. 该领域的核心论文（5-10 篇标志性工作，每篇 1-2 句话说为什么重要）
2. 主流技术路线 / 学派对比（用表格列）
3. 当前 SOTA（state-of-the-art）+ 开源实现链接
4. 仍未解决的关键挑战（3-5 个）
5. 给我一份推荐入门顺序（先读什么、再读什么、最后读什么）

要求：客观、有证据、避免泛泛而谈；引用具体论文标题 + 年份 + 作者。`
        }
      ]
    },
    "scenario.idea": {
      binding: "scenario.idea",
      emoji: "💡",
      name: "创新孵化",
      category: "场景",
      clickAction: "insert",
      fields: [
        {
          key: "main",
          label: "Idea 讨论开场",
          value: `我有一个 idea 想跟你们一起打磨：

[在这里描述你的 idea：要解决什么问题 / 核心思路 / 当前进展]

请你们扮演不同的角色帮我审视：
- 第一位：提出最关键的质疑（哪里没想清楚？最容易失败的点是什么？）
- 第二位：补充落地方案（最小 MVP 怎么做？需要哪些资源 / 团队 / 时间？里程碑怎么切？）
- 第三位：指出市场 / 竞品（已经有谁在做？我们的差异化壁垒在哪？为什么这个时机做？）

最后请综合给一个明确的 GO / NO-GO / PIVOT 建议 + 下一步 3 个具体行动。

要求：尖锐、具体、可执行；避免礼貌性表扬，我要的是真问题。`
        }
      ]
    },

    // ============================================================
    // v4.6.0: 角色帽 — 通用 5 顶（参考 Hub 群聊职责帽机制）
    // 模板库里 clickAction="preview"（展开预览/编辑）
    // 成员栏里独立 UI 触发 → 选 AI → 拼 prompt 入输入框（popup-role-hats.js）
    // ============================================================
    "role.clarifier": {
      binding: "role.clarifier",
      emoji: "❓",
      name: "问题澄清员",
      category: "角色帽",
      fields: [
        { key: "duty",   label: "职责",     value: "负责拆解用户问题、补齐前提、指出会改变答案的关键缺口；不要直接替其他角色下结论。" },
        { key: "format", label: "输出格式", value: "问题拆解 / 已知前提 / 缺失信息 / 关键追问 / 默认假设" }
      ]
    },
    "role.fact_check": {
      binding: "role.fact_check",
      emoji: "🔍",
      name: "事实核验员",
      category: "角色帽",
      fields: [
        { key: "duty",   label: "职责",     value: "负责核验关键事实、数字、引用、时间点与来源；不确定内容必须明确标注「未核验」。" },
        { key: "format", label: "输出格式", value: "已确认事实 / 来源与时间 / 不确定项 / 冲突口径 / 需补查" }
      ]
    },
    "role.critic": {
      binding: "role.critic",
      emoji: "⚠️",
      name: "反方挑战者",
      category: "角色帽",
      fields: [
        { key: "duty",   label: "职责",     value: "负责寻找遗漏、反例、逻辑跳跃和失败路径；避免复述方案优点，避免礼貌性表扬。" },
        { key: "format", label: "输出格式", value: "最大风险 / 反例 / 隐含假设 / 失败信号 / 修正建议" }
      ]
    },
    "role.judge": {
      binding: "role.judge",
      emoji: "🎯",
      name: "综合裁判",
      category: "角色帽",
      fields: [
        { key: "duty",   label: "职责",     value: "负责收敛共识与分歧、给可执行结论和取舍理由；不做无差别折中，不和稀泥。" },
        { key: "format", label: "输出格式", value: "结论 / 取舍理由 / 主要分歧 / 决策条件 / 下一步" }
      ]
    },
    "role.action": {
      binding: "role.action",
      emoji: "✅",
      name: "行动拆解员",
      category: "角色帽",
      fields: [
        { key: "duty",   label: "职责",     value: "负责把结论拆成下一步动作、负责人、验证方式和截止条件；不要再做分析，只输出 actionable 项。" },
        { key: "format", label: "输出格式", value: "下一步 / 优先级 / 负责人或角色 / 验证标准 / 截止条件" }
      ]
    },

    "scenario.code_review": {
      binding: "scenario.code_review",
      emoji: "🔍",
      name: "代码审视",
      category: "场景",
      clickAction: "insert",
      fields: [
        {
          key: "main",
          label: "代码审视开场",
          value: `请帮我审视下面这段代码：

\`\`\`
[在这里粘贴代码]
\`\`\`

上下文：[这段代码做什么 / 在哪里被调用 / 已知的约束]

请覆盖：
1. 正确性：有没有 bug、边界条件遗漏、异常处理缺失、并发 / 异步陷阱
2. 性能：复杂度是否合理、有没有明显瓶颈、内存 / IO 模式是否健康
3. 可读性：命名 / 结构 / 注释是否清晰、能否一眼看懂意图
4. 安全：注入 / 越界 / 敏感信息泄漏 / 输入验证缺失
5. 改进建议：给我 3 个最有 ROI 的修改（按收益 / 成本排序），每个附最小 diff

要求：直接指出问题代码位置 + 行号；避免空泛建议；如果代码本身没大问题就明确说"这段没大问题"，不要为了凑数硬挑刺。`
        }
      ]
    }
  };

  // self 在 SW 中是 ServiceWorkerGlobalScope，在 popup 中是 window
  root.ArenaBuiltinTemplates = BUILTIN;
})(typeof self !== "undefined" ? self : window);
