// _verify_e2e_gen.js — 真实端到端验证：读真实文案 prompt → 调 DeepSeek 真实生成 → 程序化质检 JSON。
//   验证"PPT高手写稿法"prompt 是否让 AI 产出：整页规划(_plan)、全槽填满(无残留)、字数合规、
//   图文一体(_image_briefs)、紧扣 topic、不被模板原题材带跑(零穿帮)。
const fs = require("fs"), https = require("https"), path = require("path");
const ROOT = path.join(__dirname, "..");
const TOPIC = "新一代向量数据库在大模型检索场景下的性能优化进展";
const TID = "tpl-99-analysis-solution-split";
const prompt = fs.readFileSync(path.join(__dirname, "_verify_prompt_out.txt"), "utf8");
const toml = fs.readFileSync("C:/LinDangAgent/secrets.toml", "utf8");
const KEY = (toml.match(/DEEPSEEK_API_KEY\s*=\s*["']?([^"'\s]+)/) || [])[1];
if (!KEY) throw new Error("缺 DEEPSEEK_API_KEY");
const tpl = JSON.parse(fs.readFileSync(path.join(ROOT, "templates.json"), "utf8")).templates.find((t) => t.id === TID);

function extractJson(text) {
  let s = String(text).replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (m) s = m[1];
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e) {} }
  return null;
}
function budget(s) {
  if (!s.chars) return null;
  const lo = s.chars[0], hi = s.chars[1];
  const margin = hi <= 6 ? 0 : (hi <= 18 ? 2 : (hi <= 40 ? 3 : Math.round(hi * 0.10)));
  return { min: lo, cap: Math.max(lo, hi - margin) };
}

const MODEL = process.argv[2] || "deepseek-chat";
console.log("调 DeepSeek（" + MODEL + "）真实生成中（prompt " + prompt.length + " 字 · topic=" + TOPIC + "）…");
const payload = JSON.stringify({ model: MODEL, messages: [{ role: "user", content: prompt }], temperature: MODEL.indexOf("reasoner") >= 0 ? 1 : 0.3, max_tokens: 8000 });
const req = https.request(
  { hostname: "api.deepseek.com", path: "/chat/completions", method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY, "Content-Length": Buffer.byteLength(payload) } },
  (res) => {
    let d = ""; res.on("data", (c) => (d += c));
    res.on("end", () => {
      let resp; try { resp = JSON.parse(d); } catch (e) { console.error("API 返回非 JSON:", d.slice(0, 300)); process.exit(1); }
      if (!resp.choices) { console.error("API 错误:", JSON.stringify(resp).slice(0, 300)); process.exit(1); }
      const content = resp.choices[0].message.content;
      fs.writeFileSync(path.join(__dirname, "_verify_e2e_raw.txt"), content);
      const obj = extractJson(content);
      if (!obj) { console.error("✗ 无法解析返回 JSON。原文前 400 字:\n" + content.slice(0, 400)); process.exit(1); }
      fs.writeFileSync(path.join(__dirname, "_verify_e2e_out.json"), JSON.stringify(obj, null, 2));
      report(obj);
    });
  }
);
req.setTimeout(150000, () => { console.error("超时"); req.destroy(); process.exit(1); });
req.on("error", (e) => { console.error("请求错误:", e.message); process.exit(1); });
req.write(payload); req.end();

function report(obj) {
  const isArrow = (s) => /箭头/.test((s.zh || "") + (s.hint || ""));
  const textSlots = tpl.slots.filter((s) => s.type !== "image" && s.type !== "icon" && !isArrow(s));
  const imgSlots = tpl.slots.filter((s) => s.type === "image" || s.type === "icon");
  console.log("\n===== 真实生成 JSON 质检（DeepSeek · " + TID + "）=====");
  const plan = obj._plan || {};
  const planKeys = ["page_task", "audience_takeaway", "thesis", "topic_anchor_terms", "story_spine", "slot_story_map"];
  const planHave = planKeys.filter((k) => plan[k] && JSON.stringify(plan[k]).length > 4);
  console.log("\n[1] _plan 整页规划: " + planHave.length + "/" + planKeys.length + " 要素齐全 " + (planHave.length >= 5 ? "✓" : "✗"));
  if (plan.thesis) console.log("    thesis: " + (typeof plan.thesis === "string" ? plan.thesis : JSON.stringify(plan.thesis)));
  if (plan.topic_anchor_terms) console.log("    锚点术语: " + JSON.stringify(plan.topic_anchor_terms));
  let filled = 0; const empty = [];
  textSlots.forEach((s) => { const v = obj[s.key]; if (v != null && String(v).trim()) filled++; else empty.push(s.key); });
  console.log("\n[2] 文字槽填充率（防占位残留）: " + filled + "/" + textSlots.length + (filled === textSlots.length ? " 全填 ✓" : " 缺[" + empty.join(",") + "] ✗"));
  const over = [], under = [];
  textSlots.forEach((s) => { const v = obj[s.key]; if (v == null) return; const L = String(v).length, b = budget(s); if (!b) return; if (L > b.cap) over.push(s.key + "(" + L + ">" + b.cap + ")"); else if (L < b.min) under.push(s.key + "(" + L + "<" + b.min + ")"); });
  console.log("\n[3] 字数合规: 超硬上限 " + over.length + " 个" + (over.length ? " [" + over.join(", ") + "]" : "") + " · 低于最低 " + under.length + " 个 " + (over.length === 0 ? "✓ 无爆框" : "⚠ 编辑器红框兜底"));
  const briefs = obj._image_briefs || {};
  const briefCov = imgSlots.filter((s) => briefs[s.key]).length;
  console.log("\n[4] _image_briefs 图文一体化: " + briefCov + "/" + imgSlots.length + " 配图位有 brief " + (briefCov >= imgSlots.length * 0.8 ? "✓" : "✗"));
  const sample = imgSlots.find((s) => briefs[s.key]);
  if (sample) console.log("    样例 " + sample.key + ": " + JSON.stringify(briefs[sample.key]).slice(0, 200));
  const anchors = ["向量", "数据库", "检索", "大模型", "性能", "优化"];
  const allText = textSlots.map((s) => obj[s.key] || "").join(" ");
  const hit = anchors.filter((a) => allText.includes(a));
  console.log("\n[5] topic 锚定: 正文命中 " + hit.length + "/" + anchors.length + " 个核心词 [" + hit.join(",") + "] " + (hit.length >= 4 ? "✓" : "✗"));
  const offTopic = ["5G", "信道", "小区", "基站", "时延抖动", "NR", "昇腾", "超节点"];
  const leaked = offTopic.filter((w) => allText.includes(w));
  console.log("\n[6] 零穿帮检测（模板原 5G 题材词是否泄漏到正文）: " + (leaked.length === 0 ? "✓ 无泄漏，正文紧扣本 topic" : "⚠ 泄漏 [" + leaked.join(",") + "]"));
  console.log("\n产物: _verify_e2e_out.json / _verify_e2e_raw.txt");
}
