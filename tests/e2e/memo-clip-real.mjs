// tests/e2e/memo-clip-real.mjs — v5.0.21 划线收藏真实链路 E2E
// 路径：真实 AI 站点页面划线 → content-shared 浮钮 → background ArenaMemoStore →
//       popup 备忘录 Tab 渲染（截图留证）
// 用法：node tests/e2e/memo-clip-real.mjs   （复用 .userdata profile + 真实扩展）
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const EXT_PATH = path.join(PROJECT_ROOT, "src");
// 默认用一次性干净 profile：memo 流程不需要登录态（deepseek 游客首页即有可选文本），
// 且每次全新安装扩展 → 根除 unpacked 扩展 SW 脚本缓存陈旧问题
const USER_DATA_DIR = process.env.E2E_PROFILE_DIR || path.join(__dirname, ".memo-profile");
if (!process.env.E2E_PROFILE_DIR && fs.existsSync(USER_DATA_DIR)) {
  try { fs.rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch (_) {}
}
const ARTIFACTS = path.join(PROJECT_ROOT, ".arena", "artifacts", "memo-clip");
fs.mkdirSync(ARTIFACTS, { recursive: true });

const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
  channel: "chromium",
  headless: false,
  args: [
    `--disable-extensions-except=${EXT_PATH}`,
    `--load-extension=${EXT_PATH}`,
    "--no-first-run", "--no-default-browser-check",
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
  ],
  viewport: { width: 1280, height: 860 },
});

