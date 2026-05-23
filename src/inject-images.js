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
    document.querySelector('[role="textbox"]') ||
    document.querySelector('[contenteditable="true"]') ||
    document.querySelector('[contenteditable]');

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

// ──────────────────────────────────────────────────────────────
// extractTextWithFences(el):
// 把 AI 回答 DOM 转成"含 markdown 围栏"的纯文本。直接 el.innerText 会丢失
// <pre><code> 的代码块边界（如 Gemini 输出 HTML 时下游看到的是裸代码而非
// ```html ... ``` 块），导致 popup-markdown.js 不认识为代码块。
// 这里克隆 DOM、把每个 <pre> 替换成 "```<lang>\n<code>\n```" 文本节点，
// 再 innerText 拿全文。9 个 content-*.js 共用。
// v4.3.3: 统计还未加载完成的图片数量（仅算实质图片，跳过 <40px 装饰图标）
// chat-bus polling 用这个判定"text stable 但图还在加载" → 继续 poll 不算完成
function countPendingImages(rootEl) {
  try {
    const root = rootEl || document;
    const imgs = root.querySelectorAll("img");
    let pending = 0;
    imgs.forEach(img => {
      const widthAttr = parseInt(img.getAttribute("width") || "0", 10);
      const heightAttr = parseInt(img.getAttribute("height") || "0", 10);
      const isTinyIcon = (widthAttr && widthAttr < 40) || (heightAttr && heightAttr < 40);
      if (isTinyIcon) return;
      const src = img.getAttribute("src");
      if (!src) return;
      // complete=false 或 naturalWidth=0（src 已设但未加载完成）视为 pending
      if (!img.complete || img.naturalWidth === 0) pending++;
    });
    return pending;
  } catch { return 0; }
}

// v4.3.2: blob URL → data URL 转换辅助。content-script 在 AI 域名同源下能 fetch
// blob URL，转成 data: 后 popup（chrome-extension:// 跨 origin）才能渲染图片。
async function blobToDataUrl(blobUrl) {
  try {
    const r = await fetch(blobUrl);
    if (!r.ok) return null;
    const b = await r.blob();
    return await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(b);
    });
  } catch { return null; }
}

// v4.3.2: 二次处理——在已生成的 markdown 文本中把 blob:URL 替换成 data:URL
// 让 readLatestResponse 末尾 await 一次即可，不需大改 _extractEl/getLastResponseText 链路
async function postProcessBlobUrls(text) {
  if (!text || typeof text !== "string") return text || "";
  const blobRegex = /!\[([^\]]*)\]\((blob:[^)\s]+)\)/g;
  const matches = [...text.matchAll(blobRegex)];
  if (!matches.length) return text;
  let out = text;
  for (const m of matches) {
    const [full, alt, url] = m;
    const dataUrl = await blobToDataUrl(url);
    if (dataUrl) {
      out = out.split(full).join(`![${alt}](${dataUrl})`);
    }
  }
  return out;
}

function _doExtractWithFences(clone) {
  // 公共抽取逻辑（被 extractTextWithFences 异步/同步版复用）
  const imgs = clone.querySelectorAll("img");
  const seenSrcs = new Set();  // v4.3.3: 按 src 去重，避免 ChatGPT 等嵌套渲染同图多副本
  imgs.forEach((img, idx) => {
    const src = img.getAttribute("src") || "";
    if (!src) { img.remove(); return; }
    const w = img.naturalWidth || img.width || parseInt(img.getAttribute("width") || "0", 10);
    const h = img.naturalHeight || img.height || parseInt(img.getAttribute("height") || "0", 10);
    const isTinyIcon = (w && w < 40) || (h && h < 40);
    const okHttp = /^https?:\/\//i.test(src);
    const okData = /^data:image\//i.test(src);
    const okBlob = /^blob:/i.test(src);
    if (!(okHttp || okData || okBlob) || isTinyIcon) {
      img.remove();
      return;
    }
    if (seenSrcs.has(src)) {
      img.remove();  // 重复 src 跳过
      return;
    }
    seenSrcs.add(src);
    const alt = img.getAttribute("alt") || `image-${idx + 1}`;
    const mdImg = `\n\n![${alt}](${src})\n\n`;
    img.parentNode.replaceChild(document.createTextNode(mdImg), img);
  });
  const pres = clone.querySelectorAll("pre");
  pres.forEach(pre => {
    const codeEl = pre.querySelector("code") || pre;
    const text = codeEl.innerText || codeEl.textContent || "";
    const cls = (codeEl.className || "") + " " + (pre.className || "");
    const m = cls.match(/(?:language|lang)-([\w+#-]+)/i);
    const lang = m ? m[1] : "";
    const fence = "\n```" + lang + "\n" + text.replace(/\n+$/, "") + "\n```\n";
    pre.parentNode.replaceChild(document.createTextNode(fence), pre);
  });
  const inlineCodes = clone.querySelectorAll("code");
  inlineCodes.forEach(c => {
    if (c.closest("pre")) return;
    const t = c.innerText || c.textContent || "";
    if (!t) return;
    c.parentNode.replaceChild(document.createTextNode("`" + t + "`"), c);
  });
  return clone.innerText || "";
}

function extractTextWithFences(el) {
  if (!el) return "";
  try {
    const clone = el.cloneNode(true);
    return _doExtractWithFences(clone);
  } catch (e) {
    return el.innerText || "";
  }
}
