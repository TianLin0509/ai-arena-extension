// tests/e2e/window-tile-real.mjs — v5.0.29 并列模式窗口平铺不重叠
// 用户反馈：靠右 AI 的最大化/关闭按钮被盖住/推出屏幕。根因 arrangeWindows 的 +7px 隐形边框
//   补偿让相邻窗口重叠 14px、最右窗口超屏 7px。修复后窗口精确平分、互不重叠。
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const EXT_PATH = path.join(PROJECT_ROOT, "src");
const USER_DATA_DIR = process.env.E2E_PROFILE_DIR || path.join(__dirname, ".wintile-profile");
if (!process.env.E2E_PROFILE_DIR && fs.existsSync(USER_DATA_DIR)) {
  try { fs.rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch (_) {}
}

const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
  channel: "chromium", headless: false,
  args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`,
    "--no-first-run", "--no-default-browser-check", "--disable-features=DisableLoadExtensionCommandLineSwitch"],
  viewport: { width: 1380, height: 900 },
});
function log(s) { console.log(`[wintile] ${s}`); }

try {
  let extId = ""; { const [sw] = ctx.serviceWorkers(); if (sw) extId = new URL(sw.url()).host; }
  if (!extId) extId = "ndiclbhabflkigblghlapmookalgglic";
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: "domcontentloaded" });
  await popup.waitForTimeout(1000);
  for (const p of ctx.pages()) { if (p.url().includes("welcome.html")) await p.close().catch(() => {}); }

  // 并列模式 + 加两个 AI（独立窗口）
  await popup.evaluate(() => new Promise(res => chrome.runtime.sendMessage({ type: "setWindowMode", mode: "tiled" }, () => res())));
  await popup.evaluate(() => window.ChatWindowMode?.set?.("tiled"));
  await popup.waitForTimeout(400);
  await popup.evaluate(() => new Promise(res => chrome.runtime.sendMessage({ type: "addParticipant", service: "deepseek" }, r => res(r))));
  await popup.waitForTimeout(4000);
  await popup.evaluate(() => new Promise(res => chrome.runtime.sendMessage({ type: "addParticipant", service: "kimi" }, r => res(r))));
  await popup.waitForTimeout(5000);   // 等第二次 addParticipant 后的 arrangeWindows(500ms) 完成

  // 取所有含 AI url 的普通窗口 bounds
  const wins = await popup.evaluate(() => new Promise(res => {
    chrome.windows.getAll({ populate: true }, (all) => {
      const aiWins = (all || [])
        .filter(w => w.type === "normal" && (w.tabs || []).some(t => /deepseek|kimi/.test(t.url || "")))
        .map(w => ({ id: w.id, left: w.left, width: w.width, top: w.top, height: w.height }))
        .sort((a, b) => a.left - b.left);
      res(aiWins);
    });
  }));
  log(`AI 窗口 bounds: ${JSON.stringify(wins)}`);
  assert.ok(wins.length >= 2, `应有 ≥2 个 AI 窗口，实际 ${wins.length}`);

  // 紧密相接：左窗口右边缘 ≈ 右窗口左边缘（间隙绝对值 ≤5px）——同时覆盖"不重叠"(旧 bug 是
  //   重叠 14px) 和"无大缝"。不依赖外部屏宽（DPI 缩放下 windows 用物理像素、system.display 用
  //   逻辑像素，无法直接比），用窗口间内部一致性验证完美平铺。
  for (let i = 0; i < wins.length - 1; i++) {
    const gap = wins[i + 1].left - (wins[i].left + wins[i].width);
    assert.ok(Math.abs(gap) <= 5,
      `窗口 ${i}/${i + 1} 应紧密相接（不重叠不留缝），实际间隙 ${gap}px`);
  }
  log("✓ 相邻窗口紧密相接、不重叠（靠右 AI 按钮不再被盖）");

  // 窗口宽度大致相等（平均分屏幕）
  const widths = wins.map(w => w.width);
  const maxDiff = Math.max(...widths) - Math.min(...widths);
  assert.ok(maxDiff <= 5, `各窗口宽度应基本相等（平分），最大差 ${maxDiff}`);
  log(`✓ 窗口宽度平分（各 ${widths.join("/")}px）`);

  // focusAllAiTabs 仍正常（需求1：内部会调 focusPopup，E2E popup 为 tab 无 popupWindowId，
  //   focusPopup 静默失败但不影响 focusAllAiTabs 返回 ok）
  const fr = await popup.evaluate(() => new Promise(res => chrome.runtime.sendMessage({ type: "focusAllAiTabs" }, r => res(r))));
  assert.ok(fr?.ok && fr.focused >= 2, `focusAllAiTabs 应成功: ${JSON.stringify(fr)}`);
  log(`✓ 唤起 AI 仍正常 focused=${fr.focused}（需求1 focusPopup 真机生效，E2E tab 环境静默跳过）`);

  console.log("[wintile] ✅ 窗口平铺不重叠验证通过");
} finally {
  await ctx.close();
}
