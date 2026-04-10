// state-machine.js — FlowState + ParticipantState 状态机

// ── 状态枚举 ──
const FlowState = {
  IDLE: "idle",
  BROADCASTING: "broadcasting",
  AWAITING_RESPONSES: "awaiting_responses",
  CONFIRMING: "confirming",
  DEBATING: "debating",
  SUMMARY: "summary"
};

const ParticipantState = {
  IDLE: "idle",
  INJECTING: "injecting",
  INJECT_OK: "inject_ok",
  INJECT_FAILED: "inject_failed",
  STREAMING: "streaming",
  RESPONSE_READY: "response_ready",
  RESPONSE_FAILED: "response_failed"
};

// ── 状态管理器 ──
const StateMachine = {
  flowState: FlowState.IDLE,
  participants: [],     // { id, service, tabId, name, state, response, responsePreview, manualResponse }
  nextId: 1,
  debateSession: { originalQuestion: "", rounds: [], summaryText: "" },

  // ── 初始化（从 storage 恢复） ──
  async init() {
    const data = await chrome.storage.local.get(["sm_flowState", "sm_participants", "sm_nextId", "sm_debateSession"]);
    if (data.sm_flowState) this.flowState = data.sm_flowState;
    if (data.sm_participants) this.participants = data.sm_participants;
    if (data.sm_nextId) this.nextId = data.sm_nextId;
    if (data.sm_debateSession) this.debateSession = data.sm_debateSession;
  },

  save() {
    chrome.storage.local.set({
      sm_flowState: this.flowState,
      sm_participants: this.participants,
      sm_nextId: this.nextId,
      sm_debateSession: this.debateSession
    });
  },

  // ── Flow 状态转换 ──
  setFlowState(newState) {
    this.flowState = newState;
    this.save();
    this._broadcastStateUpdate();
  },

  // ── 参与者管理 ──
  addParticipant(id, service, tabId, name) {
    this.participants.push({
      id, service, tabId, name,
      state: ParticipantState.IDLE,
      response: null,
      responsePreview: null,
      manualResponse: null
    });
    this.save();
  },

  removeParticipant(id) {
    this.participants = this.participants.filter(p => p.id !== id);
    this.save();
  },

  getParticipant(id) {
    return this.participants.find(p => p.id === id);
  },

  // ── 参与者状态转换 ──
  setParticipantState(id, newState) {
    const p = this.getParticipant(id);
    if (p) {
      p.state = newState;
      this.save();
      this._broadcastStateUpdate();
    }
  },

  setParticipantResponse(id, text) {
    const p = this.getParticipant(id);
    if (p) {
      p.response = text;
      p.responsePreview = text ? text.slice(0, 100) : null;
      p.state = ParticipantState.RESPONSE_READY;
      this.save();
      this._broadcastStateUpdate();
    }
  },

  setParticipantManualResponse(id, text) {
    const p = this.getParticipant(id);
    if (p) {
      p.manualResponse = text;
      p.response = text;
      p.responsePreview = text ? text.slice(0, 100) : null;
      p.state = ParticipantState.RESPONSE_READY;
      this.save();
      this._broadcastStateUpdate();
    }
  },

  // ── 确认门控检查 ──

  allResponsesSettled() {
    return this.participants
      .filter(p => p.state !== ParticipantState.INJECT_FAILED)
      .every(p =>
        p.state === ParticipantState.RESPONSE_READY ||
        p.state === ParticipantState.RESPONSE_FAILED
      );
  },

  validResponseCount() {
    return this.participants.filter(p => p.state === ParticipantState.RESPONSE_READY && p.response).length;
  },

  canStartDebate() {
    return this.validResponseCount() >= 2;
  },

  isSuspiciousResponse(id) {
    const p = this.getParticipant(id);
    if (!p || p.state !== ParticipantState.RESPONSE_READY || !p.response) return false;
    const text = p.response.trim();
    if (text.length < 10) return true;
    if (text.endsWith("...") || text.endsWith("…")) return true;
    return false;
  },

  // ── 会话管理 ──
  resetSession() {
    this.debateSession = { originalQuestion: "", rounds: [], summaryText: "" };
    this.flowState = FlowState.IDLE;
    this.participants.forEach(p => {
      p.state = ParticipantState.IDLE;
      p.response = null;
      p.responsePreview = null;
      p.manualResponse = null;
    });
    this.save();
  },

  hardReset() {
    this.participants = [];
    this.nextId = 1;
    this.debateSession = { originalQuestion: "", rounds: [], summaryText: "" };
    this.flowState = FlowState.IDLE;
    this.save();
  },

  // ── 状态广播到 sidepanel ──
  _broadcastStateUpdate() {
    chrome.runtime.sendMessage({
      type: "stateUpdate",
      flowState: this.flowState,
      participants: this.participants.map(p => ({
        id: p.id, service: p.service, tabId: p.tabId, name: p.name,
        state: p.state, responsePreview: p.responsePreview,
        suspicious: this.isSuspiciousResponse(p.id)
      })),
      debateSession: this.debateSession
    }).catch(() => {});
  },

  getFullState() {
    return {
      flowState: this.flowState,
      participants: this.participants.map(p => ({
        id: p.id, service: p.service, tabId: p.tabId, name: p.name,
        state: p.state, responsePreview: p.responsePreview,
        suspicious: this.isSuspiciousResponse(p.id)
      })),
      debateSession: this.debateSession
    };
  }
};
