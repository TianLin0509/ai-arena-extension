// AI Arena — 🪄 AI接力棒 meta-prompt 模板（v4.9.1）
// 让浓缩官 AI 把当前对话压成「给新 AI 看的接棒简报」
// 跟裁判总结的关键差异：目标读者是 AI 不是人 → 紧凑、结构化、可直接喂入
(function () {
  const STANCE_HINT = {
    neutral: "中立旁观，不偏向任何一方",
    "pro-current": "继承当前讨论中略占上风的立场",
    contrarian: "鼓励新人提出反方观点，挑战现有共识",
  };

  function buildBatonMetaPrompt({ length = 500, stance = "neutral", transcript = "" } = {}) {
    const stanceHint = STANCE_HINT[stance] || STANCE_HINT.neutral;
    return `你正在阅读一场多 AI 辩论的现场记录（见下方对话原文）。
请生成一份「接棒简报」—— 给即将加入这场辩论的一个新 AI 看的 prompt。

【目标读者】不是人，是 AI。所以要紧凑、结构化、可直接喂入。

【必须包含 6 段结构】
1. 议题：一句话（不超过 30 字）
2. 当前进展：第几轮、已发言哪几位 AI、还剩几轮
3. 立场坐标：每个已发言 AI 一句话总结其核心论点（含名字）
4. 关键分歧：当前 1-2 个最尖锐的对立点（不要罗列所有分歧）
5. 已达成共识：明确写出来，让新 AI 别再复读这些
6. 你接下来该：给新 AI 的具体攻防建议（不是"请发表你的看法"这种废话）

【风格要求】
- 第二人称写给新 AI（"你即将加入..." 开头）
- ${length} 字以内
- 不要客套话、不要总结性结论（不是给人看的报告）
- 直接以 prompt 形式输出，去除任何 markdown 标题符号（#），用 ▸ · 等轻量符号
- 严禁输出"我作为一个 AI..."等元话语

【视角】${stanceHint}

【对话原文】
${transcript}

【你的输出】直接给接棒简报正文，不要任何前后缀。`;
  }

  window.BatonPrompts = { buildBatonMetaPrompt };
})();
