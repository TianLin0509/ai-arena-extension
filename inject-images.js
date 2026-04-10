// AI Arena — 图片注入通用逻辑
// 被各 content script 引用

// 轮询等待图片上传完成（检测预览缩略图出现 & 上传进度消失）
function waitForImageUpload(expectedCount, timeoutMs = 15000) {
  // 各平台图片预览/附件的选择器
  const previewSelectors = [
    // ChatGPT: 图片附件预览
    '[data-testid="attachment-preview"] img',
    '.image-preview img',
    // Claude: 图片缩略图
    '[data-testid="file-thumbnail"]',
    'div[class*="attachment"] img',
    'button[aria-label*="Remove file"] ~ img',
    'img[alt="Uploaded image"]',
    // Gemini: 上传的图片预览
    'img.uploaded-image',
    'uploader-thumbnail img',
    '.input-area img[src*="blob:"]',
    // 通用: 输入区域内的图片预览
    '.composer img:not([src*="avatar"])',
    '[role="presentation"] img',
    'img[src^="blob:"]',
    'img[src^="data:image"]',
  ];
  // 上传中/处理中的指示器
  const uploadingSelectors = [
    '[data-testid="upload-progress"]',
    '.uploading', '.upload-progress', '.loading-spinner',
    '[aria-label*="Uploading"]', '[aria-label*="上传中"]',
    'progress', '.progress-bar',
    'svg.animate-spin',
  ];

  return new Promise(resolve => {
    const start = Date.now();
    // 记录粘贴前已有的图片数量
    let baselineCount = 0;
    for (const sel of previewSelectors) {
      baselineCount = Math.max(baselineCount, document.querySelectorAll(sel).length);
    }

    const check = () => {
      // 检查是否还有上传中的指示器
      const stillUploading = uploadingSelectors.some(sel => document.querySelector(sel));
      if (stillUploading && Date.now() - start < timeoutMs) {
        setTimeout(check, 300);
        return;
      }

      // 检查新增图片预览数量是否达到预期
      let maxNewCount = 0;
      for (const sel of previewSelectors) {
        const current = document.querySelectorAll(sel).length;
        maxNewCount = Math.max(maxNewCount, current - baselineCount);
      }

      if (maxNewCount >= expectedCount || Date.now() - start >= timeoutMs) {
        // 额外等 500ms 让平台内部状态稳定
        setTimeout(resolve, 500);
        return;
      }
      setTimeout(check, 300);
    };
    // 首次检查延迟 500ms，给平台时间开始处理
    setTimeout(check, 500);
  });
}

async function handleInjectImages(images) {
  if (!images || images.length === 0) return { status: "ok" };

  const isClaude = window.location.hostname === "claude.ai";

  // 找到输入框
  const el =
    document.querySelector('#prompt-textarea') ||
    document.querySelector('div.ProseMirror[contenteditable="true"]') ||
    document.querySelector('.ql-editor[contenteditable="true"]') ||
    document.querySelector('#chat-input') ||
    document.querySelector('textarea[placeholder]') ||
    document.querySelector('textarea') ||
    document.querySelector('[contenteditable="true"]');

  if (!el) return { status: "error", error: "未找到输入框" };

  el.focus();

  for (const dataUrl of images) {
    try {
      // 将 dataUrl 转为 Blob
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const ext = blob.type.split("/")[1] || "png";
      const file = new File([blob], `image.${ext}`, { type: blob.type || "image/png" });

      // 方法1: 模拟粘贴事件到编辑器元素
      const dt = new DataTransfer();
      dt.items.add(file);

      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      });
      el.dispatchEvent(pasteEvent);

      await new Promise(r => setTimeout(r, 500));

      // 方法2: 对 Claude 额外尝试 — 在 document 级别派发 paste（ProseMirror 可能在更高层监听）
      if (isClaude) {
        const dt2 = new DataTransfer();
        dt2.items.add(file);
        document.dispatchEvent(new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: dt2,
        }));
        await new Promise(r => setTimeout(r, 500));
      }

      // 方法3: 对 Claude 尝试点击附件按钮唤出 file input
      if (isClaude) {
        const attachBtn =
          document.querySelector('button[aria-label="Attach files"]') ||
          document.querySelector('button[aria-label="Attach file"]') ||
          document.querySelector('button[aria-label*="ttach"]') ||
          document.querySelector('button[aria-label="Add content"]') ||
          document.querySelector('button[data-testid="file-upload"]') ||
          document.querySelector('fieldset button[type="button"]');
        if (attachBtn) {
          attachBtn.click();
          await new Promise(r => setTimeout(r, 500));
        }
      }

      // 方法4: 找 file input 并直接设置（放宽过滤条件）
      const fileInputs = document.querySelectorAll('input[type="file"]');
      let injected = false;
      for (const fi of fileInputs) {
        // 放宽条件：无 accept、accept 含 image/*、或 accept 含图片后缀均可
        const accept = (fi.accept || "").toLowerCase();
        if (!accept || accept.includes("image") || accept.includes("*") ||
            accept.includes(".png") || accept.includes(".jpg") || accept.includes(".jpeg") ||
            accept.includes(".gif") || accept.includes(".webp")) {
          try {
            const dt3 = new DataTransfer();
            dt3.items.add(file);
            fi.files = dt3.files;
            fi.dispatchEvent(new Event("change", { bubbles: true }));
            fi.dispatchEvent(new Event("input", { bubbles: true }));
            injected = true;
          } catch {}
          break;
        }
      }
      // 兜底：如果没有匹配的 file input，尝试所有 file input
      if (!injected && fileInputs.length > 0) {
        try {
          const fi = fileInputs[0];
          const dt3 = new DataTransfer();
          dt3.items.add(file);
          fi.files = dt3.files;
          fi.dispatchEvent(new Event("change", { bubbles: true }));
          fi.dispatchEvent(new Event("input", { bubbles: true }));
        } catch {}
      }

      // 方法5: 模拟 drop 事件（部分站点支持拖拽上传）
      if (isClaude) {
        try {
          const dtDrop = new DataTransfer();
          dtDrop.items.add(file);
          el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dtDrop }));
          el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dtDrop }));
        } catch {}
      }

      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.log("Image inject failed:", e);
    }
  }

  // 等待所有图片上传完成（轮询检测，最长15秒超时）
  await waitForImageUpload(images.length, 15000);

  return { status: "ok", count: images.length };
}
