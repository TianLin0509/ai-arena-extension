import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// chat-bus.js 是 SW 经典脚本，node 下用 chrome/self/StateMachine/FlowState stub 加载，
// 真实执行 resumePollingForPending / startPollingForService（v5.0.17 P0-4 回归）
globalThis.self = globalThis;
const aliveTabs = new Set([101, 102]);
const sentMessages = [];
globalThis.chrome = {
  storage: {
    local: {
      // 必须返回 Promise — chat-bus 的节流 flush 会对返回值调 .catch
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
    },
  },
  tabs: {
    get: async (tabId) => {
      if (!aliveTabs.has(tabId)) throw new Error("No tab with id " + tabId);
      return { id: tabId };
    },
    sendMessage: async () => ({ text: "", isStreaming: true }),
  },
  runtime: {
    sendMessage: async (m) => { sentMessages.push(m); },
    onSuspend: { addListener() {} },
  },
  windows: { update: async () => ({}), create: async () => ({ id: 1 }) },
};
globalThis.FlowState = {
  IDLE: "idle", BROADCASTING: "broadcasting",
  AWAITING_RESPONSES: "awaiting_responses", DEBATING: "debating", SUMMARY: "summary",
};
globalThis.StateMachine = {
  flowState: "idle",
  participants: [],
  lastSentByPid: {},
  lastAcceptedByPid: {},
  pendingSummary: null,
  lastSentTs: 0,
  getParticipant(id) { return this.participants.find(p => p.id === id); },
};

const require = createRequire(import.meta.url);
require("../chat-bus.js");
const ChatBus = globalThis.self.ChatBus;

function resetWorld({ flowState, lastSentTs, participants }) {
  ChatBus.clearAllPollers();
  sentMessages.length = 0;
  StateMachine.flowState = flowState;
  StateMachine.lastSentTs = lastSentTs;
  StateMachine.participants = participants;
}

test("P0-4: 等待回答中 + 时间窗内 + tab 活着 → 重建 polling", async () => {
  resetWorld({
    flowState: "awaiting_responses",
    lastSentTs: Date.now() - 60 * 1000,
    participants: [
      { id: "p1", service: "deepseek", tabId: 101, name: "DeepSeek-1", response: null },
      { id: "p2", service: "doubao", tabId: 102, name: "豆包-1", response: "已有回答" },
    ],
  });
  const r = await ChatBus.resumePollingForPending();
  assert.equal(r.resumed, 1, "只恢复没拿到回答的 deepseek");
  assert.equal(ChatBus.getActivePollerCount(), 1);
  assert.ok(ChatBus.getActivePollingServices().includes("deepseek"));
  assert.ok(!ChatBus.getActivePollingServices().includes("doubao"), "已有回答的不恢复");
  ChatBus.clearAllPollers();
});

test("P0-4: flowState 空闲 → 不恢复", async () => {
  resetWorld({
    flowState: "idle",
    lastSentTs: Date.now(),
    participants: [{ id: "p1", service: "deepseek", tabId: 101, name: "D", response: null }],
  });
  const r = await ChatBus.resumePollingForPending();
  assert.equal(r.resumed, 0);
  assert.equal(ChatBus.getActivePollerCount(), 0);
});

test("P0-4: 超过 10 分钟时间窗（陈旧会话）→ 不恢复", async () => {
  resetWorld({
    flowState: "awaiting_responses",
    lastSentTs: Date.now() - 11 * 60 * 1000,
    participants: [{ id: "p1", service: "deepseek", tabId: 101, name: "D", response: null }],
  });
  const r = await ChatBus.resumePollingForPending();
  assert.equal(r.resumed, 0);
  assert.equal(r.reason, "stale");
});

test("P0-4: tab 已关闭 → 跳过该参与者", async () => {
  resetWorld({
    flowState: "debating",
    lastSentTs: Date.now(),
    participants: [{ id: "p1", service: "deepseek", tabId: 999, name: "D", response: null }],
  });
  const r = await ChatBus.resumePollingForPending();
  assert.equal(r.resumed, 0);
});

test("P0-4: 裁判总结恢复复用 pendingSummary.msgId（完成气泡落回原占位）", async () => {
  resetWorld({
    flowState: "summary",
    lastSentTs: Date.now(),
    participants: [{ id: "p3", service: "kimi", tabId: 101, name: "Kimi-1", response: null }],
  });
  StateMachine.pendingSummary = { judgeId: "p3", msgId: "m_origin_summary" };
  await ChatBus.resumePollingForPending();
  const aiBubble = sentMessages.find(m => m.role === "ai" && m.participantId === "kimi");
  assert.equal(aiBubble?.msgId, "m_origin_summary");
  StateMachine.pendingSummary = null;
  ChatBus.clearAllPollers();
});

test("startPollingForService: 重复启动同 service 清旧 poller 不堆积", () => {
  resetWorld({ flowState: "idle", lastSentTs: 0, participants: [] });
  const p = { id: "p1", service: "deepseek", tabId: 101, name: "D" };
  ChatBus.startPollingForService(p, "m1");
  ChatBus.startPollingForService(p, "m2");
  assert.equal(ChatBus.getActivePollerCount(), 1);
  ChatBus.clearAllPollers();
});
