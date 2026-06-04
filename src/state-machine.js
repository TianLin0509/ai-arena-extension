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

  // v5.0.8 perf: save() 改为节流写盘 — 单轮辩论原本触发 20+ 次 setLastSent/setParticipantResponse
  //   各嵌一次 save，每次都把 8 个字段（含大对象 debateSession.rounds / participants）整包序列化
  //   写 chrome.storage.local。100ms 窗口合并：高频字段连续改只在尾部写一次，单轮 IO 降到 ~2 次。
  //   关键路径（hardReset / resetSession / setPendingSummary）保留 saveSync 同步写盘兜底。
  //   chrome.runtime.onSuspend 在 SW 30s idle 回收前 flush pending save，防丢状态。
  _saveTimer: null,
  _savePending: false,
  save() {
    this._savePending = true;
    if (this._saveTimer != null) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      if (this._savePending) {
        this._savePending = false;
        this._writeToStorage();
      }
    }, 100);
  },
  saveSync() {
    // 关键路径用：立即写盘，跳过节流窗口（hardReset/pendingSummary 等）
    if (this._saveTimer != null) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this._savePending = false;
    this._writeToStorage();
  },
  _writeToStorage() {
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

  // v4.8.43: opts.userEdited 标记是否用户手动编辑
  //   - 用户编辑（userEdited=true）：写入 p.response 并标记 p.userEdited=true，polling/watcher 跳过覆盖
  //   - 系统写入（默认 userEdited=false）：若 p.userEdited=true 则跳过（保护用户编辑），除非 opts.force
  //   - 重发/重新提取/广播新轮（opts.force=true）：清除 userEdited 标记，重新允许自动覆盖
  setParticipantResponse(id, text, opts = {}) {
    const p = this.getParticipant(id);
    if (!p) return { ok: false, error: "no participant" };
    if (!opts.force && !opts.userEdited && p.userEdited) {
      // 系统路径 + 用户已编辑 + 非 force → 静默跳过
      return { ok: false, skipped: "user-edited" };
    }
    p.response = text;
    p.responsePreview = text ? text.slice(0, 100) : null;
    this.lastAcceptedByPid[id] = text || "";
    if (opts.userEdited) {
      p.userEdited = true;
    } else {
      // force 或 系统路径无 userEdited 冲突 → 清除标记（重新允许自动覆盖）
      delete p.userEdited;
    }
    this.save();
    this._broadcastStateUpdate();
    return { ok: true };
  },

  // v4.8.43: 重发/重新提取/广播前清除 userEdited，让 polling 可以重新写
  clearUserEdited(id) {
    const p = this.getParticipant(id);
    if (p && p.userEdited) {
      delete p.userEdited;
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
    this.saveSync();  // v5.0.8: 与 hardReset 对齐 — 重置状态属关键路径，必须立即落盘
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
    this.saveSync();  // v5.0.8: 关键路径同步写盘
  },

  setLastSent(pid, text) {
    this.lastSentByPid[pid] = text || "";
    this.save();
  },

  // v4.5.5 F6: 显式 setter 保证 pendingSummary 改动一定 save，
  // SW 重启时才能从 storage 恢复
  // v5.0.8: 用 saveSync — pendingSummary 是 finalize summary 的"信号位"，丢失即裁判总结报告永不出
  setPendingSummary(payload) {
    this.pendingSummary = payload || null;
    this.saveSync();
  },

  // ── 状态广播到 sidepanel ──
  // v5.0.8 perf: _broadcastStateUpdate 加节流（200ms 合并） — 连续 setParticipantResponse
  //   多次调用只 broadcast 一次。完整 response 仍然广播（popup-roster 编辑器/pill 依赖，
  //   v4.8.45 明确要求），仅消除高频抖动。
  _broadcastTimer: null,
  _broadcastStateUpdate() {
    if (this._broadcastTimer != null) return;
    this._broadcastTimer = setTimeout(() => {
      this._broadcastTimer = null;
      this._doBroadcast();
    }, 200);
  },
  _doBroadcast() {
    chrome.runtime.sendMessage({
      type: "stateUpdate",
      flowState: this.flowState,
      participants: this.participants.map(p => ({
        id: p.id, service: p.service, tabId: p.tabId, name: p.name,
        // v4.8.45: 补 response + userEdited
        //   v4.8.43 popup-roster pill 预览/编辑器依赖完整 response，但 payload 旧版只发 responsePreview
        //   → pill 永远显示"等待回复..."，编辑器打开拿不到完整内容
        response: p.response,
        responsePreview: p.responsePreview,
        userEdited: !!p.userEdited,
      })),
      debateSession: this.debateSession
    }).catch(() => {});
  },

  getFullState() {
    return {
      flowState: this.flowState,
      participants: this.participants.map(p => ({
        id: p.id, service: p.service, tabId: p.tabId, name: p.name,
        // v4.8.45: 同 _broadcastStateUpdate — popup-roster.refresh() 也走这里
        response: p.response,
        responsePreview: p.responsePreview,
        userEdited: !!p.userEdited,
      })),
      debateSession: this.debateSession
    };
  }
};

// v4.8.43: 暴露到 self 便于 SW console / 单测访问（不影响生产，importScripts 已让全局可见）
try { self.StateMachine = StateMachine; } catch (_) {}

// v5.0.8 perf: SW 30s idle 回收前 flush pending save，防 100ms 节流窗口内的状态丢失
try {
  chrome.runtime.onSuspend.addListener(() => {
    try {
      if (StateMachine._savePending) StateMachine.saveSync();
      if (StateMachine._broadcastTimer != null) {
        clearTimeout(StateMachine._broadcastTimer);
        StateMachine._broadcastTimer = null;
      }
    } catch (_) {}
  });
} catch (_) {}
