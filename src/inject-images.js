// AI Arena — 图片注入通用逻辑
// 被各 content script 引用 — 函数必须在 global scope 让 content-{service}.js typeof 检测到
// v4.8.60 说明：inject-images.js 不包 IIFE — 包了会让顶层 function 变成 IIFE 局部，
//   content-{service}.js 内的 `typeof postProcessBlobUrls === "function"` 会失败 → 功能断
//   重复注入只是重复创建 function（function declaration 允许重声明），开销可忽略
//   防 listener 重复注册的责任在使用者：函数体内若 addEventListener，应自带 guard 标志

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
  // v4.3.10: 先移除 UI 噪声容器（工具栏、推荐卡片、安装按钮等），再抽文本
  const NOISE_SEL = [
    'button',
    '[role="button"]',
    '[class*="action-bar"]',
    '[class*="action_bar"]',
    '[class*="actions"]',
    '[class*="toolbar"]',
    '[class*="message-actions"]',
    '[class*="op-bar"]',
    '[class*="op_bar"]',
    '[class*="opt-bar"]',
    '[class*="recommend"]',
    '[class*="suggest"]',
    '[class*="related"]',
    '[class*="install"]',
    '[class*="download"]',
    '[class*="select-all"]',
    '[class*="select_all"]',
    '[class*="footer-tip"]',
    '[class*="bottom-tip"]',
    '[class*="suggest-card"]',
    '[class*="recommend-card"]',
    '[class*="prompt-card"]',
    '[class*="discover"]',
  ].join(",");
  try { clone.querySelectorAll(NOISE_SEL).forEach(el => el.remove()); } catch {}

  // v4.6.5: KaTeX / MathJax 数学公式去重 + 输出干净 LaTeX 源码
  // ChatGPT / Claude / Gemini 等 AI 网页用 KaTeX 渲染公式，典型 DOM 结构：
  //   <span class="katex">
  //     <span class="katex-mathml"><math>...<annotation encoding="application/x-tex">\theta</annotation></math></span>
  //     <span class="katex-html">θ</span>     ← visible 渲染
  //   </span>
  // innerText 会拼接 mathml + html-render + annotation，导致 "θ\thetaθ" 三段重复。
  // 修复：找 .katex 节点 → 提取 annotation 里的 LaTeX 源码 → 用 $LaTeX$ 文本替换整段。
  try {
    // 块级 .katex-display 先处理（含子 .katex），整段替换为 $$LaTeX$$
    clone.querySelectorAll(".katex-display").forEach(blockEl => {
      const ann = blockEl.querySelector('annotation[encoding="application/x-tex"]');
      let latex = "";
      if (ann) latex = (ann.textContent || "").trim();
      else {
        const visible = blockEl.querySelector(".katex-html") || blockEl.querySelector(".katex");
        latex = (visible?.textContent || blockEl.textContent || "").trim();
      }
      const wrapped = latex ? `\n\n$$${latex}$$\n\n` : "";
      blockEl.parentNode?.replaceChild(document.createTextNode(wrapped), blockEl);
    });
    // 行内 .katex（剩下的非块级）
    clone.querySelectorAll(".katex").forEach(k => {
      const ann = k.querySelector('annotation[encoding="application/x-tex"]');
      let latex = "";
      if (ann) latex = (ann.textContent || "").trim();
      else {
        const visible = k.querySelector(".katex-html");
        latex = (visible?.textContent || k.textContent || "").trim();
      }
      const wrapped = latex ? `$${latex}$` : "";
      k.parentNode?.replaceChild(document.createTextNode(wrapped), k);
    });
    // MathJax 备用（Claude / 部分页面用 mjx-container）
    clone.querySelectorAll("mjx-container").forEach(m => {
      const isBlock = m.getAttribute("display") === "true" || m.getAttribute("ctxtmenu_counter") || /block/i.test(m.getAttribute("display") || "");
      const script = m.querySelector('script[type^="math/tex"]');
      let latex = script?.textContent?.trim() || "";
      if (!latex) {
        const mathEl = m.querySelector("math");
        const ann2 = mathEl?.querySelector('annotation[encoding="application/x-tex"]');
        if (ann2) latex = (ann2.textContent || "").trim();
        else latex = (m.textContent || "").trim();
      }
      const wrapped = latex ? (isBlock ? `\n\n$$${latex}$$\n\n` : `$${latex}$`) : "";
      m.parentNode?.replaceChild(document.createTextNode(wrapped), m);
    });
    // 裸 MathML（无 katex 包装）
    clone.querySelectorAll("math").forEach(mathEl => {
      if (mathEl.closest("script") || mathEl.parentElement?.tagName === "ANNOTATION") return;
      const ann3 = mathEl.querySelector('annotation[encoding="application/x-tex"]');
      const latex = ann3?.textContent?.trim() || mathEl.textContent?.trim() || "";
      const isBlock = mathEl.getAttribute("display") === "block";
      const wrapped = latex ? (isBlock ? `\n\n$$${latex}$$\n\n` : `$${latex}$`) : "";
      mathEl.parentNode?.replaceChild(document.createTextNode(wrapped), mathEl);
    });
  } catch (e) { /* sanitize 失败不阻塞主提取流程 */ }

  const imgs = clone.querySelectorAll("img");
  const seenSrcs = new Set();  // v4.3.3: 按 src 去重，避免 ChatGPT 等嵌套渲染同图多副本
  // v4.3.7: 引用源 / 搜索结果 / link card 容器内的图视为装饰，跳过
  const CITATION_ANCESTOR_SEL = '[class*="citation"], [class*="reference"], [class*="search-result"], [class*="search_result"], [class*="link-card"], [class*="link_card"], [class*="ref-card"], [class*="ref_card"], [class*="source-card"], [class*="source_card"], [class*="quote-card"], [class*="ref-item"], [class*="ref_item"], [class*="hyper-link"], [class*="hyper_link"]';
  imgs.forEach((img, idx) => {
    const src = img.getAttribute("src") || "";
    if (!src) { img.remove(); return; }
    const w = img.naturalWidth || img.width || parseInt(img.getAttribute("width") || "0", 10);
    const h = img.naturalHeight || img.height || parseInt(img.getAttribute("height") || "0", 10);
    // v4.3.7: 阈值从 40 提到 60，过滤元宝太极图等装饰小图
    const isTinyIcon = (w && w < 60) || (h && h < 60);
    const okHttp = /^https?:\/\//i.test(src);
    const okData = /^data:image\//i.test(src);
    const okBlob = /^blob:/i.test(src);
    if (!(okHttp || okData || okBlob) || isTinyIcon) {
      img.remove();
      return;
    }
    // v4.3.7: 在引用源/超链接卡片内的图视为装饰，跳过
    if (img.closest(CITATION_ANCESTOR_SEL)) {
      img.remove();
      return;
    }
    if (seenSrcs.has(src)) {
      img.remove();
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

  // v4.8.26: 提取 markdown 结构（标题/列表/加粗/斜体/链接/表格/分隔符）
  // 之前 clone.innerText 把 <h3>核心共识</h3> 平铺成"核心共识"，丢了 ### 标记；
  // <ul><li> 列表平铺成单行段落；<strong> 也丢了 **。
  // 修复：在 cloneNode 上按 DOM 类型替换成对应 markdown text node，让 popup-markdown.js 能重渲染。
  try {
    // ---- 行内级先处理：strong/em/del/a — text node 替换后嵌套容器 innerText 仍能拿到带标记的内容 ----
    clone.querySelectorAll("strong, b").forEach(el => {
      const t = (el.innerText || el.textContent || "").trim();
      if (!t || el.dataset?.mdDone) return;
      el.parentNode?.replaceChild(document.createTextNode(`**${t}**`), el);
    });
    clone.querySelectorAll("em, i").forEach(el => {
      const t = (el.innerText || el.textContent || "").trim();
      if (!t) return;
      el.parentNode?.replaceChild(document.createTextNode(`*${t}*`), el);
    });
    clone.querySelectorAll("del, s, strike").forEach(el => {
      const t = (el.innerText || el.textContent || "").trim();
      if (!t) return;
      el.parentNode?.replaceChild(document.createTextNode(`~~${t}~~`), el);
    });
    clone.querySelectorAll("a[href]").forEach(a => {
      const href = a.getAttribute("href") || "";
      const t = (a.innerText || a.textContent || "").trim();
      if (!href || !t || href.startsWith("javascript:")) return;
      // 内部锚点（#anchor）保留纯文本即可
      if (href.startsWith("#")) {
        a.parentNode?.replaceChild(document.createTextNode(t), a);
        return;
      }
      a.parentNode?.replaceChild(document.createTextNode(`[${t}](${href})`), a);
    });

    // ---- 块级再处理：h1-h6 / ul / ol / blockquote / hr / table ----
    // 标题：从 h6 反向到 h1（避免外层 h1 替换前 querySelectorAll 已经扫到内嵌的 h3）
    for (let lvl = 6; lvl >= 1; lvl--) {
      clone.querySelectorAll(`h${lvl}`).forEach(h => {
        const t = (h.innerText || h.textContent || "").trim();
        if (!t) return;
        const hashes = "#".repeat(lvl);
        h.parentNode?.replaceChild(document.createTextNode(`\n\n${hashes} ${t}\n\n`), h);
      });
    }
    // 列表（嵌套支持：每个 ul/ol 独立处理，内层先被外层 :scope > li 的 innerText 包含）
    clone.querySelectorAll("ul, ol").forEach(list => {
      // 跳过已被外层处理过的（parentNode 是 text node 时跳过）
      if (!list.parentNode || list.parentNode.nodeType !== 1) return;
      const isOl = list.tagName === "OL";
      const items = [...list.children].filter(c => c.tagName === "LI");
      if (!items.length) return;
      const lines = items.map((li, idx) => {
        const text = (li.innerText || li.textContent || "").trim().replace(/\n+/g, " ");
        const prefix = isOl ? `${idx + 1}. ` : "- ";
        return prefix + text;
      });
      list.parentNode.replaceChild(document.createTextNode(`\n\n${lines.join("\n")}\n\n`), list);
    });
    // blockquote
    clone.querySelectorAll("blockquote").forEach(bq => {
      const txt = (bq.innerText || bq.textContent || "").trim();
      if (!txt) return;
      const md = txt.split("\n").map(l => (l.trim() ? `> ${l}` : "")).join("\n");
      bq.parentNode?.replaceChild(document.createTextNode(`\n\n${md}\n\n`), bq);
    });
    // hr
    clone.querySelectorAll("hr").forEach(hr => {
      hr.parentNode?.replaceChild(document.createTextNode("\n\n---\n\n"), hr);
    });
    // table
    clone.querySelectorAll("table").forEach(table => {
      const rows = [...table.querySelectorAll("tr")];
      if (rows.length < 2) return;
      const cells = rows.map(tr =>
        [...tr.querySelectorAll("th, td")].map(c =>
          (c.innerText || c.textContent || "").trim().replace(/\|/g, "\\|").replace(/\n+/g, " ")
        )
      );
      if (!cells[0]?.length) return;
      const headers = cells[0];
      const body = cells.slice(1);
      const md = `\n\n| ${headers.join(" | ")} |\n|${headers.map(() => "---").join("|")}|\n` +
                 body.map(r => `| ${r.join(" | ")} |`).join("\n") + "\n\n";
      table.parentNode?.replaceChild(document.createTextNode(md), table);
    });
  } catch (e) { /* markdown 结构提取失败不阻塞主流程 */ }

  // v4.3.8: cloneNode 后游离的 DOM 上 innerText 在 Chrome 上不可靠（嵌套结构
  // 经常返回空字符串），优先用 innerText，fallback 到 textContent。
  // 这是 Kimi 等深嵌套布局抓不到内容的根因。
  const out = clone.innerText;
  if (out && out.trim()) return out;
  return clone.textContent || "";
}

function extractTextWithFences(el) {
  if (!el) return "";
  try {
    const clone = el.cloneNode(true);
    return _doExtractWithFences(clone);
  } catch (e) {
    return el.innerText || el.textContent || "";
  }
}

// v4.5.4 F1: 共享给各 content-*.js 的 heuristic 前置检查
// 没有任何用户消息 DOM 时，"找文档里最大文本块" heuristic 会把主页装饰文（如 Kimi 的
// ![activity image](kimi-img.moonshot.cn/...) banner）误抓成 AI 回答 → 污染辩论上下文
function hasUserMessageInDom() {
  // 覆盖各 AI 平台的常见 user message 标记
  return !!document.querySelector(
    '[class*="user-message"], [class*="human-message"], [class*="HumanMessage"], '
    + '[data-message-author-role="user"], [data-testid*="user-message"], '
    + '[data-author-role="user"], [class*="user-bubble"], [class*="userMessage"], '
    + 'user-query, message-user, [data-role="user"]'
  );
}
