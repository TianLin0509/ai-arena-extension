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

    if (act === "summary-toggle") {
      // v4.4.0: 展开/收起辩论总结 iframe
      const iframe = row.querySelector(".summary-iframe");
      if (iframe) {
        const showing = iframe.style.display !== "none";
        iframe.style.display = showing ? "none" : "block";
        btn.textContent = showing ? "▾ 查看完整报告" : "▴ 收起报告";
      }
      return;
    }
    if (act === "summary-open") {
      // v4.4.0: 用 blob URL 在新标签打开（chrome-extension:// 下可以）
      const html = row._summaryHtml;
      if (!html) return;
      try {
        const blob = new Blob([html], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (e) { alert("打开失败: " + e.message); }
      return;
    }
    if (act === "summary-redownload") {
      // v4.4.0: 再次下载（用 message 让 background 调 chrome.downloads）
      const did = parseInt(btn.dataset.did, 10);
      if (isNaN(did)) return;
      chrome.downloads.show(did);
      return;
    }
    if (act === "fold-toggle") {
      // v4.3.6: 展开/收起长文
      const bubble = btn.closest(".msg-bubble");
      if (bubble) {
        const isExpanded = bubble.classList.toggle("expanded");
        const icon = btn.querySelector(".msg-fold-icon");
        if (icon) icon.textContent = isExpanded ? "▴" : "▾";
        // 文本"展开全文"/"收起" 切换
        const countSpan = btn.querySelector(".msg-fold-count");
        const countTxt = countSpan ? countSpan.outerHTML : "";
        btn.innerHTML = isExpanded
          ? `<span class="msg-fold-icon">▴</span> 收起 ${countTxt}`
          : `<span class="msg-fold-icon">▾</span> 展开全文 ${countTxt}`;
        // 收起后 scroll 回气泡顶部
        if (!isExpanded) {
          const row = btn.closest(".msg");
          if (row) row.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
      return;
    }
    if (act === "copy") {
      try {
        await navigator.clipboard.writeText(text);
        // v4.8.42: 按钮内容是 SVG，用 innerHTML 备份还原，textContent 会冲掉 SVG
        const orig = btn.innerHTML;
        btn.innerHTML = "✓";
        setTimeout(() => btn.innerHTML = orig, 1000);
      } catch (err) { console.warn("copy failed:", err); }
    } else if (act === "jump") {
      if (!participantId) return;
      chrome.runtime.sendMessage({ type: "chatJumpToOrigin", participantId });
    } else if (act === "reextract") {
      if (!participantId) return;
      btn.disabled = true;
      const orig = btn.innerHTML;
      btn.innerHTML = "⏳";
      chrome.runtime.sendMessage({ type: "chatReextractOne", participantId }, () => {
        btn.disabled = false;
        btn.innerHTML = orig;
      });
    } else if (act === "resend") {
      // v4.8.7 F26: 不再用 popup user 气泡显示文本（辩论/总结只是短显示文本）
      // 改为不传 text → background.sendPromptToService 自动从 lastSentByPid 取完整 prompt
      if (!participantId) return;
      btn.disabled = true;
      const orig = btn.innerHTML;
      btn.innerHTML = "⏳";
      chrome.runtime.sendMessage(
        { type: "sendPromptToService", service: participantId },
        () => { btn.disabled = false; btn.innerHTML = orig; }
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
