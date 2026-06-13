// tests/e2e/view-prompt-real.mjs — v5.0.30 查看本轮发出的 Prompt
// 气泡操作栏最左加「📄 查看 Prompt」按钮 → 弹窗显示本轮发给该 AI 的 prompt 全文 + 复制。
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const EXT_PATH = path.join(PROJECT_ROOT, "src");
const USER_DATA_DIR = process.env.E2E_PROFILE_DIR || path.join(__dirname, ".viewprompt-profile");
if (!process.env.E2E_PROFILE_DIR && fs.existsSync(USER_DATA_DIR)) {
  try { fs.rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch (_) {}
}
const ARTIFACTS = path.join(PROJECT_ROOT, ".arena", "artifacts", "onboarding");
fs.mkdirSync(ARTIFACTS, { recursive: true });

const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
  channel: "chromium", headless: false,
  args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`,
    "--no-first-run", "--no-default-browser-check", "--disable-features=DisableLoadExtensionCommandLineSwitch"],
  viewport: { width: 1380, height: 900 },
});
function log(s) { console.log(`[vprompt] ${s}`); }

try {
  let extId = ""; { const [sw] = ctx.serviceWorkers(); if (sw) extId = new URL(sw.url()).host; }
  if (!extId) extId = "ndiclbhabflkigblghlapmookalgglic";
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: "domcontentloaded" });
  await popup.waitForTimeout(1000);
  for (const p of ctx.pages()) { if (p.url().includes("welcome.html")) await p.close().catch(() => {}); }
  // 授予剪贴板权限（复制全文用）
  try { await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: `chrome-extension://${extId}` }); } catch (_) {}

  // 加 deepseek + 广播一条问题（ChatBus.broadcast 会 setLastSent 记录 prompt）
  await popup.evaluate(() => new Promise(res => chrome.runtime.sendMessage({ type: "addParticipant", service: "deepseek" }, r => res(r))));
  await popup.waitForTimeout(4000);
  const QUESTION = "测试问题ABC123：请简述张量的概念";
  await popup.evaluate((q) => new Promise(res => chrome.runtime.sendMessage({ type: "chatBroadcast", text: q, targets: ["deepseek"] }, r => res(r))), QUESTION);
  await popup.waitForTimeout(3000);

  // ① background getSentPrompt 返回本轮 prompt
  const got = await popup.evaluate(() => new Promise(res => chrome.runtime.sendMessage({ type: "getSentPrompt", participantId: "deepseek" }, r => res(r))));
  assert.ok(got?.ok, `getSentPrompt 应成功: ${JSON.stringify(got)}`);
  assert.ok(got.prompt.includes("测试问题ABC123"), `应返回本轮 prompt，实际: ${got.prompt.slice(0, 60)}`);
  log(`① getSentPrompt ✓ (${got.prompt.length} 字)`);

  // ② 气泡操作栏有 view-prompt 按钮（最左）
  await popup.waitForSelector('.msg.ai .acts button[data-act="view-prompt"]', { timeout: 8000 });
  const isFirst = await popup.evaluate(() => {
    const acts = document.querySelector(".msg.ai .acts");
    return acts && acts.firstElementChild?.dataset?.act === "view-prompt";
  });
  assert.ok(isFirst, "view-prompt 按钮应在操作栏最左");
  log("② 气泡操作栏最左有查看 Prompt 按钮 ✓");

  // ③ 点击 → 弹窗显示 prompt 全文
  await popup.click('.msg.ai .acts button[data-act="view-prompt"]');
  await popup.waitForSelector(".prompt-viewer-modal.show", { timeout: 5000 });
  const body = await popup.locator(".prompt-viewer-modal .pv-body").innerText();
  assert.ok(body.includes("测试问题ABC123"), `弹窗应显示 prompt 全文: ${body.slice(0, 60)}`);
  await popup.screenshot({ path: path.join(ARTIFACTS, "view-prompt-modal.png") });
  log("③ 弹窗显示 Prompt 全文 ✓");

  // ④ 复制全文按钮 → 反馈
  await popup.click('.prompt-viewer-modal [data-role="copy"]');
  await popup.waitForFunction(() => {
    const b = document.querySelector('.prompt-viewer-modal [data-role="copy"]');
    return b && b.textContent.includes("已复制");
  }, { timeout: 4000 });
  log("④ 复制全文 ✓");

  await popup.click('.prompt-viewer-modal [data-role="cancel"]');
  console.log("[vprompt] ✅ 查看 Prompt 功能验证通过");
} finally {
  await ctx.close();
}
