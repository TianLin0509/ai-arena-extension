// state-machine.js — FlowState + 纯数据存储（无 ParticipantState）

// ── 状态枚举 ──
const FlowState = {
  IDLE: "idle",
  BROADCASTING: "broadcasting",
  AWAITING_RESPONSES: "awaiting_responses",
  CONFIRMING: "confirming",
  DEBATING: "debating",
  SUMMARY: "summary"
};

// ── 状态管理器 ──
const StateMachine = {
  flowState: FlowState.IDLE,
  participants: [],     // { id, service, tabId, name, response, responsePreview, manualResponse }
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

  setParticipantResponse(id, text) {
    const p = this.getParticipant(id);
    if (p) {
      p.response = text;
      p.responsePreview = text ? text.slice(0, 100) : null;
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
      this.save();
      this._broadcastStateUpdate();
    }
  },

  // ── 会话管理 ──
  resetSession() {
    this.debateSession = { originalQuestion: "", rounds: [], summaryText: "" };
    this.flowState = FlowState.IDLE;
    this.participants.forEach(p => {
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
        responsePreview: p.responsePreview
      })),
      debateSession: this.debateSession
    }).catch(() => {});
  },

  getFullState() {
    return {
      flowState: this.flowState,
      participants: this.participants.map(p => ({
        id: p.id, service: p.service, tabId: p.tabId, name: p.name,
        responsePreview: p.responsePreview
      })),
      debateSession: this.debateSession
    };
  }
};
