// 精确定位失败样本的 JSON.parse 报错位置与字符
const fs = require("fs");
const f = process.argv[2];
let t = fs.readFileSync(f, "utf8");
let m = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
let c = (m ? m[1] : t).trim();
console.log("file:", f, "| len:", c.length, "| has block:", !!m, "| fence count:", (t.match(/```/g) || []).length);
function tryp(s, lbl) {
  try { JSON.parse(s); console.log("  [" + lbl + "] OK"); return true; }
  catch (e) {
    console.log("  [" + lbl + "] " + e.message);
    let p = (e.message.match(/position (\d+)/) || [])[1];
    if (p != null) { p = +p; console.log("     code " + s.charCodeAt(p) + " char=" + JSON.stringify(s[p])); console.log("     ctx: " + JSON.stringify(s.slice(Math.max(0, p - 90), p + 30))); }
    return false;
  }
}
tryp(c, "raw block");
let rep = c.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/，(\s*[}\]])/g, "$1").replace(/,(\s*[}\]])/g, "$1");
tryp(rep, "after repair");
