// debate-engine.js — 辩论轮次编排、prompt 组装
// v4.5.0: prompt 主体来自 ArenaTemplateStore（用户可在模板库编辑/重置）

// 保留 DEBATE_STYLES 仅用于"中文名显示"（buildSummaryPrompt 里展示历史轮次时引用 style.name）
const DEBATE_STYLES = {
  free:   { name: "自由辩论" },
  collab: { name: "群策群力" }
};

function _store() {
  return (typeof self !== "undefined" ? self : globalThis).ArenaTemplateStore;
}

// v5.0.19: 上下文压缩（用户开关，默认关）— 多轮辩论转发队友回答全文会让单次请求
//   上传量到 10-20k 字，偶发触发公司网关上传限额 → 发送失败/掉线。
//   策略与存储压缩同款：头 75% + 尾部 + 中文省略标记，AI 知道中段被省略。
const RELAY_PER_TEAMMATE_CHARS = 3000;   // 单个队友回答转发上限
const RELAY_TOTAL_BUDGET_CHARS = 8000;   // 全部队友合计预算（超出则均分收紧）
const RELAY_MIN_PER_TEAMMATE_CHARS = 800;

function compactTextForRelay(text, maxChars) {
  if (typeof text !== "string" || text.length <= maxChars) return text;
  const head = Math.max(0, Math.floor(maxChars * 0.75));
  const tail = Math.max(0, maxChars - head - 60);
  // tail=0 时 slice(-0) 会返回全文（slice(0) 语义），必须单独处理
  if (tail === 0) return `${text.slice(0, head)}\n……（后续 ${text.length - head} 字已省略）……`;
  return `${text.slice(0, head)}\n……（中间省略 ${text.length - head - tail} 字，要点见首尾）……\n${text.slice(-tail)}`;
}

const DebateEngine = {
  // compress = v5.0.19: true 时按预算压缩队友回答（设置 tab「上下文压缩」开关 / 压缩后补发）
  buildDebatePrompt(participantId, responses, style, roundNum, guidance, concise, compress) {
    const isCollab = style === "collab";
    const binding = isCollab ? "debate.collab" : "debate.free";
    const store = _store();

    // 主提示来自模板（用户可改）
    const mainPrompt = store ? store.resolve(binding, "main") : "";

    // 轮次引导：R1/R2/R3 直接读模板；R4+ 用一个动态 fallback
    let roundHint;
    if (roundNum >= 1 && roundNum <= 3) {
      roundHint = store ? store.resolve(binding, "r" + roundNum) : "";
    } else {
      roundHint = isCollab
        ? `这是第${roundNum}轮协作。请只补充新的见解，不要重复已有内容。`
        : `这是第${roundNum}轮辩论。请只针对仍有分歧的核心问题发表精炼观点。`;
    }

    const conciseRule = concise
      ? "\n\n⚠️ 简洁模式：请控制回答在 1000 字以内，用要点列表呈现核心观点，避免长篇大论。每个论点简明扼要。"
      : "";

    const entries = Object.entries(responses)
      .filter(([id, r]) => id !== participantId && r.text);
    let relayCap = Infinity;
    if (compress && entries.length) {
      relayCap = RELAY_PER_TEAMMATE_CHARS;
      const projected = entries.reduce((sum, [, r]) => sum + Math.min(r.text.length, relayCap), 0);
      if (projected > RELAY_TOTAL_BUDGET_CHARS) {
        relayCap = Math.max(RELAY_MIN_PER_TEAMMATE_CHARS, Math.floor(RELAY_TOTAL_BUDGET_CHARS / entries.length));
      }
    }
    const contextText = entries
      .map(([, r]) => `【${r.name} 的回答】:\n${compress ? compactTextForRelay(r.text, relayCap) : r.text}`)
      .join("\n\n");

    let prompt = `${roundHint}\n\n${mainPrompt}\n\n${contextText}${conciseRule}`;
    if (guidance) prompt = `用户补充要求：${guidance}\n\n${prompt}`;
    return prompt;
  },

  // v4.4.1: 文本版 prompt（老格式 markdown 散文）— "输出文本总结"按钮用
  // v4.5.1: 后半段（## 共识结论 / 分歧 / 裁定 / 建议 / 标注规则）改为从模板库取，
  //         可在右栏 📋 模板 → ⚖️ 裁判总结 → 文本总结 字段编辑/重置。
  buildSummaryPromptText(originalQuestion, rounds, responses, customInstruction) {
    const allText = Object.values(responses)
      .filter(r => r.text)
      .map(r => `【${r.name} 的观点】:\n${r.text}`)
      .join("\n\n");

    const header = `你是一场多 AI 辩论的最终裁判。${originalQuestion ? `原始问题是：「${originalQuestion}」\n` : ""}以下是各 AI 经过 ${rounds.length} 轮辩论的最终观点：

${allText}

`;

    const store = _store();
    const instruction = store ? store.resolve("summary", "instruction_text") : "";

    let prompt = header + instruction;
    if (customInstruction?.trim()) prompt += `\n\n## 额外要求\n${customInstruction.trim()}`;
    return prompt;
  },

  // v4.5.0: 裁判指令（JSON schema 部分）来自模板（用户可改）；
  //         前置 header（"你是..." + 问题 + 历史 + 各 AI 观点）保持硬编码
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

    const participantNames = Object.values(responses).filter(r => r.name).map(r => r.name).join(" / ");

    const header = `你是一场多 AI 辩论的最终裁判。${originalQuestion ? `原始问题是：「${originalQuestion}」\n` : ""}以下是各 AI（${participantNames}）的讨论记录（经过 ${rounds.length} 轮辩论）。
${historySection}
${allText}

`;

    const store = _store();
    const instruction = store ? store.resolve("summary", "instruction_json") : "";

    let prompt = header + instruction;
    if (customInstruction?.trim()) prompt += `\n\n额外要求：${customInstruction.trim()}`;
    return prompt;
  }
};

// v4.5.0: 显式挂载到全局，方便 worker.evaluate 注入代码访问
(typeof self !== "undefined" ? self : globalThis).DebateEngine = DebateEngine;
(typeof self !== "undefined" ? self : globalThis).DEBATE_STYLES = DEBATE_STYLES;
// v5.0.19: 暴露给单测
(typeof self !== "undefined" ? self : globalThis).compactTextForRelay = compactTextForRelay;
