// _verify_twopage.js — 双页 PPTX 真实验证（截断第1页 + 全量第2页 + 图两页都叠 + 无超长单页）
// 用法: node _verify_twopage.js
const fs = require("fs");
const path = require("path");
const SUPER = path.join(__dirname, "..");
global.JSZip = require(SUPER + "/jszip.min.js");
const PptFill = require(SUPER + "/ppt-fill.js");
const OUT = path.join(__dirname, "_e2e_out");
const TPLS = require(SUPER + "/templates.json").templates;

const tplById = (id) => TPLS.find((t) => t.id === id);
const tplBytes = (t) => fs.readFileSync(path.join(SUPER, t.pptx.replace(/^ppt-super\//, "")));
const dataOf = (id) => JSON.parse(fs.readFileSync(path.join(OUT, id + ".data.json"), "utf8"));
const cnt = (s, sub) => s.split(sub).length - 1;

let pass = 0, fail = 0;
function ok(name, cond, extra) { (cond ? pass++ : fail++); console.log((cond ? "  ✓ " : "  ✗ ") + name + (extra && !cond ? "  >> " + extra : "")); }

// 1x1 红 PNG（测插图）
const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

(async () => {
  // ===== Test A：超长模板 → 双页，slide1=截断、slide2=全量（精确等价断言）=====
  console.log("\n[A] tpl-06-radial-hub（24 超长字段）→ 双页结构 + 截断/全量精确性");
  {
    const t = tplById("tpl-06-radial-hub"), bytes = tplBytes(t), data = dataOf("tpl-06-radial-hub");
    const buf = await PptFill.build(bytes, t.slots, data, null, "nodebuffer");
    const z = await JSZip.loadAsync(buf);
    const s1 = await z.file("ppt/slides/slide1.xml").async("string");
    const s2f = z.file("ppt/slides/slide2.xml");
    const s2 = s2f ? await s2f.async("string") : null;
    const pres = await z.file("ppt/presentation.xml").async("string");
    const prels = await z.file("ppt/_rels/presentation.xml.rels").async("string");
    const ct = await z.file("[Content_Types].xml").async("string");
    const s2rels = z.file("ppt/slides/_rels/slide2.xml.rels");

    ok("slide2.xml 存在", !!s2);
    ok("slide2.xml.rels 存在", !!s2rels);
    ok("presentation.xml sldIdLst 含 2 个 sldId", cnt(pres, "<p:sldId ") === 2, cnt(pres, "<p:sldId ") + " 个");
    ok("presentation.xml.rels 注册 slide2", prels.indexOf("slides/slide2.xml") >= 0);
    ok("[Content_Types] 含 slide2 override", ct.indexOf("/ppt/slides/slide2.xml") >= 0);

    // 精确等价：slide1 必须 === 用「截断 data」填出来的；slide2 必须 === 用「全量 data」填出来的
    const tplXml = await (await JSZip.loadAsync(bytes)).file("ppt/slides/slide1.xml").async("string");
    const expTrunc = PptFill.fillSlideXml(tplXml, t.slots, PptFill.truncateData(t.slots, data));
    const expFull = PptFill.fillSlideXml(tplXml, t.slots, data);
    ok("slide1.xml === 截断版填充结果（第1页=视觉截断）", s1 === expTrunc);
    ok("slide2.xml === 全量版填充结果（第2页=全量素材）", s2 === expFull);
    ok("两页内容确有差异（截断生效）", expTrunc !== expFull);

    // 逐 slot 复核：截断后每行/段字数 ≤ 模板上限 chars[1]（一字不差）；且确有 slot 被截短
    let truncCount = 0, overAfter = 0;
    const tr = PptFill.truncateData(t.slots, data);
    t.slots.forEach((s) => {
      if (s.type === "image" || s.type === "icon") return;
      const hi = s.chars && s.chars[1]; if (!hi) return;
      const full = data[s.key]; if (full == null || String(full).trim() === "") return;
      if (tr[s.key] !== full) truncCount++;
      const parts = s.role === "bullets" ? String(tr[s.key]).split("\n") : [String(tr[s.key]).replace(/\s+/g, " ")];
      parts.forEach((ln) => { if (ln.length > hi) overAfter++; });
    });
    ok("确有字段被截断（truncCount>0）", truncCount > 0, truncCount + " 个");
    ok("截断后每行/段字数均 ≤ 模板上限 chars[1]", overAfter === 0, overAfter + " 处超");

    fs.writeFileSync(path.join(OUT, "_verify_twopage_tpl06.pptx"), buf);
    console.log("  → 存盘 _verify_twopage_tpl06.pptx（待 COM 渲染两页）");
  }

  // ===== Test B：无超长 → 单页（不应凭空多一页）=====
  console.log("\n[B] tpl-06 短文本（全在上限内）→ 应保持单页");
  {
    const t = tplById("tpl-06-radial-hub"), bytes = tplBytes(t);
    const data = {};
    t.slots.forEach((s) => { if (s.type !== "image" && s.type !== "icon") data[s.key] = "短"; });  // 1 字，必 ≤ 上限
    const buf = await PptFill.build(bytes, t.slots, data, null, "nodebuffer");
    const z = await JSZip.loadAsync(buf);
    const pres = await z.file("ppt/presentation.xml").async("string");
    ok("无 slide2.xml", !z.file("ppt/slides/slide2.xml"));
    ok("presentation.xml 仅 1 个 sldId", cnt(pres, "<p:sldId ") === 1, cnt(pres, "<p:sldId ") + " 个");
  }

  // ===== Test C：含图模板 → 双页，两页都叠同一张图 =====
  console.log("\n[C] tpl-22-hero-split（超长+1图位）→ 双页 + 图叠在两页");
  {
    const t = tplById("tpl-22-hero-split"), bytes = tplBytes(t), data = dataOf("tpl-22-hero-split");
    const imgSlot = t.slots.find((s) => s.type === "image");
    const images = {}; images[imgSlot.key] = TINY_PNG;
    const buf = await PptFill.build(bytes, t.slots, data, images, "nodebuffer");
    const z = await JSZip.loadAsync(buf);
    const s1 = await z.file("ppt/slides/slide1.xml").async("string");
    const s2 = z.file("ppt/slides/slide2.xml") ? await z.file("ppt/slides/slide2.xml").async("string") : "";
    const r1 = await z.file("ppt/slides/_rels/slide1.xml.rels").async("string");
    const r2 = z.file("ppt/slides/_rels/slide2.xml.rels") ? await z.file("ppt/slides/_rels/slide2.xml.rels").async("string") : "";
    const media = Object.keys(z.files).filter((f) => f.indexOf("ppt/media/ppts_") === 0);

    ok("有 slide2.xml（含图模板也双页）", !!s2);
    ok("media 写入图片", media.length >= 1, media.join(","));
    ok("slide1 含 <p:pic>", s1.indexOf("<p:pic>") >= 0);
    ok("slide2 含 <p:pic>（第2页也有图）", s2.indexOf("<p:pic>") >= 0);
    ok("slide1.xml.rels 含图片关系", r1.indexOf("rIdPpts0") >= 0 && r1.indexOf("/media/ppts_") >= 0);
    ok("slide2.xml.rels 含图片关系", r2.indexOf("rIdPpts0") >= 0 && r2.indexOf("/media/ppts_") >= 0);

    fs.writeFileSync(path.join(OUT, "_verify_twopage_tpl22.pptx"), buf);
    console.log("  → 存盘 _verify_twopage_tpl22.pptx（待 COM 渲染两页）");
  }

  console.log("\n===== 结果: " + pass + " 通过 / " + fail + " 失败 =====");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("ERR", e && e.stack || e); process.exit(1); });
