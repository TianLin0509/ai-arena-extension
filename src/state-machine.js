// state-machine.js — FlowState + 纯数据存储（无 ParticipantState）

// ── 状态枚举 ──
const FlowState = {
  IDLE: "idle",
  BROADCASTING: "broadcasting",
  AWAITING_RESPONSES: "awaiting_responses",
  DEBATING: "debating",
  SUMMARY: "summary"
};

// ── 状态管理器 ──
const StateMachine = {
  flowState: FlowState.IDLE,
  participants: [],     // { id, service, tabId, name, response, responsePreview }
  nextId: 1,
  debateSession: { originalQuestion: "", rounds: [], summaryText: "" },
  markerRound: 0,
  // 每个参与者最近一次"刚发出去"的 prompt，用于 readOneResponse sanity check（防把用户消息当成 AI 回复）
  lastSentByPid: {},
  // 每个参与者最近一次已接受的 AI 回复；即使进入下一轮清空 response，也用于拒绝上一轮残留。
  lastAcceptedByPid: {},
  // v4.4.0: 待解析的裁判总结 — { judgeId, judgeName, judgeService, customInstruction, ts }
  // chat-bus polling 完成时检查；匹配则触发 finalizeDebateSummary
  pendingSummary: null,

  // ── 初始化（从 storage 恢复） ──
  async init() {
    // v4.5.5 F6: sm_pendingSummary 加入持久化列表 — SW 30s 空闲被回收重启时，
    // pendingSummary（"等待裁判 AI 输出 → 触发 finalize"标记）会丢，用户感知就是
    // 点了"裁判总结"按钮但永远不出 HTML 报告
    const data = await chrome.storage.local.get(["sm_flowState", "sm_participants", "sm_nextId", "sm_debateSession", "sm_markerRound", "sm_lastSentByPid", "sm_lastAcceptedByPid", "sm_pendingSummary"]);
    if (data.sm_flowState) this.flowState = data.sm_flowState;
    if (data.sm_participants) this.participants = data.sm_participants;
    if (data.sm_nextId) this.nextId = data.sm_nextId;
    if (data.sm_debateSession) this.debateSession = data.sm_debateSession;
    if (data.sm_markerRound) this.markerRound = data.sm_markerRound;
    if (data.sm_lastSentByPid) this.lastSentByPid = data.sm_lastSentByPid;
    if (data.sm_lastAcceptedByPid) this.lastAcceptedByPid = data.sm_lastAcceptedByPid;
    if (data.sm_pendingSummary) this.pendingSummary = data.sm_pendingSummary;
  },

  save() {
    chrome.storage.local.set({
      sm_flowState: this.flowState,
      sm_participants: this.participants,
      sm_nextId: this.nextId,
      sm_debateSession: this.debateSession,
      sm_markerRound: this.markerRound,
      sm_lastSentByPid: this.lastSentByPid,
      sm_lastAcceptedByPid: this.lastAcceptedByPid,
      sm_pendingSummary: this.pendingSummary,  // v4.5.5 F6
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
      responsePreview: null
    });
    this.save();
  },

  removeParticipant(id) {
    this.participants = this.participants.filter(p => p.id !== id);
    this.save();
  },

  getParticipant(id) {
    // v4.5.5 F10: id 类型 normalize 防御性匹配 — 当前 popup 路径都传字符串无误，
    // 未来扩展（新 popup-* 文件或外部调用）传 Number 会被严格 === 拒绝，导致"找不到参与者"
    if (id == null) return undefined;
    const target = String(id);
    return this.participants.find(p => String(p.id) === target);
  },

  getParticipantByTabId(tabId) {
    return this.participants.find(p => p.tabId === tabId) || null;
  },

  setParticipantResponse(id, text) {
    const p = this.getParticipant(id);
    if (p) {
      p.response = text;
      p.responsePreview = text ? text.slice(0, 100) : null;
      this.lastAcceptedByPid[id] = text || "";
      this.save();
      this._broadcastStateUpdate();
    }
  },

  // ── 会话管理 ──
  resetSession() {
    this.debateSession = { originalQuestion: "", rounds: [], summaryText: "" };
    this.flowState = FlowState.IDLE;
    this.markerRound = 0;
    this.lastSentByPid = {};
    this.lastAcceptedByPid = {};
    this.participants.forEach(p => {
      p.response = null;
      p.responsePreview = null;
    });
    this.save();
  },

  hardReset() {
    this.participants = [];
    this.nextId = 1;
    this.debateSession = { originalQuestion: "", rounds: [], summaryText: "" };
    this.flowState = FlowState.IDLE;
    this.markerRound = 0;
    this.lastSentByPid = {};
    this.lastAcceptedByPid = {};
    // v4.6.6 F13: 清 pendingSummary — 防重置后 nextId 重排 → 新 p3 完成回答
    // 被误判为旧 pendingSummary.judgeId="p3" 触发 → 普通气泡被当裁判总结渲染 HTML 报告
    this.pendingSummary = null;
    this.save();
  },

  setLastSent(pid, text) {
    this.lastSentByPid[pid] = text || "";
    this.save();
  },

  // v4.5.5 F6: 显式 setter 保证 pendingSummary 改动一定 save，
  // SW 重启时才能从 storage 恢复
  setPendingSummary(payload) {
    this.pendingSummary = payload || null;
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
