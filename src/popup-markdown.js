// AI Arena — 完整 markdown 渲染（XSS-safe 转义 + 白名单标签）
// 支持：标题 h1-h6 / 粗斜体 / 删除线 / 行内 code / 代码块 / 链接 /
//       图片 / 无序+有序+任务列表（可嵌套） / 引用 / 表格 / 分割线
(function (global) {
  // v4.6.5: 简易 LaTeX → Unicode（覆盖通信 / 信号处理常用符号；不引 KaTeX 库 ~500KB bundle）
  const LATEX_SYMBOLS = {
    // 希腊小写
    alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε",
    zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ",
    lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", omicron: "ο",
    pi: "π", varpi: "ϖ", rho: "ρ", varrho: "ϱ",
    sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ",
    phi: "φ", varphi: "ϕ", chi: "χ", psi: "ψ", omega: "ω",
    // 希腊大写
    Alpha: "Α", Beta: "Β", Gamma: "Γ", Delta: "Δ", Epsilon: "Ε", Zeta: "Ζ",
    Eta: "Η", Theta: "Θ", Iota: "Ι", Kappa: "Κ", Lambda: "Λ", Mu: "Μ",
    Nu: "Ν", Xi: "Ξ", Omicron: "Ο", Pi: "Π", Rho: "Ρ", Sigma: "Σ",
    Tau: "Τ", Upsilon: "Υ", Phi: "Φ", Chi: "Χ", Psi: "Ψ", Omega: "Ω",
    // 运算
    times: "×", div: "÷", cdot: "·", pm: "±", mp: "∓",
    leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠",
    ll: "≪", gg: "≫", approx: "≈", equiv: "≡", sim: "∼", simeq: "≃", cong: "≅", propto: "∝",
    // 集合 / 逻辑
    in: "∈", notin: "∉", ni: "∋", subset: "⊂", supset: "⊃",
    subseteq: "⊆", supseteq: "⊇", cup: "∪", cap: "∩",
    setminus: "∖", emptyset: "∅", varnothing: "∅",
    forall: "∀", exists: "∃", nexists: "∄",
    land: "∧", lor: "∨", lnot: "¬", neg: "¬",
    // 箭头
    rightarrow: "→", to: "→", leftarrow: "←", gets: "←", leftrightarrow: "↔",
    Rightarrow: "⇒", Leftarrow: "⇐", Leftrightarrow: "⇔",
    longrightarrow: "⟶", longleftarrow: "⟵", mapsto: "↦",
    uparrow: "↑", downarrow: "↓", Uparrow: "⇑", Downarrow: "⇓",
    // 微积分 / 求和 / 积分
    sum: "∑", prod: "∏", coprod: "∐",
    int: "∫", iint: "∬", iiint: "∭", oint: "∮",
    partial: "∂", nabla: "∇",
    // 极限 / 常数
    infty: "∞", infin: "∞", aleph: "ℵ", hbar: "ℏ", ell: "ℓ",
    Re: "ℜ", Im: "ℑ", wp: "℘",
    // 几何
    angle: "∠", perp: "⊥", parallel: "∥", triangle: "△", square: "□",
    // 杂项
    dots: "…", ldots: "…", cdots: "⋯", vdots: "⋮", ddots: "⋱",
    deg: "°", prime: "′", dagger: "†", ddagger: "‡",
    bullet: "•", star: "★", ast: "∗", oplus: "⊕", otimes: "⊗",
    // 通信信号常用
    mathcal: "", boldsymbol: "", mathbf: "", mathit: ""
  };
  const SUB_MAP = {
    "0":"₀","1":"₁","2":"₂","3":"₃","4":"₄","5":"₅","6":"₆","7":"₇","8":"₈","9":"₉",
    "+":"₊","-":"₋","=":"₌","(":"₍",")":"₎",
    a:"ₐ", e:"ₑ", h:"ₕ", i:"ᵢ", j:"ⱼ", k:"ₖ", l:"ₗ",
    m:"ₘ", n:"ₙ", o:"ₒ", p:"ₚ", r:"ᵣ", s:"ₛ", t:"ₜ",
    u:"ᵤ", v:"ᵥ", x:"ₓ"
  };
  const SUP_MAP = {
    "0":"⁰","1":"¹","2":"²","3":"³","4":"⁴","5":"⁵","6":"⁶","7":"⁷","8":"⁸","9":"⁹",
    "+":"⁺","-":"⁻","=":"⁼","(":"⁽",")":"⁾",
    a:"ᵃ", b:"ᵇ", c:"ᶜ", d:"ᵈ", e:"ᵉ", f:"ᶠ", g:"ᵍ", h:"ʰ", i:"ⁱ",
    j:"ʲ", k:"ᵏ", l:"ˡ", m:"ᵐ", n:"ⁿ", o:"ᵒ", p:"ᵖ", r:"ʳ", s:"ˢ",
    t:"ᵗ", u:"ᵘ", v:"ᵛ", w:"ʷ", x:"ˣ", y:"ʸ", z:"ᶻ",
    // 大写（Unicode 部分存在）
    A:"ᴬ", B:"ᴮ", D:"ᴰ", E:"ᴱ", G:"ᴳ", H:"ᴴ", I:"ᴵ", J:"ᴶ", K:"ᴷ",
    L:"ᴸ", M:"ᴹ", N:"ᴺ", O:"ᴼ", P:"ᴾ", R:"ᴿ", T:"ᵀ", U:"ᵁ", V:"ⱽ", W:"ᵂ"
  };
  // 常用函数名：\sin \cos \log 等不该保留 backslash，去掉就是函数名
  const LATEX_FUNCTIONS = new Set([
    "sin", "cos", "tan", "cot", "sec", "csc",
    "arcsin", "arccos", "arctan",
    "sinh", "cosh", "tanh",
    "log", "ln", "lg", "exp", "lim", "limsup", "liminf",
    "max", "min", "sup", "inf", "arg",
    "det", "dim", "ker", "rank", "tr",
    "gcd", "lcm", "mod",
    "Pr", "Var", "Cov", "E"
  ]);
  function _toSubscript(str) {
    return String(str).split("").map(c => SUB_MAP[c] !== undefined ? SUB_MAP[c] : c).join("");
  }
  function _toSuperscript(str) {
    return String(str).split("").map(c => SUP_MAP[c] !== undefined ? SUP_MAP[c] : c).join("");
  }
  // 简化的 LaTeX → Unicode（多 pass 展开嵌套；上下标在循环内处理保证 \frac 能看到无嵌套花括号）
  function latexToUnicode(tex) {
    if (!tex) return "";
    let s = String(tex).trim();
    s = s.replace(/\\left|\\right/g, "");
    s = s.replace(/\\\\/g, " ");
    let prev;
    let iter = 0;
    do {
      prev = s;
      // 1) \mathbb{R} 等数集（先处理避免被 \text 通用替换吃掉）
      s = s.replace(/\\mathbb\s*\{\s*([A-Za-z])\s*\}/g, (m, c) => {
        const map = { R: "ℝ", N: "ℕ", Z: "ℤ", Q: "ℚ", C: "ℂ", P: "ℙ", F: "𝔽", E: "𝔼", H: "ℍ" };
        return map[c] || c;
      });
      // 2) \text \mathrm 等 → 内容
      s = s.replace(/\\(?:text|mathrm|operatorname|mathit|mathbf|boldsymbol|mathcal)\s*\{([^{}]*)\}/g, "$1");
      // 3) 命名符号 / 函数名（先转 Unicode/纯名，再做上下标 — 否则 e^{j\theta} 会被字符级 toSuperscript 把 backslash 也吃成上标）
      s = s.replace(/\\([a-zA-Z]+)/g, (m, name) => {
        if (LATEX_SYMBOLS[name] !== undefined) return LATEX_SYMBOLS[name];
        if (LATEX_FUNCTIONS.has(name)) return name;
        return m;
      });
      // 4) 上下标 _{...} ^{...}（此时内部命名符号已 Unicode 化，单字符 toSub/toSup 友好）
      s = s.replace(/\^\{([^{}]+)\}/g, (m, c) => _toSuperscript(c));
      s = s.replace(/_\{([^{}]+)\}/g, (m, c) => _toSubscript(c));
      // 5) \frac 和 \sqrt
      s = s.replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, "($1)/($2)");
      s = s.replace(/\\sqrt\s*\{([^{}]+)\}/g, "√($1)");
      s = s.replace(/\\sqrt\s+(\w)/g, "√$1");
      iter++;
    } while (s !== prev && iter < 8);
    // 剩余单字符上下标（命令展开后）
    s = s.replace(/\^(\S)/g, (m, c) => _toSuperscript(c));
    s = s.replace(/_(\S)/g, (m, c) => _toSubscript(c));
    // 多余空格压缩
    s = s.replace(/\s+/g, " ").trim();
    return s;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // 安全 URL：接受 http/https + data:image base64 + blob:（content-script 转成 data 后大多用不到）
  function safeUrl(url) {
    if (typeof url !== "string") return null;
    const u = url.trim();
    if (/^https?:\/\//i.test(u)) return u;
    if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(u)) return u;
    if (/^blob:/i.test(u)) return u;
    return null;
  }

  function renderInline(text) {
    // 已转义后再做内联替换。注意所有 `<`/`>`/`&` 已是 entity，
    // 所以用 entity 形式匹配，不会撞用户的字面文本。
    let s = text;
    // 行内 code 占位（避免内部被其他规则改）
    const inlineCodes = [];
    s = s.replace(/\x02INLINE([\s\S]*?)\x02/g, (m, c) => {
      const idx = inlineCodes.push(c) - 1;
      return `\x03IC${idx}\x03`;
    });
    // 粗体 **xxx**
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    // 斜体 *xxx* 或 _xxx_（避免误伤数学*：要求 *_ 后非空白且前非字母数字）
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>");
    s = s.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>");
    // 删除线 ~~xxx~~
    s = s.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
    // 图片 ![alt](url)
    s = s.replace(/!\[([^\]]*)\]\(([^\s)]+)\)/g, (m, alt, url) => {
      const u = safeUrl(url);
      if (!u) return m;
      return `<img src="${u}" alt="${alt}" class="md-img">`;
    });
    // 链接 [text](url)
    s = s.replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, (m, txt, url) => {
      const u = safeUrl(url);
      if (!u) return m;
      return `<a href="${u}" target="_blank" rel="noopener noreferrer">${txt}</a>`;
    });
    // 回填行内 code
    s = s.replace(/\x03IC(\d+)\x03/g, (m, i) => `<code>${inlineCodes[Number(i)]}</code>`);
    return s;
  }

  // 行类型识别
  function lineType(line) {
    if (/^\s*$/.test(line)) return "blank";
    if (/^(\s*)(#{1,6})\s+(.+)$/.test(line)) return "heading";
    if (/^(\s*)[-*]\s+\[[ xX]\]\s+/.test(line)) return "task";
    if (/^(\s*)[-*+]\s+/.test(line)) return "ul";
    if (/^(\s*)\d+\.\s+/.test(line)) return "ol";
    if (/^(?:>|&gt;)\s?/.test(line)) return "blockquote";
    if (/^\s*\|.*\|\s*$/.test(line)) return "table-row";
    if (/^\s*(?:[-*_]\s*){3,}\s*$/.test(line)) return "hr";
    return "paragraph";
  }

  function parseListItem(line, type) {
    const m = type === "task"
      ? line.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.+)$/)
      : type === "ul"
        ? line.match(/^(\s*)[-*+]\s+(.+)$/)
        : line.match(/^(\s*)\d+\.\s+(.+)$/);
    if (!m) return null;
    const indent = m[1].length;
    if (type === "task") return { indent, content: m[3], checked: m[2].toLowerCase() === "x" };
    return { indent, content: m[2] };
  }

  function renderTable(rows) {
    // rows: ["| h1 | h2 |", "|---|---|", "| a | b |", ...]
    if (rows.length < 2) return rows.join("\n");
    const parseRow = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(s => s.trim());
    const header = parseRow(rows[0]);
    const align = parseRow(rows[1]).map(c => {
      const left = c.startsWith(":");
      const right = c.endsWith(":");
      if (left && right) return "center";
      if (right) return "right";
      if (left) return "left";
      return null;
    });
    const body = rows.slice(2).map(parseRow);
    let html = '<table class="md-table"><thead><tr>';
    header.forEach((h, i) => {
      const a = align[i] ? ` style="text-align:${align[i]}"` : "";
      html += `<th${a}>${renderInline(h)}</th>`;
    });
    html += "</tr></thead><tbody>";
    body.forEach(row => {
      html += "<tr>";
      row.forEach((c, i) => {
        const a = align[i] ? ` style="text-align:${align[i]}"` : "";
        html += `<td${a}>${renderInline(c)}</td>`;
      });
      html += "</tr>";
    });
    html += "</tbody></table>";
    return html;
  }

  function renderMarkdown(src) {
    if (!src) return "";

    // 1) 提取代码块占位
    const codeBlocks = [];
    src = src.replace(/```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g, (m, lang, code) => {
      const idx = codeBlocks.push({ lang, code }) - 1;
      return `\x01CODE${idx}\x01`;
    });

    // 2) 行内 code 占位 — v4.6.5: 同时把内部 $ 替换为 sentinel 防止被后续 LaTeX 正则误匹配
    src = src.replace(/`([^`\n]+)`/g, (m, c) => `\x02INLINE${escapeHtml(c).replace(/\$/g, "\x06DLR\x06")}\x02`);

    // 2.5) v4.6.5: LaTeX 占位（$$...$$ 块级 + $...$ 行内）— 必须在 escapeHtml 之前，否则
    //        LaTeX 里的 \, {, }, < 等会被转义影响后续 latexToUnicode 转换
    const mathBlocks = [];
    src = src.replace(/\$\$([\s\S]+?)\$\$/g, (m, tex) => {
      const idx = mathBlocks.push({ block: true, tex: tex.trim() }) - 1;
      return `\x04MATH${idx}\x04`;
    });
    // 行内 $...$（避免误伤美元金额：要求 $ 后非空白 + 内部不含换行）
    src = src.replace(/\$([^\s$][^\n$]*?[^\s$]|[^\s$])\$/g, (m, tex) => {
      const idx = mathBlocks.push({ block: false, tex: tex.trim() }) - 1;
      return `\x04MATH${idx}\x04`;
    });

    // 3) 转义其它 HTML
    src = escapeHtml(src);

    // 4) 按行处理块级元素
    const lines = src.split("\n");
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const t = lineType(line);

      // hr
      if (t === "hr") { out.push("<hr>"); i++; continue; }

      // heading
      if (t === "heading") {
        const m = line.match(/^(\s*)(#{1,6})\s+(.+)$/);
        const level = m[2].length;
        out.push(`<h${level}>${renderInline(m[3])}</h${level}>`);
        i++; continue;
      }

      // blockquote（连续 > / &gt;）
      if (t === "blockquote") {
        const block = [];
        while (i < lines.length && lineType(lines[i]) === "blockquote") {
          block.push(lines[i].replace(/^(?:>|&gt;)\s?/, ""));
          i++;
        }
        out.push(`<blockquote>${block.map(renderInline).join("<br>")}</blockquote>`);
        continue;
      }

      // table（一行 |...| + 下一行 |---|）
      if (t === "table-row" && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        const rows = [lines[i], lines[i + 1]];
        i += 2;
        while (i < lines.length && lineType(lines[i]) === "table-row") {
          rows.push(lines[i]);
          i++;
        }
        out.push(renderTable(rows));
        continue;
      }

      // 列表（ul / ol / task）支持简单嵌套（2-space indent）
      if (t === "ul" || t === "ol" || t === "task") {
        const initialType = t;
        const items = [];
        while (i < lines.length) {
          const tt = lineType(lines[i]);
          if (tt !== "ul" && tt !== "ol" && tt !== "task") break;
          const parsed = parseListItem(lines[i], tt);
          if (!parsed) break;
          items.push({ ...parsed, type: tt });
          i++;
        }
        // 渲染顶层列表（嵌套仅支持两层）
        const baseIndent = items[0]?.indent ?? 0;
        const tag = initialType === "ol" ? "ol" : "ul";
        let html = `<${tag} class="md-list">`;
        const stack = [{ indent: baseIndent, tag }];
        items.forEach((it, idx) => {
          while (stack.length > 1 && it.indent < stack[stack.length - 1].indent) {
            html += `</${stack.pop().tag}>`;
          }
          if (it.indent > stack[stack.length - 1].indent) {
            const nestedTag = it.type === "ol" ? "ol" : "ul";
            html += `<${nestedTag} class="md-list">`;
            stack.push({ indent: it.indent, tag: nestedTag });
          }
          if (it.type === "task") {
            const checked = it.checked ? "checked" : "";
            html += `<li class="md-task"><input type="checkbox" ${checked} disabled> ${renderInline(it.content)}</li>`;
          } else {
            html += `<li>${renderInline(it.content)}</li>`;
          }
        });
        while (stack.length > 0) html += `</${stack.pop().tag}>`;
        out.push(html);
        continue;
      }

      // 段落：收集到 blank 或下一个块元素
      if (t === "paragraph") {
        const buf = [line];
        i++;
        while (i < lines.length) {
          const tt = lineType(lines[i]);
          if (tt !== "paragraph") break;
          buf.push(lines[i]);
          i++;
        }
        out.push(`<p>${renderInline(buf.join("<br>"))}</p>`);
        continue;
      }

      // blank
      i++;
    }

    let result = out.join("");

    // 5) 回填行内 code（renderInline 内部已处理，但代码块外的 inline 占位也要收尾）
    result = result.replace(/\x02INLINE([\s\S]*?)\x02/g, (m, c) => `<code>${c}</code>`);

    // 6) 回填代码块（含 html/svg 预览支持）
    result = result.replace(/\x01CODE(\d+)\x01/g, (m, idx) => {
      const { lang, code } = codeBlocks[Number(idx)];
      // 没有 lang 标记时用启发式检测代码内容是否像 HTML/SVG
      // （AI 平台 DOM 抓取时 class 可能不是标准 language-html，fence 会缺 lang）
      let effectiveLang = lang;
      if (!effectiveLang && code) {
        if (/<!DOCTYPE\s+html/i.test(code) || /<html[\s>]/i.test(code)) {
          effectiveLang = "html";
        } else if (/^\s*<svg[\s>]/i.test(code)) {
          effectiveLang = "svg";
        } else {
          // 含 ≥3 个常见 HTML 块级标签 → 视为 HTML 片段
          const tagMatches = code.match(/<\/?(html|head|body|div|p|span|h[1-6]|ul|ol|table|section|nav|footer|header|main|article|button|input|form|a|img|script|style|link|meta)\b/gi);
          if (tagMatches && tagMatches.length >= 3) effectiveLang = "html";
        }
      }
      const displayLang = effectiveLang || "";
      const langClass = displayLang ? ` class="language-${escapeHtml(displayLang)}"` : "";
      const preHtml = `<pre><code${langClass}>${escapeHtml(code)}</code></pre>`;
      const previewable = /^x?html$/i.test(displayLang) || /^svg$/i.test(displayLang);
      if (!previewable) return preHtml;
      // 把原始 code base64 存到 data-* —— popup-codepreview.js 切到预览时 decode 设 iframe.srcdoc
      let b64 = "";
      try {
        if (typeof btoa === "function") {
          b64 = btoa(unescape(encodeURIComponent(code)));
        } else {
          b64 = Buffer.from(code, "utf8").toString("base64");
        }
      } catch { b64 = ""; }
      const labelLang = displayLang.toUpperCase();
      return `<div class="code-block-wrap" data-lang="${escapeHtml(displayLang)}">
<div class="code-block-tabs">
<button class="code-block-tab active" data-tab="code">代码 ${escapeHtml(labelLang)}</button>
<button class="code-block-tab" data-tab="preview" title="在沙箱 iframe 中渲染">▶ 预览</button>
<button class="code-block-tab code-block-copy" data-tab="copy" title="复制">📋</button>
</div>
<div class="code-block-pane code-block-pane-code">${preHtml}</div>
<div class="code-block-pane code-block-pane-preview" data-html-b64="${b64}" hidden></div>
</div>`;
    });

    // v4.6.5: 回填 LaTeX 占位 → latexToUnicode 转 Unicode → 包 HTML
    result = result.replace(/\x04MATH(\d+)\x04/g, (m, i) => {
      const mb = mathBlocks[Number(i)];
      if (!mb) return m;
      const rendered = escapeHtml(latexToUnicode(mb.tex));
      return mb.block
        ? `<div class="md-math-block" title="${escapeHtml(mb.tex)}">${rendered}</div>`
        : `<span class="md-math" title="${escapeHtml(mb.tex)}">${rendered}</span>`;
    });

    // v4.6.5: 回填 inline code 内的 $ sentinel（step 2 保护过）
    result = result.replace(/\x06DLR\x06/g, "$");

    return result;
  }

  global.renderMarkdown = renderMarkdown;
  if (typeof module !== "undefined") module.exports = { renderMarkdown, escapeHtml, safeUrl };
})(typeof window !== "undefined" ? window : globalThis);
