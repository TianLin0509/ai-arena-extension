import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const SRC = path.join(ROOT, "src");

const platforms = [
  "chatgpt",
  "claude",
  "gemini",
  "deepseek",
  "doubao",
  "qwen",
  "kimi",
  "yuanbao",
  "grok",
];

function scriptPath(platform) {
  return path.join(SRC, `content-${platform}.js`);
}

async function installHarness(page, platform) {
  await page.setContent(`
    <!doctype html>
    <html>
      <body>
        <main id="chat">
          <div class="arena-user">existing user message</div>
          <div class="arena-response">OLD_RESPONSE_SHOULD_NOT_BE_RETURNED</div>
          <div id="arena-input" contenteditable="true"></div>
          <button id="arena-send" aria-label="Send"><svg></svg></button>
        </main>
        <script>
          window.__arenaMessages = [];
          window.__arenaPlatform = ${JSON.stringify(platform)};
          window.hasUserMessageInDom = () => true;
          window.postProcessBlobUrls = async (text) => text;
          const selectors = {
            input: ["#arena-input"],
            response: [".arena-response"],
            sendButton: ["#arena-send"],
            streaming: []
          };
          const listeners = [];
          window.chrome = {
            runtime: {
              sendMessage(message, callback) {
                if (message && message.type === "getSelectors") {
                  if (callback) callback(selectors);
                  return Promise.resolve(selectors);
                }
                window.__arenaMessages.push(message);
                if (callback) callback({ ok: true });
                return Promise.resolve({ ok: true });
              },
              onMessage: {
                addListener(fn) { listeners.push(fn); }
              }
            }
          };
          window.__sendArenaMessage = (message) => new Promise((resolve) => {
            const listener = listeners[0];
            if (!listener) return resolve({ error: "no listener" });
            listener(message, null, resolve);
          });
          document.getElementById("arena-send").addEventListener("click", () => {
            document.getElementById("arena-input").innerHTML = "";
          });
        </script>
      </body>
    </html>
  `);
  await page.addScriptTag({ path: path.join(SRC, "content-shared.js") });
  await page.addScriptTag({ path: scriptPath(platform) });
}

async function runPlatform(page, platform, { spaRerender = false } = {}) {
  await installHarness(page, platform);
  const prompt = `hello from ${platform}`;
  const injected = await page.evaluate((text) => window.__sendArenaMessage({ action: "inject", text }), prompt);
  assert.equal(injected.site, platform);
  // v5.0.16: 收紧 — content script 实际只返回 sent / error 两种 status，
  //   旧断言放宽到不存在的 "inputted" 会掩盖意外值
  assert.equal(injected.status, "sent", `${platform} inject status should be "sent", got ${JSON.stringify(injected)}`);

  const inputText = await page.locator("#arena-input").innerText();
  assert.equal(inputText.trim(), "");

  if (spaRerender) {
    // v5.0.16 P0-1 回归：模拟站点 SPA 重渲染 — 发送时记住的旧响应节点被整体回收，
    //   cursor 锚点变 detached。修复前提取永远为空（45s 超时），修复后回退尾部候选。
    await page.evaluate(() => {
      document.querySelectorAll(".arena-response").forEach(el => el.remove());
    });
  }

  await page.evaluate((platformName) => {
    const el = document.createElement("div");
    el.className = "arena-response";
    el.textContent = `NEW_RESPONSE_FROM_${platformName}`;
    document.getElementById("chat").appendChild(el);
  }, platform);

  const read = await page.evaluate(() => window.__sendArenaMessage({ action: "readResponse" }));
  assert.equal(read.site, platform);
  assert.ok(read.text.includes(`NEW_RESPONSE_FROM_${platform}`), `${platform}${spaRerender ? " (SPA rerender)" : ""} should extract the new response, got: ${JSON.stringify(read)}`);
  if (!spaRerender) {
    assert.ok(!read.text.includes("OLD_RESPONSE_SHOULD_NOT_BE_RETURNED"), `${platform} should not extract the old response`);
  }

  // v5.0.20 PERF-1 回归：同文本省略协议
  // ① 全量响应必须带 textHash
  assert.ok(read.textHash, `${platform} readResponse should return textHash`);
  // ② 带相同 knownHash 再读 → sameText:true 且不回传 text
  const same = await page.evaluate((h) => window.__sendArenaMessage({ action: "readResponse", knownHash: h }), read.textHash);
  assert.equal(same.sameText, true, `${platform} should elide identical text, got: ${JSON.stringify(same)}`);
  assert.ok(!("text" in same), `${platform} sameText response should not carry text`);
  // ③ 文本追加后旧 knownHash 失效 → 回传新全文 + 新哈希
  await page.evaluate(() => {
    const el = document.querySelector(".arena-response:last-of-type");
    el.textContent += " APPENDED_TAIL";
  });
  const grown = await page.evaluate((h) => window.__sendArenaMessage({ action: "readResponse", knownHash: h }), read.textHash);
  assert.ok(grown.text && grown.text.includes("APPENDED_TAIL"), `${platform} grown text should be returned in full`);
  assert.ok(grown.textHash && grown.textHash !== read.textHash, `${platform} grown text should carry a new hash`);

  // v5.0.21 划线收藏回归：选中回答文本 → mouseup → 浮钮出现 → 点击 → memoAdd 消息发出
  const memoResult = await page.evaluate(() => new Promise((res) => {
    const el = document.querySelector(".arena-response:last-of-type");
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    setTimeout(() => {
      const btn = document.getElementById("arena-memo-clip-btn");
      if (!btn) return res({ noBtn: true });
      btn.click();
      setTimeout(() => {
        res({ msg: window.__arenaMessages.find(m => m && m.type === "memoAdd") || null, btnText: btn.textContent });
      }, 60);
    }, 80);
  }));
  assert.ok(!memoResult.noBtn, `${platform} memo clip button should appear on selection`);
  assert.ok(memoResult.msg, `${platform} clicking clip button should send memoAdd`);
  assert.ok(memoResult.msg.text.includes(`NEW_RESPONSE_FROM_${platform}`), `${platform} memoAdd should carry selected text`);
  assert.equal(memoResult.msg.source?.type, "site");
}

