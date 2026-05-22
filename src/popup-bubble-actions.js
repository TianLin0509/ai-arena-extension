// AI Arena — popup 气泡 actions
(function () {
  document.getElementById("chat-messages")?.addEventListener("click", async (e) => {
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
    }
  });
})();
