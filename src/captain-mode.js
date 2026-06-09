// AI Arena - captain mode prompt decorator
(function (root) {
  const STORAGE_KEY = "captainModeEnabled";
  const MARKER = "[AI Arena 队长模式]";

  const INSTRUCTION = `${MARKER}
你是本轮 AI 小队的队长。请在回答时承担整合职责：
1. 如果本轮 prompt 中已经包含其他 AI 队员的发言或观点，请先用简短要点总结队员共识、分歧和可补充处，再给出你的判断。
2. 如果当前还没有任何队员发言（例如第一轮同时提问），不要硬编总结，直接回答用户问题。
3. 不要替队员虚构未说过的观点；引用或总结队员意见时要基于 prompt 里真实出现的内容。`;

  function isCaptain(participant, participants) {
    if (!participant || !Array.isArray(participants) || participants.length < 2) return false;
    const first = participants[0];
    return String(first?.id ?? first?.service) === String(participant.id ?? participant.service);
  }

  function decoratePrompt(text, participant, participants, enabled = true) {
    const prompt = String(text || "");
    if (!enabled || !isCaptain(participant, participants)) return prompt;
    if (prompt.includes(MARKER)) return prompt;
    return `${INSTRUCTION}\n\n---\n\n${prompt}`;
  }

  async function isEnabled() {
    try {
      if (!root.chrome?.storage?.local?.get) return true;
      const data = await root.chrome.storage.local.get([STORAGE_KEY]);
      return data?.[STORAGE_KEY] !== false;
    } catch (_) {
      return true;
    }
  }

  async function apply(text, participant, participants) {
    return decoratePrompt(text, participant, participants, await isEnabled());
  }

  const api = { STORAGE_KEY, MARKER, isCaptain, decoratePrompt, isEnabled, apply };
  root.ArenaCaptainMode = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
