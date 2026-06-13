// tests/e2e/theme-contrast-real.mjs — v5.0.31 深色主题对比度修复
// 旧 bug：表格交替行 rgba(0,0,0,0.02) 黑半透明在深色主题(A/D/G)上几乎不可见。
// 修复：中性灰 rgba(128,128,128,...) 双主题可见。本测试在深色主题 A 下验证渲染色值。
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const EXT_PATH = path.join(PROJECT_ROOT, "src");
const USER_DATA_DIR = process.env.E2E_PROFILE_DIR || path.join(__dirname, ".theme-profile");
if (!process.env.E2E_PROFILE_DIR && fs.existsSync(USER_DATA_DIR)) {
  try { fs.rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch (_) {}
}
const ARTIFACTS = path.join(PROJECT_ROOT, ".arena", "artifacts", "theme");
fs.mkdirSync(ARTIFACTS, { recursive: true });

const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
  channel: "chromium", headless: false,
  args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`,
    "--no-first-run", "--no-default-browser-check", "--disable-features=DisableLoadExtensionCommandLineSwitch"],
  viewport: { width: 1380, height: 900 },
});
function log(s) { console.log(`[theme] ${s}`); }
function parseRGB(s) { const m = s.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/); return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null; }

try {
  let extId = ""; { const [sw] = ctx.serviceWorkers(); if (sw) extId = new URL(sw.url()).host; }
  if (!extId) extId = "ndiclbhabflkigblghlapmookalgglic";
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: "domcontentloaded" });
  await popup.waitForTimeout(900);
  for (const p of ctx.pages()) { if (p.url().includes("welcome.html")) await p.close().catch(() => {}); }

  // 切深色主题 A + 注入含表格/blockquote/嵌套列表的气泡
  const styles = await popup.evaluate(() => {
    document.body.setAttribute("data-theme", "A");
    const m = document.getElementById("chat-messages");
    const div = document.createElement("div");
    div.className = "msg ai";
    div.innerHTML = `<div class="msg-body"><div class="msg-bubble">
      <table class="md-table"><tbody>
        <tr><td>奇数行</td></tr><tr><td>偶数行</td></tr>
      </tbody></table>
      <blockquote>引用块文字</blockquote>
      <ul class="md-list"><li>一级<ul class="md-list"><li>二级嵌套</li></ul></li></ul>
    </div></div>`;
    m.appendChild(div);
    const even = m.querySelector(".md-table tbody tr:nth-child(even) td");
    const bq = m.querySelector(".msg-bubble blockquote");
    const nested = m.querySelector(".md-list .md-list");
    return {
      even: getComputedStyle(even).backgroundColor,
      bq: getComputedStyle(bq).backgroundColor,
      nestedMarginLeft: getComputedStyle(nested).marginLeft,
      bodyBg: getComputedStyle(document.body).getPropertyValue("--bg"),
    };
  });
  log(`深色主题 A 下：even=${styles.even} bq=${styles.bq} nestedML=${styles.nestedMarginLeft}`);

  // ① 表格交替行：应是中性灰（r≈g≈b 且都接近 128，非旧的黑 rgb(0,0,0)），alpha>0
  const evenRGB = parseRGB(styles.even);
  assert.ok(evenRGB && evenRGB.a > 0, `交替行应有可见背景: ${styles.even}`);
  assert.ok(evenRGB.r > 100 && Math.abs(evenRGB.r - evenRGB.g) <= 2 && Math.abs(evenRGB.g - evenRGB.b) <= 2,
    `交替行应是中性灰(非旧黑 rgb0,0,0)，实际 ${styles.even}`);
  log("① 表格斑马纹中性灰、深色主题可见 ✓");

  // ② blockquote：中性灰底（非固定蓝 rgb(10,132,255)）
  const bqRGB = parseRGB(styles.bq);
  assert.ok(bqRGB && Math.abs(bqRGB.r - bqRGB.g) <= 2 && Math.abs(bqRGB.g - bqRGB.b) <= 2,
    `blockquote 应是中性灰(非固定蓝)，实际 ${styles.bq}`);
  log("② blockquote 中性灰、不与非蓝主题撞色 ✓");

  // ③ 嵌套列表额外缩进
  assert.ok(parseFloat(styles.nestedMarginLeft) >= 16, `嵌套列表应有额外左缩进，实际 ${styles.nestedMarginLeft}`);
  log("③ 嵌套列表缩进 ✓");

  await popup.screenshot({ path: path.join(ARTIFACTS, "dark-theme-table.png") });
  console.log("[theme] ✅ 深色主题对比度修复验证通过");
} finally {
  await ctx.close();
}
