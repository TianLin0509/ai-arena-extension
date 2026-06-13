// tests/e2e/memo-ui-real.mjs — v5.0.25 备忘录 Tab 布局验证
// 验证：① 每条占满整行（不被旧 float 环绕挤成窄柱）② 正文无内部滚动挤压
//       ③ 时间 + 操作按钮默认隐藏、hover 整条时浮现
// 用法：node tests/e2e/memo-ui-real.mjs
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const EXT_PATH = path.join(PROJECT_ROOT, "src");
const USER_DATA_DIR = process.env.E2E_PROFILE_DIR || path.join(__dirname, ".memo-ui-profile");
if (!process.env.E2E_PROFILE_DIR && fs.existsSync(USER_DATA_DIR)) {
  try { fs.rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch (_) {}
}
const ARTIFACTS = path.join(PROJECT_ROOT, ".arena", "artifacts", "memo-ui");
fs.mkdirSync(ARTIFACTS, { recursive: true });

const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
  channel: "chromium", headless: false,
  args: [
    `--disable-extensions-except=${EXT_PATH}`,
    `--load-extension=${EXT_PATH}`,
    "--no-first-run", "--no-default-browser-check",
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
  ],
  viewport: { width: 1380, height: 900 },
});

function log(s) { console.log(`[memo-ui] ${s}`); }

try {
  let extId = process.env.ARENA_EXT_ID || "";
  { const [sw] = ctx.serviceWorkers(); if (sw) extId = new URL(sw.url()).host; }
  if (!extId) extId = "ndiclbhabflkigblghlapmookalgglic";
  log(`ext=${extId}`);

  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: "domcontentloaded" });
  await popup.waitForTimeout(900);
  for (const p of ctx.pages()) { if (p.url().includes("welcome.html")) await p.close().catch(() => {}); }

  // 注入两条备忘录（一短一长）到 storage，与图中场景一致
  await popup.evaluate(() => new Promise(res => {
    const now = 1781000000000;
    const memos = [
      { id: "m1", text: "的最佳综合选择。", ts: now, source: { type: "popup", service: "deepseek" } },
      { id: "m2", text: "一步到位的旗舰体验。不过在给出最终结论前，我们也需要正视苹果生态的封闭性，以及安卓阵营在折叠屏、影像、快充上的持续领先——这才是 5000 元价位真正值得反复权衡的地方。", ts: now, source: { type: "popup", service: "deepseek" } },
    ];
    chrome.storage.local.set({ arenaMemos: memos }, () => res());
  }));

  await popup.evaluate(() => { window.ChatRightPanel?.activate("memos"); });
  await popup.waitForSelector(".memo-item", { timeout: 5000 });
  await popup.waitForTimeout(400);

  const items = await popup.locator(".memo-item").count();
  assert.equal(items, 2, `应渲染 2 条，实际 ${items}`);

  // ① 每条占满整行：item 宽度应接近 memo-list 宽度（不被挤窄）
  const widths = await popup.evaluate(() => {
    const list = document.querySelector(".memo-list");
    const item = document.querySelector(".memo-item");
    return { list: list.clientWidth, item: item.clientWidth };
  });
  assert.ok(widths.item >= widths.list * 0.9, `条目应占满整行：item=${widths.item} list=${widths.list}`);
  log(`① 整行占满 ✓ item=${widths.item} / list=${widths.list}`);

  // ② 来源徽章不折行（窄柱 bug 会让"圆桌·DeepSeek"折成两行）
  const srcLines = await popup.evaluate(() => {
    const src = document.querySelector(".memo-src");
    const lh = parseFloat(getComputedStyle(src).lineHeight) || 16;
    return Math.round(src.offsetHeight / lh);
  });
  assert.ok(srcLines <= 1, `来源徽章应单行，实际约 ${srcLines} 行`);
  log(`② 来源徽章单行 ✓`);

  // ③ 正文无内部滚动条（旧 max-height:120px 会让长文出现 scroll）
  const longScroll = await popup.evaluate(() => {
    const t = document.querySelectorAll(".memo-text")[1];
    return { scrollH: t.scrollHeight, clientH: t.clientHeight, overflowY: getComputedStyle(t).overflowY };
  });
  assert.ok(longScroll.scrollH <= longScroll.clientH + 2, `正文不应内部滚动：scrollH=${longScroll.scrollH} clientH=${longScroll.clientH}`);
  log(`③ 正文无滚动挤压 ✓ (overflowY=${longScroll.overflowY})`);

  // ④ 默认态：时间 + 操作隐藏
  const hidden = await popup.evaluate(() => {
    const it = document.querySelector(".memo-item");
    return {
      time: getComputedStyle(it.querySelector(".memo-time")).opacity,
      acts: getComputedStyle(it.querySelector(".memo-acts")).opacity,
    };
  });
  assert.equal(hidden.time, "0", "默认时间应隐藏");
  assert.equal(hidden.acts, "0", "默认操作应隐藏");
  await popup.screenshot({ path: path.join(ARTIFACTS, "memo-default.png") });
  log(`④ 默认态时间/操作隐藏 ✓`);

  // ⑤ hover 整条 → 浮现
  await popup.locator(".memo-item").first().hover();
  await popup.waitForTimeout(300);
  const shown = await popup.evaluate(() => {
    const it = document.querySelector(".memo-item");
    return {
      time: getComputedStyle(it.querySelector(".memo-time")).opacity,
      acts: getComputedStyle(it.querySelector(".memo-acts")).opacity,
    };
  });
  assert.equal(shown.time, "1", "hover 时间应浮现");
  assert.equal(shown.acts, "1", "hover 操作应浮现");
  await popup.screenshot({ path: path.join(ARTIFACTS, "memo-hover.png") });
  log(`⑤ hover 浮现时间/操作 ✓`);

  // 清理
  await popup.evaluate(() => new Promise(res => chrome.runtime.sendMessage({ type: "memoClear" }, res)));
  console.log("[memo-ui] ✅ 全部 5 项通过");
} finally {
  await ctx.close();
}
