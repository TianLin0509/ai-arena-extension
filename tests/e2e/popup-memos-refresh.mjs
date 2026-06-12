import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const SRC = path.join(ROOT, "src");

async function waitFor(fn, timeoutMs = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise(r => setTimeout(r, 25));
  }
  assert.fail("waitFor timeout");
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(`
    <!doctype html>
    <html>
      <body>
        <div id="rp-panel-memos" data-rp-panel="memos"></div>
        <div id="chat-messages"></div>
        <div id="chat-input" contenteditable="true"></div>
        <script>
          window.__tab = "members";
          window.__memoItems = [
            { id: "m1", text: "第一条备忘", source: { type: "popup", service: "deepseek" }, ts: 1710000000000 }
          ];
          window.__memoListCalls = 0;
          const listeners = [];
          window.ChatRightPanel = { get current() { return window.__tab; } };
          window.chrome = {
            runtime: {
              onMessage: { addListener(fn) { listeners.push(fn); } },
              sendMessage(message, callback) {
                if (message && message.type === "memoList") {
                  window.__memoListCalls += 1;
                  const resp = { ok: true, items: window.__memoItems };
                  if (callback) callback(resp);
                  return Promise.resolve(resp);
                }
                if (callback) callback({ ok: true });
                return Promise.resolve({ ok: true });
              }
            }
          };
          window.__emitRuntime = (message) => listeners.forEach(fn => fn(message));
          window.__activateMemoTab = () => {
            window.__tab = "memos";
            document.dispatchEvent(new CustomEvent("rp:activated", { detail: { tab: "memos" } }));
          };
        </script>
      </body>
    </html>
  `);
  await page.addScriptTag({ path: path.join(SRC, "popup-memos.js") });

  await page.waitForTimeout(140);
  assert.equal(await page.evaluate(() => window.__memoListCalls), 0, "inactive memos tab should not refresh on startup");

  await page.evaluate(() => {
    window.__emitRuntime({ type: "memoUpdated" });
    window.__emitRuntime({ type: "memoUpdated" });
  });
  await page.waitForTimeout(140);
  assert.equal(await page.evaluate(() => window.__memoListCalls), 0, "inactive memos tab should only mark dirty");

  await page.evaluate(() => window.__activateMemoTab());
  await waitFor(() => page.evaluate(() => window.__memoListCalls === 1));
  assert.match(await page.locator("#rp-panel-memos").innerText(), /第一条备忘/);

  await page.evaluate(() => {
    window.__memoListCalls = 0;
    window.__memoItems = [
      { id: "m1", text: "第一条备忘", source: { type: "popup", service: "deepseek" }, ts: 1710000000000 },
      { id: "m2", text: "第二条备忘", source: { type: "site", service: "kimi" }, ts: 1710000100000 },
    ];
    window.__emitRuntime({ type: "memoUpdated" });
    window.__emitRuntime({ type: "memoUpdated" });
    window.__emitRuntime({ type: "memoUpdated" });
  });
  await waitFor(() => page.evaluate(() => window.__memoListCalls === 1));
  await page.waitForTimeout(140);
  assert.equal(await page.evaluate(() => window.__memoListCalls), 1, "visible rapid memo updates should be coalesced");
  assert.match(await page.locator("#rp-panel-memos").innerText(), /第二条备忘/);

  console.log("ok popup memos refresh: lazy hidden tab + coalesced visible updates");
  await page.close();
} finally {
  await browser.close();
}
