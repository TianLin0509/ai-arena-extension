import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const SRC = path.join(ROOT, "src");

async function setupPage(page, { initialMode = "tiled", focusResponse = { ok: true } } = {}) {
  const warnings = [];
  page.on("console", msg => {
    if (msg.type() === "warning") warnings.push(msg.text());
  });
  await page.setContent(`
    <!doctype html>
    <html>
      <body>
        <div id="hdr-mode-toggle">
          <button class="hdr-mode-btn" data-mode="tab">Tab</button>
          <button class="hdr-mode-btn" data-mode="tiled">并列</button>
        </div>
        <button id="btn-focus-ai-tabs" hidden>唤起 AI</button>
        <div id="chat-messages"></div>
        <script>
          window.__messages = [];
          window.__storage = { windowMode: ${JSON.stringify(initialMode)} };
          window.__focusResponse = ${JSON.stringify(focusResponse)};
          window.chrome = {
            storage: {
              local: {
                get(keys, cb) {
                  const out = {};
                  for (const k of keys) if (k in window.__storage) out[k] = window.__storage[k];
                  cb(out);
                },
                set(obj, cb) { Object.assign(window.__storage, obj); if (cb) cb(); }
              },
              onChanged: { addListener() {} }
            },
            runtime: {
              sendMessage(msg, cb) {
                window.__messages.push(msg);
                const resp = msg.type === "focusAllAiTabs" ? window.__focusResponse : { ok: true };
                if (msg.type === "setWindowMode") window.__storage.windowMode = msg.mode;
                if (cb) cb(resp);
                return Promise.resolve(resp);
              }
            }
          };
        </script>
      </body>
    </html>
  `);
  await page.addScriptTag({ path: path.join(SRC, "popup-window-mode.js") });
  await page.waitForFunction(() => !!window.ChatWindowMode);
  return warnings;
}

const browser = await chromium.launch({ headless: true });
try {
  {
    const page = await browser.newPage();
    const warnings = await setupPage(page, { initialMode: "tiled" });
    await page.evaluate(() => document.getElementById("btn-focus-ai-tabs").click());
    await page.waitForTimeout(60);
    const focusCalls = await page.evaluate(() => window.__messages.filter(m => m.type === "focusAllAiTabs").length);
    assert.equal(focusCalls, 0, "tiled mode focus click should not send focusAllAiTabs");
    assert.deepEqual(warnings, [], "tiled mode focus click should not warn");
    await page.close();
  }

  {
    const page = await browser.newPage();
    const warnings = await setupPage(page, {
      initialMode: "tab",
      focusResponse: { ok: false, error: "仅 Tab 模式可用" },
    });
    await page.click("#btn-focus-ai-tabs", { force: true });
    await page.waitForTimeout(60);
    const state = await page.evaluate(() => ({
      mode: window.ChatWindowMode.current,
      hidden: document.getElementById("btn-focus-ai-tabs").hidden,
      focusCalls: window.__messages.filter(m => m.type === "focusAllAiTabs").length,
    }));
    assert.equal(state.focusCalls, 1, "tab mode should still send focusAllAiTabs");
    assert.equal(state.mode, "tiled", "known backend mode mismatch should sync popup mode to tiled");
    assert.equal(state.hidden, true, "focus button should be hidden after backend reports non-tab mode");
    assert.deepEqual(warnings, [], "known non-tab response should not warn");
    await page.close();
  }

  console.log("ok popup window mode: non-tab focus guard suppresses expected warning");
} finally {
  await browser.close();
}
