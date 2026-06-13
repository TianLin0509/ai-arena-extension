// tests/e2e/restore-frag-real.mjs — v5.0.35 历史恢复 DocumentFragment 批量化
// 验证 restoreLog 改 DocumentFragment 后逻辑等价：发消息产生历史 → 重开 popup → 历史正确恢复、无报错。
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const EXT_PATH = path.join(PROJECT_ROOT, "src");
const USER_DATA_DIR = process.env.E2E_PROFILE_DIR || path.join(__dirname, ".restore-profile");
if (!process.env.E2E_PROFILE_DIR && fs.existsSync(USER_DATA_DIR)) {
  try { fs.rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch (_) {}
}

const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
  channel: "chromium", headless: false,
  args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`,
    "--no-first-run", "--no-default-browser-check", "--disable-features=DisableLoadExtensionCommandLineSwitch"],
  viewport: { width: 1380, height: 900 },
});
function log(s) { console.log(`[restore] ${s}`); }

try {
  let extId = ""; { const [sw] = ctx.serviceWorkers(); if (sw) extId = new URL(sw.url()).host; }
  if (!extId) extId = "ndiclbhabflkigblghlapmookalgglic";
  const POPUP = `chrome-extension://${extId}/popup.html`;
  let popup = await ctx.newPage();
  await popup.goto(POPUP, { waitUntil: "domcontentloaded" });
  await popup.waitForTimeout(900);
  for (const p of ctx.pages()) { if (p.url().includes("welcome.html")) await p.close().catch(() => {}); }

  // 加 deepseek + 发两条消息，产生聊天历史
  await popup.evaluate(() => new Promise(res => chrome.runtime.sendMessage({ type: "addParticipant", service: "deepseek" }, () => res())));
  await popup.waitForTimeout(3500);
  for (const q of ["历史恢复测试问题一", "历史恢复测试问题二"]) {
    await popup.evaluate((t) => {
      const i = document.getElementById("chat-input");
      i.focus(); i.textContent = t;
      i.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }, q);
    await popup.keyboard.press("Control+Enter");   // 真实发送路径：本地 appendUserMessage + broadcast + log
    await popup.waitForTimeout(2800);
  }
  const beforeUser = await popup.locator(".msg.me").count();
  assert.ok(beforeUser >= 2, `发送后应有 ≥2 条用户气泡，实际 ${beforeUser}`);
  log(`发送后 user 气泡 ${beforeUser} 条`);

  // 关 popup 重开 → 触发 chatRestoreLog → restoreLog（DocumentFragment 路径）
  const errors = [];
  await popup.close();
  popup = await ctx.newPage();
  popup.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  popup.on("pageerror", e => errors.push(String(e)));
  await popup.goto(POPUP, { waitUntil: "domcontentloaded" });
  await popup.waitForTimeout(1500);

  // ① 历史正确恢复（user 气泡数 ≥ 之前）
  const afterUser = await popup.locator(".msg.me").count();
  assert.ok(afterUser >= beforeUser, `恢复后用户气泡应 ≥${beforeUser}，实际 ${afterUser}`);
  log(`① 历史恢复 ✓ 用户气泡 ${afterUser} 条`);

  // ② 恢复的气泡含原文本（顺序/内容正确）
  const txt = await popup.locator(".msg.me").last().innerText();
  assert.ok(/历史恢复测试问题/.test(txt), `恢复气泡应含原问题文本: ${txt.slice(0, 40)}`);
  log("② 气泡文本正确 ✓");

  // ③ restore 过程无 JS 报错
  const realErrors = errors.filter(e => !/ERR_BLOCKED_BY_CLIENT|favicon|net::/.test(e));
  assert.equal(realErrors.length, 0, `restore 不应有 JS 报错: ${realErrors.join(" | ")}`);
  log("③ restore 无报错 ✓");

  console.log("[restore] ✅ 历史恢复 DocumentFragment 验证通过（逻辑等价）");
} finally {
  await ctx.close();
}
