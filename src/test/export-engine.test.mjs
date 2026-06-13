import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// export-engine.js 纯函数双出口（v5.0.34 导出引擎）
const require = createRequire(import.meta.url);
const E = require("../export-engine.js");

const STATE = {
  debateSession: { originalQuestion: "什么是张量？" },
  participants: [
    { service: "deepseek", name: "DeepSeek", response: "张量是多维数组。" },
    { service: "doubao", response: "豆包说：张量是高维矩阵。" },   // 无 name，用映射
    { service: "kimi", name: "Kimi" },                              // 无 response，应跳过
  ],
};

test("buildMarkdown：含问题 + 各有回答的 AI", () => {
  const md = E.buildMarkdown(STATE);
  assert.ok(md.includes("什么是张量？"), "应含问题");
  assert.ok(md.includes("## DeepSeek"), "应含 DeepSeek 小节");
  assert.ok(md.includes("张量是多维数组"), "应含 DeepSeek 回答");
  assert.ok(md.includes("## 豆包"), "无 name 应用 service 映射名");
  assert.ok(md.includes("2 家"), "脚注应标注实际回答数（kimi 无回答被跳过）");
});

test("buildMarkdown：跳过无回答的 AI", () => {
  const md = E.buildMarkdown(STATE);
  assert.ok(!md.includes("## Kimi"), "无 response 的 Kimi 不应出现");
});

test("buildShareHtml：自包含 + XSS 转义 + 无外部资源", () => {
  const h = E.buildShareHtml({ participants: [{ service: "deepseek", response: "<script>alert(1)</script>恶意" }] });
  assert.ok(h.includes("<!DOCTYPE html>"), "应是完整 HTML");
  assert.ok(h.includes("&lt;script&gt;"), "脚本应被转义");
  assert.ok(!h.includes("<script>alert"), "不应有未转义脚本注入");
  assert.ok(!/src=["']https?:/.test(h) && !/<link/.test(h), "应无外部资源请求（自包含）");
});

test("answeredParts：只保留有 response/responsePreview 的", () => {
  const parts = E.answeredParts({ participants: [{ response: "a" }, {}, { responsePreview: "b" }, { response: "" }] });
  assert.equal(parts.length, 2);
});

test("空 state 不抛错", () => {
  assert.doesNotThrow(() => E.buildMarkdown({}));
  assert.doesNotThrow(() => E.buildShareHtml(undefined));
  assert.equal(E.answeredParts(null).length, 0);
});
