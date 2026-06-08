import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(__dirname, "..", "popup-mini-mode.js"), "utf8");

function makeElement(id) {
  return {
    id,
    classList: {
      add() {},
      remove() {},
    },
    textContent: "",
    title: "",
    parentNode: null,
    _listeners: {},
    addEventListener(type, fn) { this._listeners[type] = fn; },
    click() { this._listeners.click?.(); },
  };
}

function makeHarness(sendResponse = { ok: true }) {
  const miniBtn = makeElement("btn-mini-mode");
  const compactBtn = makeElement("btn-compact-mode");
  const taskWrap = makeElement("task-picker-wrap");
  const inputBar = {
    insertBefore(node) { node.parentNode = inputBar; },
  };
  taskWrap.parentNode = inputBar;

  const attrs = new Map();
  let sent = null;
  const storage = new Map([["popupMode", "full"]]);

  const chrome = {
    windows: {
      getCurrent: async () => ({ id: 123 }),
    },
    storage: {
      local: {
        get: async (keys) => Object.fromEntries(keys.map(k => [k, storage.get(k)])),
        set: async (obj) => { for (const [k, v] of Object.entries(obj)) storage.set(k, v); },
      },
    },
    runtime: {
      lastError: null,
      sendMessage(msg, cb) {
        sent = msg;
        queueMicrotask(() => cb(sendResponse));
      },
    },
  };

  const document = {
    readyState: "complete",
    body: {
      setAttribute(k, v) { attrs.set(k, v); },
      getAttribute(k) { return attrs.get(k); },
    },
    getElementById(id) {
      if (id === "btn-mini-mode") return miniBtn;
      if (id === "btn-compact-mode") return compactBtn;
      return null;
    },
    querySelector(sel) {
      if (sel === ".task-picker-wrap") return taskWrap;
      if (sel === ".chat-actions") return inputBar;
      return null;
    },
    addEventListener() {},
  };

  const context = {
    chrome,
    document,
    console,
    queueMicrotask,
  };
  vm.runInNewContext(code, context, { filename: "popup-mini-mode.js" });
  return { miniBtn, attrs, storage, getSent: () => sent };
}

test("mini mode toggle sends current popup windowId", async () => {
  const h = makeHarness();
  await Promise.resolve();
  h.miniBtn.click();
  await new Promise(r => setTimeout(r, 0));
  const sent = h.getSent();
  assert.equal(sent.type, "miniModeToggle");
  assert.equal(sent.mode, "mini");
  assert.equal(sent.windowId, 123);
  assert.equal(h.attrs.get("data-mode"), "mini");
});

test("mini mode toggle rolls back DOM mode when resize fails", async () => {
  const h = makeHarness({ ok: false, error: "popup not open" });
  await Promise.resolve();
  h.miniBtn.click();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(h.attrs.get("data-mode"), "full");
  assert.equal(h.storage.get("popupMode"), "full");
});
