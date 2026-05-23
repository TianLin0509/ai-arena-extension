// AI Arena — popup 气泡 actions
(function () {
  document.getElementById("chat-messages")?.addEventListener("click", async (e) => {
    // v4.3.4: 点击 AI 头像 → 跳原页（在 button 判定前优先匹配）
    const avatar = e.target.closest(".msg-avatar");
    if (avatar) {
      const row = avatar.closest(".msg.ai");
      if (row?.dataset.participantId) {
        chrome.runtime.sendMessage({ type: "chatJumpToOrigin", participantId: row.dataset.participantId });
        return;
      }
    }
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const row = btn.closest(".msg");
    if (!row) return;
    const participantId = row.dataset.participantId;
    const act = btn.dataset.act;
    const bubble = row.querySelector(".msg-bubble");
    const text = bubble?.innerText?.trim() || "";

    if (act === "copy") {
      try {
        await navigator.clipboard.writeText(text);
        const orig = btn.textContent;
        btn.textContent = "✓";
        setTimeout(() => btn.textContent = orig, 1000);
      } catch (err) { console.warn("copy failed:", err); }
    } else if (act === "jump") {
      if (!participantId) return;
      chrome.runtime.sendMessage({ type: "chatJumpToOrigin", participantId });
    } else if (act === "reextract") {
      if (!participantId) return;
      btn.disabled = true;
      const orig = btn.textContent;
      btn.textContent = "⏳";
      chrome.runtime.sendMessage({ type: "chatReextractOne", participantId }, () => {
        btn.disabled = false;
        btn.textContent = orig;
      });
    } else if (act === "resend") {
      // 重发：找最近一条用户消息文本，sendPromptToService 给当前 AI
      if (!participantId) return;
      const userRow = [...document.querySelectorAll(".msg.me")].pop();
      const userText = userRow?.querySelector(".msg-bubble")?.innerText?.trim();
      if (!userText) { alert("找不到要重发的用户消息"); return; }
      btn.disabled = true;
      const orig = btn.textContent;
      btn.textContent = "⏳";
      chrome.runtime.sendMessage(
        { type: "sendPromptToService", service: participantId, text: userText },
        () => { btn.disabled = false; btn.textContent = orig; }
      );
    } else if (act === "skip") {
      // 跳过本轮：标记气泡"已跳过"，通知 background 取消该 AI 的 polling 但保留 participant
      if (!participantId) return;
      const msgId = row.dataset.msgId;
      const bubble = row.querySelector(".msg-bubble");
      const stat = row.querySelector(".msg-meta .stat");
      if (bubble) {
        bubble.innerHTML = '<span class="msg-skipped">⏭ 已跳过本轮</span>';
      }
      if (stat) {
        stat.className = "stat skipped";
        stat.innerHTML = '<span class="pip"></span>已跳过';
      }
      row.classList.add("msg-skipped-row");
      // 通知 background 停 polling 并把该 AI 标为 skipped（让"等待全部完成"不卡）
      chrome.runtime.sendMessage({
        type: "chatSkipParticipant",
        msgId, participantId,
      }, () => {});
    }
  });
})();
