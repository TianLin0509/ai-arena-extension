// debate-engine.js — 辩论轮次编排、prompt 组装

// ── 标记协议（每轮唯一，防止跨轮污染） ──
function nextMarkerRound() { StateMachine.markerRound++; StateMachine.save(); return StateMachine.markerRound; }
function currentStartMarker() { return `ARENA_START_R${StateMachine.markerRound}`; }
function currentDoneMarker() { return `ARENA_DONE_R${StateMachine.markerRound}`; }
function buildMarkerInstruction() {
  return `\n（请在回答的最开头输出 ${currentStartMarker()}，最末尾输出 ${currentDoneMarker()} 作为标记，不要解释这些标记）`;
}
function stripMarkers(text) {
  return text.replace(/ARENA_START_R\d+/g, '').replace(/ARENA_DONE_R\d+/g, '').trim();
}

const DEBATE_STYLES = {
  free: { name: "自由辩论", prompt: "以下是其他 AI 对同一问题的回答，请分析他们的观点，指出你认同和不认同的地方，并给出你的改进回答。" },
  collab: { name: "群策群力", prompt: "以下是你的队友们对同一问题的回答。你们是协作关系，目标是共同得出最优方案。请：1) 吸收队友回答中的亮点和你没想到的角度；2) 补充你认为队友遗漏的重要内容；3) 整合所有人的优势，给出一个更完善的综合回答。不要攻击或否定队友，而是取长补短。" },
};

const DebateEngine = {
  buildDebatePrompt(participantId, responses, style, roundNum, guidance, concise) {
    const styleConfig = DEBATE_STYLES[style] || DEBATE_STYLES.free;
    const isCollab = style === "collab";

    const roundHints = isCollab ? {
      1: "这是第1轮协作。请仔细阅读队友们的回答，找出各自的亮点和你没想到的角度。",
      2: "这是第2轮协作。队友们已经互相补充了一轮，请在此基础上进一步整合，查漏补缺。",
      3: "这是第3轮协作。方案已趋于成熟，请做最终打磨——精简冗余，强化核心结论，形成一份完整方案。",
    } : {
      1: "这是第1轮辩论。请仔细阅读其他参与者的初始回答，找出核心分歧和共识。",
      2: "这是第2轮辩论。经过上一轮交锋，请聚焦于仍存在分歧的关键点，深化你的论证或修正你的观点。",
      3: "这是第3轮辩论。辩论已进入深水区，请避免重复已达成共识的内容，集中攻克剩余分歧点，给出最终立场。",
    };

    const defaultHint = isCollab
      ? `这是第${roundNum}轮协作。请只补充新的见解，不要重复已有内容。`
      : `这是第${roundNum}轮辩论。请只针对仍有分歧的核心问题发表精炼观点。`;
    const roundHint = roundHints[roundNum] || defaultHint;

    const conciseRule = concise
      ? "\n\n⚠️ 简洁模式：请控制回答在 1000 字以内，用要点列表呈现核心观点，避免长篇大论。每个论点简明扼要。"
      : "";

    const othersText = Object.entries(responses)
      .filter(([id, r]) => id !== participantId && r.text)
      .map(([, r]) => `【${r.name} 的回答】:\n${r.text}`)
      .join("\n\n");

    let prompt = `${roundHint}\n\n${styleConfig.prompt}\n\n${othersText}${conciseRule}`;
    if (guidance) prompt = `用户补充要求：${guidance}\n\n${prompt}`;
    return prompt + buildMarkerInstruction();
  },

  buildSummaryPrompt(originalQuestion, rounds, responses, customInstruction) {
    let historySection = "";
    if (rounds.length > 0) {
      historySection = "\n\n## 辩论历史摘要\n";
      for (const round of rounds) {
        historySection += `\n### 第${round.roundNum}轮（${DEBATE_STYLES[round.style]?.name || round.style}）\n`;
        if (round.guidance) historySection += `用户引导：${round.guidance}\n`;
      }
      historySection += "\n（以上为辩论过程，以下为各方最终观点）\n";
    }

    const allText = Object.values(responses)
      .filter(r => r.text)
      .map(r => `【${r.name} 的观点】:\n${r.text}`)
      .join("\n\n");

    let prompt = `你是一场多 AI 辩论的最终裁判。${originalQuestion ? `原始问题是：「${originalQuestion}」\n` : ""}以下是各 AI 的讨论记录（经过 ${rounds.length} 轮辩论）。
${historySection}
${allText}

请你作为裁判，给出结构化的最终总结：

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

要求：客观公正，不偏袒任何一方，重点是综合各家之长得出最优答案。`;

    if (customInstruction?.trim()) prompt += `\n\n## 额外要求\n${customInstruction.trim()}`;
    return prompt + buildMarkerInstruction();
  },

  buildContextForkPrompt(history) {
    return `请将以下对话历史压缩成一段简洁的"上下文接力摘要"，供我粘贴到新的对话窗口继续讨论。

要求：
1. 保留所有关键结论、决策、代码片段、专有名词
2. 去掉寒暄、重复、废话
3. 输出格式：先一句话说明"我们在讨论什么"，再用要点列出关键信息，最后一句"请在此基础上继续"
4. 总长度控制在 500 字以内
5. 只输出摘要本身，不要加任何解释

对话历史如下：

${history.trim()}`;
  },

  buildOptimizePrompt(text) {
    return `请优化以下 prompt，使其更清晰、更具体、更能引导出高质量回答。只输出优化后的 prompt，不需要解释：

原始 prompt：
${text}`;
  }
};