// v5.0.65 回归：inject 幂等去重 — background 超时重试(同 injectToken)不得二次注入
async function runDedupCase(page, platform) {
  await installHarness(page, platform);
  await page.evaluate(() => {
    window.__clickCount = 0;
    document.getElementById("arena-send").addEventListener("click", () => { window.__clickCount++; });
  });

  // ① 同 token 并发双发（模拟「超时→重试」）：只允许注入一次，后到者附着并标记 dedup
  const [r1, r2] = await page.evaluate((text) => Promise.all([
    window.__sendArenaMessage({ action: "inject", text, injectToken: "tok-retry-1" }),
    window.__sendArenaMessage({ action: "inject", text, injectToken: "tok-retry-1" }),
  ]), `dedup probe ${platform}`);
  assert.equal(r1.status, "sent", `${platform} dedup: first result should be sent, got ${JSON.stringify(r1)}`);
  assert.equal(r2.status, "sent", `${platform} dedup: second result should be sent, got ${JSON.stringify(r2)}`);
  assert.ok((r1.dedup === true) !== (r2.dedup === true), `${platform} dedup: exactly one result should carry dedup:true, got ${JSON.stringify([r1, r2])}`);
  const clicksAfterPair = await page.evaluate(() => window.__clickCount);
  assert.equal(clicksAfterPair, 1, `${platform} dedup: same-token pair must inject exactly once, clicked ${clicksAfterPair}`);

  // ② 新 token（用户手动重发）→ 正常再注入，不被过度去重
  const r3 = await page.evaluate((text) => window.__sendArenaMessage({ action: "inject", text, injectToken: "tok-manual-2" }), `second send ${platform}`);
  assert.equal(r3.status, "sent");
  assert.ok(!r3.dedup, `${platform} dedup: new token must not be deduped`);
  const clicksAfterNew = await page.evaluate(() => window.__clickCount);
  assert.equal(clicksAfterNew, 2, `${platform} dedup: new token should inject again, clicked ${clicksAfterNew}`);
}

const browser = await chromium.launch({ headless: true });
try {
  for (const platform of platforms) {
    for (const spaRerender of [false, true]) {
      const page = await browser.newPage();
      try {
        await runPlatform(page, platform, { spaRerender });
        console.log(`ok ${platform}: inject + readResponse${spaRerender ? " (SPA rerender)" : ""}`);
      } finally {
        await page.close();
      }
    }
    {
      const page = await browser.newPage();
      try {
        await runDedupCase(page, platform);
        console.log(`ok ${platform}: inject dedup (same-token attaches, new token resends)`);
      } finally {
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
}
