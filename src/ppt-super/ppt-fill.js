// ppt-super/ppt-fill.js — 浏览器内 pptx 填充引擎
// 1:1 复刻 ppt-assistant/oneclick/engine.py 的 fill_pptx + _set_tf_text：
//   按 role 算行（para 合并空白成单段；其他按 \n 分行；bullets 加 •）
//   只替换 <a:t> 文字、保留 <a:rPr> 格式 → 天然保留华为样式
//   多行 = 克隆首段 <a:p>；超长 15% → 字号 *0.88（下限 7pt）
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
  async function insertImages(zip, slots, images) {
    var imgs = slots.filter(function (s) { return (s.type === "image" || s.type === "icon") && images && images[s.key]; });
    if (!imgs.length) return;
    var slidePath = "ppt/slides/slide1.xml", relsPath = "ppt/slides/_rels/slide1.xml.rels", ctPath = "[Content_Types].xml";
    var xml = await zip.file(slidePath).async("string");
    var rels = await zip.file(relsPath).async("string");
    var ct = await zip.file(ctPath).async("string");
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
    xml = xml.replace("</p:spTree>", picXml + "</p:spTree>");     // pic 叠在最上层，盖住占位框
    rels = rels.replace("</Relationships>", relAdd + "</Relationships>");
    Object.keys(exts).forEach(function (ext) {
      if (ct.indexOf('Extension="' + ext + '"') < 0) ct = ct.replace("</Types>", '<Default Extension="' + ext + '" ContentType="' + exts[ext] + '"/></Types>');
    });
    zip.file(slidePath, xml); zip.file(relsPath, rels); zip.file(ctPath, ct);
  }

  async function build(templateBytes, slots, data, images, outputType) {
    if (typeof JSZip === "undefined") throw new Error("JSZip 未加载");
    var zip = await JSZip.loadAsync(templateBytes);
    var path = "ppt/slides/slide1.xml";
    var f = zip.file(path);
    if (!f) throw new Error("模板缺少 " + path);
    var xml = await f.async("string");
    xml = fillSlideXml(xml, slots, data);
    zip.file(path, xml);
    await insertImages(zip, slots, images);            // 文字写回后再叠图片
    return zip.generateAsync({
      type: outputType || "blob",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      compression: "DEFLATE"
    });
  }

  var api = { build: build, fillSlideXml: fillSlideXml, computeLines: computeLines };
  if (typeof window !== "undefined") window.PptFill = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
