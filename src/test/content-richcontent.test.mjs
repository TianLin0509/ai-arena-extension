// 用纯函数化 detectRichContent — 暴露为可测函数
// 注：content scripts 是浏览器环境，这里只测可纯化的 selector 字符串逻辑
import { test } from "node:test";
import assert from "node:assert/strict";

// 模拟最小 DOM 接口
class MockDOM {
  constructor(html) { this.html = html; }
  querySelector(sel) {
    return MockDOM._match(this.html, sel) ? { tagName: "div" } : null;
  }
  querySelectorAll(sel) {
    const matches = MockDOM._matchAll(this.html, sel);
    return { length: matches.length, forEach: (cb) => matches.forEach(cb), [Symbol.iterator]: () => matches[Symbol.iterator]() };
  }
  static _match(html, sel) {
    // 极简：只支持 class="xxx" 模糊匹配
    if (sel.includes("artifact")) return /class="[^"]*artifact/i.test(html);
    if (sel.includes("mermaid")) return /language-mermaid|class="[^"]*mermaid/i.test(html);
    if (sel.includes("canvas")) return /<canvas|class="[^"]*canvas/i.test(html);
    return false;
  }
  static _matchAll(html, sel) {
    if (sel.includes("img")) {
      const m = html.match(/<img/gi) || [];
      return m;
    }
    return [];
  }
}

// 测试逻辑层（复制 content-claude.js 的 detectRichContent）
function detectClaudeRich(dom) {
  const types = [];
  if (dom.querySelector('[class*="artifact"], iframe[src*="artifact"]')) types.push("artifact");
  const imgs = dom.querySelectorAll("main img");
  if (imgs.length > 1) types.push("image");
  if (dom.querySelector('code.language-mermaid, [class*="mermaid"]')) types.push("mermaid");
  return { hasRichContent: types.length > 0, richTypes: types };
}

test("Claude: 检测 artifact", () => {
  const dom = new MockDOM('<div class="artifact-card">x</div>');
  const r = detectClaudeRich(dom);
  assert.equal(r.hasRichContent, true);
  assert.deepEqual(r.richTypes, ["artifact"]);
});

test("Claude: 检测 mermaid", () => {
  const dom = new MockDOM('<code class="language-mermaid">graph</code>');
  const r = detectClaudeRich(dom);
  assert.equal(r.hasRichContent, true);
  assert.deepEqual(r.richTypes, ["mermaid"]);
});

test("Claude: 多图触发 image", () => {
  const dom = new MockDOM('<main><img src="1"><img src="2"></main>');
  const r = detectClaudeRich(dom);
  assert.deepEqual(r.richTypes, ["image"]);
});

test("Claude: 纯文本不触发", () => {
  const dom = new MockDOM('<p>hello world</p>');
  const r = detectClaudeRich(dom);
  assert.equal(r.hasRichContent, false);
  assert.deepEqual(r.richTypes, []);
});
