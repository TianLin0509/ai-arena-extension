// state-machine.js — FlowState + 纯数据存储（无 ParticipantState）

// ── 状态枚举 ──
const FlowState = {
  IDLE: "idle",
  BROADCASTING: "broadcasting",
  AWAITING_RESPONSES: "awaiting_responses",
  DEBATING: "debating",
  SUMMARY: "summary"
};

const DEBATE_FULL_ROUNDS_KEEP = 12;
const DEBATE_ARCHIVE_RESPONSE_CHARS = 4000;
const DEBATE_ACTIVE_RESPONSE_CHARS = 60000;

function compactTextForStorage(text, maxChars) {
  if (typeof text !== "string" || text.length <= maxChars) return text;
  const head = Math.max(0, Math.floor(maxChars * 0.75));
  const tail = Math.max(0, maxChars - head - 60);
  // v5.0.16: 标记改中文短句 — 截断版只进 storage，但 SW 重启后会被恢复进内存并可能
  //   进入辩论 prompt / 裁判总结，中文省略标记对 AI 和用户都可理解，不引入英文噪音
  return `${text.slice(0, head)}\n……（中间省略 ${text.length - head - tail} 字符）……\n${text.slice(-tail)}`;
}

// ── 状态管理器 ──
const StateMachine = {
  flowState: FlowState.IDLE,
  participants: [],     // { id, service, tabId, name, response, responsePreview }
  nextId: 1,
  debateSession: { originalQuestion: "", rounds: [], summaryText: "", sequenceConfig: null },
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
    const data = await chrome.storage.local.get(["sm_flowState", "sm_participants", "sm_nextId", "sm_debateSession", "sm_markerRound", "sm_lastSentByPid", "sm_lastAcceptedByPid", "sm_pendingSummary", "sm_lastSentTs"]);
    if (data.sm_flowState) this.flowState = data.sm_flowState;
    if (data.sm_participants) this.participants = data.sm_participants;
    if (data.sm_nextId) this.nextId = data.sm_nextId;
    if (data.sm_debateSession) this.debateSession = data.sm_debateSession;
    if (data.sm_markerRound) this.markerRound = data.sm_markerRound;
    if (data.sm_lastSentByPid) this.lastSentByPid = data.sm_lastSentByPid;
    if (data.sm_lastAcceptedByPid) this.lastAcceptedByPid = data.sm_lastAcceptedByPid;
    if (data.sm_pendingSummary) this.pendingSummary = data.sm_pendingSummary;
    if (data.sm_lastSentTs) this.lastSentTs = data.sm_lastSentTs;  // v5.0.17 P0-4
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
  // v5.0.16: 压缩只发生在写盘序列化时，且作用于**副本** — 旧版（未发布 WIP）原地 mutate
  //   this.debateSession，被截断的 text 会被 buildDebatePrompt / 裁判总结直接引用，
  //   辩论上下文和总结质量被悄悄降级。现在内存态永远保持全文；只有 SW 被回收后从
  //   storage 恢复的旧轮才是截断版（quota 保护的代价，活跃轮 60k 上限极少触发）。
  compactDebateSessionForStorage() {
    const session = this.debateSession;
    const rounds = session?.rounds;
    if (!Array.isArray(rounds) || !rounds.length) return session;
    const fullStart = Math.max(0, rounds.length - DEBATE_FULL_ROUNDS_KEEP);
    const limitFor = (i) => (i >= fullStart ? DEBATE_ACTIVE_RESPONSE_CHARS : DEBATE_ARCHIVE_RESPONSE_CHARS);
    const needsCompact = (round, i) => {
      const responses = round?.responses;
      if (!responses || typeof responses !== "object") return false;
      const limit = limitFor(i);
      return Object.values(responses).some(item =>
        item && typeof item === "object" && typeof item.text === "string" && item.text.length > limit);
    };
    // 快路径：全部在限内 → 不拷贝直接写原对象
    if (!rounds.some(needsCompact)) return session;
    return {
      ...session,
      rounds: rounds.map((round, i) => {
        if (!needsCompact(round, i)) return round;
        const limit = limitFor(i);
        const responses = {};
        for (const [key, item] of Object.entries(round.responses)) {
          if (item && typeof item === "object" && typeof item.text === "string" && item.text.length > limit) {
            responses[key] = {
              ...item,
              originalTextLength: item.originalTextLength || item.text.length,
              compactedForStorage: true,
              text: compactTextForStorage(item.text, limit),
            };
          } else {
            responses[key] = item;
          }
        }
        return { ...round, responses };
      }),
    };
  },
  _writeToStorage() {
    // v5.0.18 P2-1: 写盘失败不再 100% 静默 — storage.local 配额满（5MB）时所有状态
    //   持久化失效，SW 回收后辩论历史/参与者全丢。失败时告警让用户知道该重置会话。
    try {
      const ret = chrome.storage.local.set({
        sm_flowState: this.flowState,
        sm_participants: this.participants,
        sm_nextId: this.nextId,
        sm_debateSession: this.compactDebateSessionForStorage(),
        sm_markerRound: this.markerRound,
        sm_lastSentByPid: this.lastSentByPid,
        sm_lastAcceptedByPid: this.lastAcceptedByPid,
        sm_pendingSummary: this.pendingSummary,  // v4.5.5 F6
        sm_lastSentTs: this.lastSentTs || 0,     // v5.0.17 P0-4
      });
      if (ret && typeof ret.catch === "function") ret.catch((e) => this._onStorageWriteError(e));
    } catch (e) {
      this._onStorageWriteError(e);
    }
  },
  _onStorageWriteError(e) {
    console.error("[StateMachine] 状态写盘失败:", e?.message || e);
    const now = Date.now();
    if (this._lastStorageWarnTs && now - this._lastStorageWarnTs < 60000) return;  // 60s 限频
    this._lastStorageWarnTs = now;
    try {
      chrome.runtime.sendMessage({
        type: "chatStreamUpdate", role: "user", msgId: `m${now}_storagewarn`,
        text: `⚠ 扩展状态保存失败（${e?.message || "未知错误"}）。可能是本地存储配额已满，长辩论历史有丢失风险，建议尽快"彻底重置"释放空间。`,
      }).catch(() => {});
    } catch (_) {}
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
    this.debateSession = { originalQuestion: "", rounds: [], summaryText: "", sequenceConfig: null };
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
    // v5.0.17 P0-4: 记录最近一次发送时间 — SW 重启恢复 polling 的时间窗判据
    //   （10 分钟内的等待才恢复，隔夜陈旧会话不自动提取）
    this.lastSentTs = Date.now();
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
        // v5.0.22 B: 登录红绿灯（checking/ok/login_required）— popup 成员卡角标 + 新手之旅步骤 2 依赖
        loginStatus: p.loginStatus || null,
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
        loginStatus: p.loginStatus || null,   // v5.0.22 B: 同 _doBroadcast
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
