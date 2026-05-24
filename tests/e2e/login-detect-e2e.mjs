// F22 登录态检测真实 E2E
// 用 clean profile 启 chromium → 调 addParticipant 真的打开 AI 网站
// → 等 6 秒看 checkLoginStatus 是否正确推未登录警告

import { chromium } from "playwright";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const EXT_PATH = path.join(PROJECT_ROOT, "src");
const USER_DATA_DIR = path.join(os.tmpdir(), `arena-login-detect-${Date.now()}`);

const SERVICES_TO_TEST = ["kimi", "chatgpt", "deepseek"];  // 各家未登录页面差异大，挑三个代表

console.log("═".repeat(70));
console.log("F22 登录态检测 真实 E2E");
console.log("═".repeat(70));
console.log(`ext=${EXT_PATH}`);
console.log(`data=${USER_DATA_DIR}（全新 profile，所有 AI 都未登录）\n`);

const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
  channel: "chromium",
  headless: false,
  args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`, "--no-first-run", "--no-default-browser-check"],
});

const results = [];
try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
  console.log("[E2E] sw ready\n");

  // 全部 3 个一起跑
  for (const service of SERVICES_TO_TEST) {
    console.log(`\n=== 诊断 ${service} 未登录态 ===`);
    const r = await sw.evaluate(async (svc) => {
      return new Promise(async (resolve) => {
        StateMachine.hardReset();
        ChatBus.clearAllPollers?.();

        // 捕获 loginWarning 标记的 chatStreamUpdate
        let loginWarnings = [];
        let allChatStreams = 0;
        const origRuntime = chrome.runtime.sendMessage;
        chrome.runtime.sendMessage = (m) => {
          if (m?.type === "chatStreamUpdate") {
            allChatStreams++;
            if (m?.loginWarning) {
              loginWarnings.push({ text: m.text, participantId: m.participantId });
            }
          }
          return Promise.resolve();
        };

        // 触发真实 addParticipant — 会打开真 AI 网站
        const addResult = await addParticipant(svc).catch(e => ({ ok: false, error: e.message }));

        // 等 6 秒让 checkLoginStatus（3.5s 内部延迟 + 检测执行）跑完
        setTimeout(() => {
          chrome.runtime.sendMessage = origRuntime;
          resolve({
            svc,
            addOk: addResult?.ok,
            participantCount: StateMachine.participants.length,
            allChatStreams,
            loginWarningCount: loginWarnings.length,
            firstWarningText: loginWarnings[0]?.text || null,
          });
        }, 6500);
      });
    }, service);

    const detected = r.loginWarningCount > 0;
    console.log(`   addOk: ${r.addOk}`);
    console.log(`   warning: ${detected ? "✅ 检测到" : "❌ 未检测"} (count=${r.loginWarningCount})`);
    if (r.firstWarningText) console.log(`   text: ${r.firstWarningText.slice(0, 80)}...`);

    results.push({ service, detected, ...r });
  }

} catch (e) {
  console.error("[E2E] fatal:", e);
} finally {
  await ctx.close();
}

console.log("\n" + "═".repeat(70));
console.log("总结");
console.log("═".repeat(70));
const detectedCount = results.filter(r => r.detected).length;
results.forEach(r => {
  const icon = r.detected ? "✅" : "🔴";
  console.log(`${icon} ${r.service.padEnd(10)} — ${r.detected ? "正确报未登录" : "漏报（应报但没报）"}`);
});
console.log(`\n总: ${detectedCount}/${SERVICES_TO_TEST.length} 正确检测`);
if (detectedCount < SERVICES_TO_TEST.length) {
  console.log("⚠ 有漏报场景，需调整 checkLoginStatus 的启发式判定");
}
process.exit(0);
