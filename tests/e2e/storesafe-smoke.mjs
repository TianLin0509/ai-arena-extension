// storesafe-smoke.mjs — v5.0.74 store-safe 构建产物真机冒烟
// 背景：store-safe 对 background 依赖的模块动了三处刀（bootstrap 移除/注入桩/远程热更新休眠），
//   任何 patch 失手都会断 SW importScripts 链 = 全功能瘫痪。本脚本加载 dist/store-safe
//   实体目录验证：SW 活着、SelectorsRemote 桩形态正确、popup 正常开、无致命 console 错误。
// 运行：node build.mjs store-safe && node tests/e2e/storesafe-smoke.mjs
import { chromium } from "playwright";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const EXT_PATH = path.join(PROJECT_ROOT, "dist", "store-safe");
if (!fs.existsSync(path.join(EXT_PATH, "manifest.json"))) {
  console.error("dist/store-safe 不存在 — 先跑 node build.mjs store-safe");
  process.exit(1);
}
const USER_DATA_DIR = path.join(os.tmpdir(), `arena-storesafe-smoke-${Date.now()}`);

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`✓ ${name}`); }
  else { failed++; console.log(`✗ ${name}${detail ? " → " + detail : ""}`); }
}

const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
  channel: "chromium", headless: false,
  args: [
    `--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`,
    "--no-first-run", "--no-default-browser-check",
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
  ],
});
try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15000 });
  check("SW 启动（importScripts 链完好）", !!sw);

  const probe = await sw.evaluate(() => ({
    hasRemote: typeof SelectorsRemote === "object",
    sources: SelectorsRemote?.SOURCES?.length,
    mergeOk: typeof SelectorsRemote?.mergeSelectors === "function"
      && Object.keys(SelectorsRemote.mergeSelectors({ x: { input: ["#a"] } }, null, "x")).length === 1,
    noBootstrapFn: (() => { try { return typeof injectBootstrapToTab === "function"; } catch (_) { return false; } })(),
  }));
  check("SelectorsRemote 桩存在", probe.hasRemote);
  check("远程源已休眠（SOURCES=[]，永不外呼）", probe.sources === 0, `len=${probe.sources}`);
  check("mergeSelectors 内置兜底可用", probe.mergeOk);

  const extId = sw.url().split("/")[2];
  const page = await context.newPage();
  const errors = [];
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`chrome-extension://${extId}/popup.html`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1800);
  check("popup 打开且双模式初始化", await page.evaluate(() =>
    document.body.classList.contains("simple-mode") && !!document.getElementById("ui-mode-seg")));
  check("成员面板渲染（9 家添加区）", await page.evaluate(() =>
    document.querySelectorAll("#rp-panel-members .rp-add-btn").length === 9));
  const fatal = errors.filter(e => /importScripts|is not defined|Cannot read/i.test(e));
  check("无致命 console 错误", fatal.length === 0, fatal.slice(0, 3).join(" | "));
} finally {
  await context.close();
  fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
}
console.log(`\nstoresafe-smoke: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
