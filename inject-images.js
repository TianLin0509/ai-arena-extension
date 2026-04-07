// AI Arena — 图片注入通用逻辑
// 被各 content script 引用

async function handleInjectImages(images) {
  if (!images || images.length === 0) return { status: "ok" };

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
      const file = new File([blob], "image.png", { type: blob.type });

      // 方法1: 模拟粘贴事件（大部分AI站点支持）
      const dt = new DataTransfer();
      dt.items.add(file);

      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      });
      el.dispatchEvent(pasteEvent);

      // 方法2: 如果粘贴不生效，尝试 drop 事件
      await new Promise(r => setTimeout(r, 300));

      // 方法3: 尝试找 file input 并直接设置
      const fileInputs = document.querySelectorAll('input[type="file"]');
      for (const fi of fileInputs) {
        if (fi.accept && (fi.accept.includes("image") || fi.accept.includes("*"))) {
          try {
            const dt2 = new DataTransfer();
            dt2.items.add(file);
            fi.files = dt2.files;
            fi.dispatchEvent(new Event("change", { bubbles: true }));
          } catch {}
          break;
        }
      }

      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.log("Image inject failed:", e);
    }
  }

  return { status: "ok", count: images.length };
}
