// ppt-super/ppt-fill.js — 浏览器内 pptx 填充引擎
// 1:1 复刻 ppt-assistant/oneclick/engine.py 的 fill_pptx + _set_tf_text：
//   按 role 算行（para 合并空白成单段；其他按 \n 分行；bullets 加 •）
//   只替换 <a:t> 文字、保留 <a:rPr> 格式 → 天然保留华为样式
//   多行 = 克隆首段 <a:p>；超长 15% → 字号 *0.88（下限 7pt）
// 双页（2026-06-17）：第1页=截断版（视觉优先，文字截到上限内不溢出/不缩字号）；
//   第2页=全量版（用户自用）—— 仅当确有字段被截断时才追加第2页。
// 纯字符串操作，不用 DOMParser（避免 XMLSerializer 破坏 pptx；node 亦可单测）
(function () {
  "use strict";

  function escXml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function computeLines(role, v) {
    var s = String(v == null ? "" : v);
    var lines;
    if (role === "para") {
      lines = s.trim() ? [s.split(/\s+/).join(" ")] : [];
    } else {
      lines = s.split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
    }
    if (role === "bullets") {
      lines = lines.map(function (l) {
        return l.charAt(0) === "•" ? l : "• " + l.replace(/^[·\-• ]+/, "");
      });
    }
    return lines;
  }

  // ---------- 截断（双页第1页：硬截到模板字数上限 chars[1]，视觉优先填满框）----------
  // 第1页只为视觉效果：截在哪不关键，关键是「字数=模板上限」。chars[1] 经几何重标(B)后已等于框真实容量，
  // 所以直接硬切到 chars[1] 就是把框填满、不溢出；不绕语义边界（切到逗号会丢半句、反而留白稀疏）。
  // bullets：上限是每条 bullet 的字数 → 逐条截；para/其余：上限是整段总字数 → 整体截。
  function hardCut(str, hi) { return str.length > hi ? str.slice(0, hi) : str; }
  function truncSlotValue(slot, v) {
    var s = String(v == null ? "" : v);
    var hi = slot.chars && slot.chars[1];
    if (!hi) return s;
    if (slot.role === "bullets") {
      var lines = s.split("\n");
      if (slot.max_lines) lines = lines.slice(0, Math.max(1, parseInt(slot.max_lines, 10) || 1));
      return lines.map(function (l) { return hardCut(l, hi); }).join("\n");
    }
    if (slot.role === "para") {
      // 仅在真超长时才合并空白+截断；未超长原样返回，避免空白归一化让 dataTrunc!==data 误判为"截断"而多生成全同的第2页
      var collapsed = s.replace(/\s+/g, " ").trim();
      return collapsed.length > hi ? hardCut(collapsed, hi) : s;
    }
    return hardCut(s, hi);
  }
  // 对外：单 slot 截断（预览浮层用）
  function truncateSlot(slot, v) {
    if (!slot || slot.type === "image" || slot.type === "icon") return String(v == null ? "" : v);
    return truncSlotValue(slot, v);
  }
  // 对外：生成「截断版」data（不改原 data；图/图标 slot 不截）—— 第1页与预览共用，保证一致
  function truncateData(slots, data) {
    var out = {};
    Object.keys(data || {}).forEach(function (k) { out[k] = data[k]; });
    (slots || []).forEach(function (s) {
      if (s.type === "image" || s.type === "icon") return;
      if (out[s.key] == null || String(out[s.key]).trim() === "") return;
      out[s.key] = truncSlotValue(s, out[s.key]);
    });
    return out;
  }

  // 段落内：首个 <a:t> 写入文字，其余 run 的 <a:t> 清空（复刻 runs[1:].text="")
  function setParaText(paraXml, text) {
    var n = 0;
    return paraXml.replace(/(<a:t[^>]*>)[\s\S]*?(<\/a:t>)/g, function (m, open, close) {
      n += 1;
      return n === 1 ? open + escXml(text) + close : open + close;
    });
  }
  function applyShrink(paraXml, shrink) {
    return paraXml.replace(/sz="(\d+)"/g, function (m, val) {
      return 'sz="' + Math.max(Math.round(parseInt(val, 10) * shrink), 700) + '"';
    });
  }

  // 替换 name="[key]" 形状的文字
  function fillShape(xml, key, lines, shrink) {
    var marker = 'name="[' + key + ']"';
    var mi = xml.indexOf(marker);
    if (mi < 0) return xml;                       // 该模板无此 slot，跳过
    var spStart = xml.lastIndexOf("<p:sp>", mi);
    var spEnd = xml.indexOf("</p:sp>", mi);
    if (spStart < 0 || spEnd < 0) return xml;
    spEnd += "</p:sp>".length;
    var sp = xml.slice(spStart, spEnd);

    var TB = "<p:txBody>", TBE = "</p:txBody>";
    var tb0 = sp.indexOf(TB), tb1 = sp.indexOf(TBE);
    if (tb0 < 0 || tb1 < 0) return xml;
    var head = sp.slice(0, tb0 + TB.length);      // ...<p:txBody>
    var tail = sp.slice(tb1);                     // </p:txBody>...</p:sp>
    var body = sp.slice(tb0 + TB.length, tb1);    // <a:bodyPr/><a:lstStyle/><a:p>...

    var p0 = body.indexOf("<a:p>");
    if (p0 < 0) return xml;
    var prefix = body.slice(0, p0);               // bodyPr + lstStyle（保留）
    var p0end = body.indexOf("</a:p>", p0) + "</a:p>".length;
    var tplPara = body.slice(p0, p0end);          // 首段当模板（保留 pPr + rPr）

    var use = lines.length ? lines : [""];
    var newParas = use.map(function (line) {
      var p = setParaText(tplPara, line);
      if (shrink) p = applyShrink(p, shrink);
      return p;
    }).join("");

    var newSp = head + prefix + newParas + tail;
    return xml.slice(0, spStart) + newSp + xml.slice(spEnd);
  }

  function fillSlideXml(xml, slots, data) {
    slots.forEach(function (s) {
      if (s.type === "image" || s.type === "icon") return;  // 图/图标都走贴图路径，不填文字
      var v = data[s.key];
      if (v == null || String(v).trim() === "") return;
      var lines = computeLines(s.role, v);
      var hi = (s.chars && s.chars[1]) || 0;
      var longest = lines.reduce(function (a, l) { return Math.max(a, l.length); }, 0);
      var shrink = (hi && longest > hi * 1.15) ? 0.88 : null;
      xml = fillShape(xml, s.key, lines, shrink);
    });
    return xml;
  }

  // 主入口：模板字节 + slots + data → pptx（浏览器 'blob'；node 单测传 'nodebuffer'）
  // 往 pptx 插图：image slot（占位框 bbox）位置叠一个 <p:pic>，加 media + slide rels + Content_Types
  var EMU = 6350; // 1px(1920宽画布) = 6350 EMU
  // slidePaths：要叠图的所有 slide（双页时两页都叠同一批图——图不参与截断）
  async function insertImages(zip, slots, images, slidePaths) {
    var imgs = slots.filter(function (s) { return (s.type === "image" || s.type === "icon") && images && images[s.key]; });
    if (!imgs.length) return;
    var picXml = "", relAdd = "", exts = {};
    imgs.forEach(function (s, k) {
      var m = /^data:image\/(\w+);base64,([\s\S]+)$/.exec(String(images[s.key]).trim());
      if (!m) return;
      var ext = m[1] === "jpeg" ? "jpg" : m[1];
      var fn = "ppts_" + s.key.replace(/[^a-zA-Z0-9_]/g, "") + "." + ext;
      zip.file("ppt/media/" + fn, m[2], { base64: true });
      var rid = "rIdPpts" + k;
      relAdd += '<Relationship Id="' + rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/' + fn + '"/>';
      var bb = s.bbox || [0, 0, 400, 300];
      picXml += '<p:pic><p:nvPicPr><p:cNvPr id="' + (900 + k) + '" name="ppts_img_' + s.key + '"/>' +
        '<p:cNvPicPr><a:picLocks noChangeAspect="0"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>' +
        '<p:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
        '<p:spPr><a:xfrm><a:off x="' + Math.round(bb[0] * EMU) + '" y="' + Math.round(bb[1] * EMU) + '"/>' +
        '<a:ext cx="' + Math.round(bb[2] * EMU) + '" cy="' + Math.round(bb[3] * EMU) + '"/></a:xfrm>' +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
      exts[ext] = m[1] === "jpeg" ? "image/jpeg" : "image/" + m[1];
    });
    if (!picXml) return;
    var paths = slidePaths && slidePaths.length ? slidePaths : ["ppt/slides/slide1.xml"];
    for (var i = 0; i < paths.length; i++) {
      var sPath = paths[i];
      var rPath = sPath.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels";
      var xml = await zip.file(sPath).async("string");
      zip.file(sPath, xml.replace("</p:spTree>", picXml + "</p:spTree>"));   // pic 叠最上层，盖住占位框
      var rels = await zip.file(rPath).async("string");
      zip.file(rPath, rels.replace("</Relationships>", relAdd + "</Relationships>"));
    }
    var ct = await zip.file("[Content_Types].xml").async("string");
    Object.keys(exts).forEach(function (ext) {
      if (ct.indexOf('Extension="' + ext + '"') < 0) ct = ct.replace("</Types>", '<Default Extension="' + ext + '" ContentType="' + exts[ext] + '"/></Types>');
    });
    zip.file("[Content_Types].xml", ct);
  }

  // 追加第2页（全量版）：slide2.xml + 复制 slide1 的 rels + 注册到 presentation/Content_Types
  // rId / sldId 取现有最大值 +1，避免与模板既有编号冲突（鲁棒，不写死 rId8/257）
  async function addPage2(zip, slideXml2, tplRels) {
    zip.file("ppt/slides/slide2.xml", slideXml2);
    zip.file("ppt/slides/_rels/slide2.xml.rels", tplRels);   // 同 layout；图片 rels 之后由 insertImages 追加

    var prels = await zip.file("ppt/_rels/presentation.xml.rels").async("string");
    var maxRid = 0;
    prels.replace(/Id="rId(\d+)"/g, function (m, n) { maxRid = Math.max(maxRid, parseInt(n, 10)); return m; });
    var newRid = "rId" + (maxRid + 1);
    prels = prels.replace("</Relationships>",
      '<Relationship Id="' + newRid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>');
    zip.file("ppt/_rels/presentation.xml.rels", prels);

    var pres = await zip.file("ppt/presentation.xml").async("string");
    var maxSid = 255;
    pres.replace(/<p:sldId id="(\d+)"/g, function (m, n) { maxSid = Math.max(maxSid, parseInt(n, 10)); return m; });
    pres = pres.replace("</p:sldIdLst>", '<p:sldId id="' + (maxSid + 1) + '" r:id="' + newRid + '"/></p:sldIdLst>');
    zip.file("ppt/presentation.xml", pres);

    var ct = await zip.file("[Content_Types].xml").async("string");
    if (ct.indexOf('PartName="/ppt/slides/slide2.xml"') < 0)
      ct = ct.replace("</Types>", '<Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>');
    zip.file("[Content_Types].xml", ct);
  }

  async function build(templateBytes, slots, data, images, outputType) {
    if (typeof JSZip === "undefined") throw new Error("JSZip 未加载");
    var zip = await JSZip.loadAsync(templateBytes);
    var slidePath = "ppt/slides/slide1.xml";
    var f = zip.file(slidePath);
    if (!f) throw new Error("模板缺少 " + slidePath);
    var tplXml = await f.async("string");

    // 第1页：截断版（视觉优先，文字截到上限内，避免超限缩字号/溢出难看）
    var dataTrunc = truncateData(slots, data);
    zip.file(slidePath, fillSlideXml(tplXml, slots, dataTrunc));

    // 有字段被截断 → 追加第2页全量版（用户自用）；都没超限则保持单页（两页全同没意义）
    var truncated = (slots || []).some(function (s) {
      return s.type !== "image" && s.type !== "icon" && dataTrunc[s.key] !== data[s.key];
    });
    var slidePaths = [slidePath];
    if (truncated) {
      var tplRels = await zip.file("ppt/slides/_rels/slide1.xml.rels").async("string");
      await addPage2(zip, fillSlideXml(tplXml, slots, data), tplRels);
      slidePaths.push("ppt/slides/slide2.xml");
    }

    await insertImages(zip, slots, images, slidePaths);   // 文字写回后再叠图片（两页都叠）

    return zip.generateAsync({
      type: outputType || "blob",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      compression: "DEFLATE"
    });
  }

  var api = { build: build, fillSlideXml: fillSlideXml, computeLines: computeLines, truncateData: truncateData, truncateSlot: truncateSlot };
  if (typeof window !== "undefined") window.PptFill = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
