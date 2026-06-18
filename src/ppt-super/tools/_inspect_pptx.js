// inspect template pptx OOXML structure for slide duplication (page 2)
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
global.JSZip = require(ROOT + "/jszip.min.js");
(async () => {
  const buf = fs.readFileSync(ROOT + "/assets/tpl-01-quad-grid/template.pptx");
  const z = await JSZip.loadAsync(buf);
  console.log("=== files ===");
  console.log(Object.keys(z.files).join("\n"));
  for (const p of ["ppt/presentation.xml", "ppt/_rels/presentation.xml.rels", "[Content_Types].xml", "ppt/slides/_rels/slide1.xml.rels"]) {
    console.log("\n=== " + p + " ===");
    const f = z.file(p);
    console.log(f ? await f.async("string") : "(missing)");
  }
})().catch((e) => { console.error("ERR", e); process.exit(1); });