try {
  // 扩展 id：unpacked 扩展 id 由绝对路径哈希决定，本机固定；MV3 SW 事件驱动，
  //   空闲时不在 serviceWorkers() 列表里 — 不能依赖它发现 id，打开扩展页即可唤醒 SW
  let extId = process.env.ARENA_EXT_ID || "";
  {
    const [sw] = ctx.serviceWorkers();
    if (sw) extId = new URL(sw.url()).host;
  }
  if (!extId) extId = "ndiclbhabflkigblghlapmookalgglic";
  console.log(`[memo-e2e] ext=${extId}`);

  // v5.0.21 血泪护栏：unpacked 扩展浏览器重启后 manifest 重读但 SW 脚本可能是缓存的旧版
  //   （chrome MV3 已知行为）。探测 memoList 不认识 → chrome.runtime.reload() 强制重载扩展。
  {
    const probePage = await ctx.newPage();
    await probePage.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: "domcontentloaded" });
    const fresh = await probePage.evaluate(() => new Promise(res => {
      chrome.runtime.sendMessage({ type: "memoList" }, r => res(!!(r && r.ok)));
    }));
    if (!fresh) {
      console.log("[memo-e2e] SW 脚本陈旧（memoList 不认识）→ chrome.runtime.reload() 强刷");
      await probePage.evaluate(() => { try { chrome.runtime.reload(); } catch (_) {} }).catch(() => {});
      // 扩展重载期间 chrome-extension:// 页面短暂 ERR_BLOCKED_BY_CLIENT — 重试探测最长 ~24s
      let fresh2 = false;
      for (let i = 0; i < 8 && !fresh2; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const p2 = await ctx.newPage();
        try {
          await p2.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: "domcontentloaded", timeout: 8000 });
          fresh2 = await p2.evaluate(() => new Promise(res => {
            chrome.runtime.sendMessage({ type: "memoList" }, r => res(!!(r && r.ok)));
          }));
        } catch (_) { /* 还在重载，继续等 */ }
        await p2.close().catch(() => {});
      }
      assert.ok(fresh2, "扩展强刷后 SW 仍是旧脚本，请手动 chrome://extensions 重载后重跑");
      console.log("[memo-e2e] SW 已刷新 ✓");
    }
    await probePage.close().catch(() => {});
  }

  // 1) 打开 deepseek，等 content script 注入
  const page = await ctx.newPage();
  await page.goto("https://chat.deepseek.com/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);

  // 2) 选中页面上一段可见文本 → mouseup → 浮钮 → 点击
  const clip = await page.evaluate(() => new Promise((res) => {
    // 找一个有足够文本的可见元素（排除输入区）
    // 找一个可见、文本 ≥8 字（浮钮最小阈值）、不在输入区的元素，整体选中
    let node = null;
    for (const el of document.querySelectorAll("p, div, span, h1, h2, h3, li")) {
      const txt = (el.innerText || "").trim();
      if (txt.length < 8 || txt.length > 500) continue;
      if (el.closest("textarea, input, [contenteditable], [contenteditable='true']")) continue;
      if (el.querySelector("textarea, input, [contenteditable]")) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.top >= 0 && r.top < window.innerHeight) { node = el; break; }
    }
    if (!node) return res({ error: "页面没找到可选文本" });
    const range = document.createRange();
    range.selectNodeContents(node);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const selectedText = String(sel).trim();
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    setTimeout(() => {
      const btn = document.getElementById("arena-memo-clip-btn");
      if (!btn) return res({ error: "浮钮未出现", selectedText });
      btn.click();
      setTimeout(() => res({ ok: true, selectedText, btnText: btn.textContent }), 500);
    }, 150);
  }));
  console.log(`[memo-e2e] clip:`, JSON.stringify(clip).slice(0, 200));
  assert.ok(clip.ok, `站点划线收藏失败: ${clip.error || ""}`);
  assert.ok(clip.btnText.includes("已存入"), `浮钮应显示已存入，实际: ${clip.btnText}`);

  // 3) 打开 popup.html，验证 storage 落库 + 备忘录 Tab 渲染
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: "domcontentloaded" });
  await popup.waitForTimeout(1500);
  const memos = await popup.evaluate(() => new Promise(res => chrome.storage.local.get(["arenaMemos"], d => res(d.arenaMemos || []))));
  console.log(`[memo-e2e] storage memos: ${memos.length}`);
  assert.ok(memos.length >= 1, "storage 里应有 ≥1 条备忘录");
  const last = memos[memos.length - 1];
  assert.equal(last.source.type, "site");
  assert.equal(last.source.service, "deepseek");
  assert.ok(clip.selectedText.startsWith(last.text.slice(0, 10)), "落库文本应与选中文本一致");

  // 4) 切到备忘录 Tab → 截图留证 + 验证渲染
  await popup.click('.rp-tab[data-tab="memos"]');
  await popup.waitForTimeout(600);
  const itemCount = await popup.locator(".memo-item").count();
  assert.ok(itemCount >= 1, "备忘录 Tab 应渲染 ≥1 条");
  const shot = path.join(ARTIFACTS, `memo-tab-${Date.now()}.png`);
  await popup.screenshot({ path: shot });
  console.log(`[memo-e2e] 截图: ${shot}`);

  // 5) popup 主界面划线（气泡区有历史消息才可测；无历史则跳过该子项）
  const bubbleCount = await popup.locator(".msg.ai .msg-bubble").count();
  if (bubbleCount > 0) {
    const popupClip = await popup.evaluate(() => new Promise((res) => {
      const bubble = document.querySelector(".msg.ai .msg-bubble");
      const range = document.createRange();
      range.selectNodeContents(bubble);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      setTimeout(() => {
        const btn = document.querySelector(".memo-clip-btn");
        if (!btn) return res({ error: "popup 浮钮未出现" });
        btn.click();
        setTimeout(() => res({ ok: true }), 400);
      }, 120);
    }));
    console.log(`[memo-e2e] popup clip:`, JSON.stringify(popupClip));
  } else {
    console.log("[memo-e2e] popup 无历史气泡，跳过主界面划线子项（站点侧+Tab 渲染已验证）");
  }

  // 6) 清理测试数据
  await popup.evaluate(() => new Promise(res => chrome.runtime.sendMessage({ type: "memoClear" }, res)));
  console.log("[memo-e2e] ✅ 全部通过（测试数据已清理）");
} finally {
  await ctx.close();
}
