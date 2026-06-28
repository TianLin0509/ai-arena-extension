// AI Arena 双构建脚本
// 用法: node build.mjs [github|store|all]
import { mkdir, cp, copyFile, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync, createWriteStream } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import archiver from "archiver";

// 排除规则：开发残留 + 运行时不需要的目录，避免商店审核质疑"未声明用途的文件"
const EXCLUDE_PATTERNS = [
  `${sep}_metadata`,           // Chrome 加载未打包扩展时自动生成
  `${sep}.DS_Store`,           // macOS 元数据
  `${sep}Thumbs.db`,           // Windows 缩略图缓存
  `${sep}.git`,                // 防误进
  `${sep}ppt-super${sep}tools`, // dev/e2e tooling; never needed at extension runtime
];

// 整段目录排除（只对 store 版生效，github 版保留便于开源贡献者跑测试）
const STORE_ONLY_EXCLUDE_DIRS = [
  `${sep}test${sep}`,          // 单元测试，运行时用不到
  `${sep}poc${sep}`,           // 早期 POC 代码，运行时不引用
];

// ppt-super 模板目录(assets/)下的构建/QA 产物：运行时只用 template.pptx/thumb.png/blank.png，
// 以下自检产物不被任何 js 引用，且体积大（reference-normalized.png 单个 ~1.8MB），
// 打进商店包会撑大体积并触发 CWS "未声明用途文件" 审核质疑 —— 两个版本都排除。
const ASSET_BUILD_ARTIFACTS = [
  "filled-check.pptx", "filled-demo.pptx", "filled-preview.png",
  "font-qa.json", "text-overflow-qa.json", "fixed-alignment-qa.json",
  "meta.json", "schema.json",
  "reference-measurement.json", "reference-normalized.png",
  "template-visual-qa.md", "template.md",
];

function makeFilter(extraDirs = []) {
  const all = [...EXCLUDE_PATTERNS, ...extraDirs];
  return (src) => {
    if (all.some(p => src.includes(p))) return false;
    if (extraDirs.some(d => src.endsWith(d.replace(/\\$|\/$/, '')))) return false;
    if (src.endsWith(".bak")) return false;                       // 备份文件
    if (src.includes(`${sep}assets${sep}`)) {                     // 仅限模板目录内
      if (src.includes(`${sep}protected-crops`)) return false;    // 保护区裁剪中间产物
      if (ASSET_BUILD_ARTIFACTS.some(n => src.endsWith(`${sep}${n}`))) return false;
    }
    return true;
  };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "src");
const DIST = resolve(__dirname, "dist");

async function readVersion() {
  const m = JSON.parse(await readFile(resolve(SRC, "manifest.json"), "utf8"));
  return m.version;
}

async function clean(dir) {
  if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
}

async function copySrc(target, { storeMode = false } = {}) {
  const filter = makeFilter(storeMode ? STORE_ONLY_EXCLUDE_DIRS : []);
  await cp(SRC, target, { recursive: true, filter });
}

async function patchStoreManifest(target) {
  const p = resolve(target, "manifest.json");
  const m = JSON.parse(await readFile(p, "utf8"));
  // v5.0.18: store 版同步剥离 debugger — CWS 最敏感权限（严格人工审核 + 用户侧常驻
  //   "正在调试此浏览器"黄条）。Tab 模式防节流由 bootstrap-main-world.js 的 visibility
  //   patch 覆盖，cdp-extractor 对 chrome.debugger 缺失有 no_api 优雅降级。
  m.permissions = m.permissions.filter(x => x !== "declarativeNetRequest" && x !== "debugger");
  delete m.declarative_net_request;
  await writeFile(p, JSON.stringify(m, null, 2) + "\n", "utf8");
  const dnr = resolve(target, "dnr-rules.json");
  if (existsSync(dnr)) await rm(dnr);
}

// store 版降级桩 — 替换 cdp-extractor.js，确保「零 chrome.debugger 引用」与「manifest 未声明
//   debugger 权限」严格一致。CWS 静态审核会因「代码调用未声明的 chrome.debugger API」判定为
//   规避敏感权限审查 → 商品打回/不可用。运行时行为与原版在 store(无 debugger)下完全等价：
//   attachAndWake 返回 no_api，Tab 模式防节流由 bootstrap-main-world.js 的 visibility patch 兜底。
const STORE_CDP_STUB = `// AI Arena — CDP 模块「商店版降级桩」(build.mjs 自动生成 · 勿手改 src)
// store 包不声明 debugger 权限 → 本桩确保零调试器 API 引用，与 manifest 严格一致。
// 运行时与原版在无 debugger 环境下等价：唤醒返回 no_api，Tab 防节流由 MAIN world visibility patch 兜底。
(function () {
  async function isTabInBackground(tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab.active) return true;
      const win = await chrome.windows.get(tab.windowId).catch(() => null);
      if (!win) return false;
      return !win.focused;
    } catch (_) { return false; }
  }
  async function attachAndWake() {
    return { ok: false, error: "CDP wake unavailable in store build", code: "no_api" };
  }
  async function detach() {}
  async function detachAll() {}
  function isAttached() { return false; }
  function getStats() { return { attachedCount: 0, tabs: [] }; }
  self.CDPExtractor = { isTabInBackground, attachAndWake, detach, detachAll, isAttached, getStats };
})();
`;

async function patchStoreCdpExtractor(target) {
  // 1) cdp-extractor.js → 零调试器 API 引用的降级桩（消除真实 API 调用）
  await writeFile(resolve(target, "cdp-extractor.js"), STORE_CDP_STUB, "utf8");
  // 2) 其余文件仅在注释里提及该 API → 一并去字面，store 包做到绝对零引用，避免 CWS 字符串层面误判
  for (const f of ["background.js", "chat-bus.js"]) {
    const p = resolve(target, f);
    if (!existsSync(p)) continue;
    const s = await readFile(p, "utf8");
    await writeFile(p, s.split("chrome.debugger").join("chrome 调试器 API"), "utf8");
  }
  console.log("[store] 调试器 API 引用已全部清除 (cdp-extractor 降级桩 + 注释去字面)");
}

function zipDir(srcDir, zipPath) {
  return new Promise((ok, fail) => {
    const out = createWriteStream(zipPath);
    const ar = archiver("zip", { zlib: { level: 9 } });
    out.on("close", ok);
    ar.on("error", fail);
    ar.pipe(out);
    ar.directory(srcDir, false);
    ar.finalize();
  });
}

async function buildGithub(version) {
  const target = resolve(DIST, "github");
  console.log(`[github] building to ${target}`);
  await clean(target);
  await copySrc(target, { storeMode: false });
  const zipPath = resolve(DIST, `ai-arena-github-v${version}.zip`);
  await zipDir(target, zipPath);
  console.log(`[github] zip: ${zipPath}`);
  return zipPath;
}

async function syncDocsRelease(version, sourceZipPath) {
  const releaseDir = resolve(__dirname, "docs", "v5.0-beta", "release");
  await mkdir(releaseDir, { recursive: true });
  const docsZipPath = resolve(releaseDir, `ai-arena-extension-v${version}.zip`);
  await copyFile(sourceZipPath, docsZipPath);
  console.log(`[docs] release zip: ${docsZipPath}`);
}

async function buildStore(version) {
  const target = resolve(DIST, "store");
  console.log(`[store] building to ${target}`);
  await clean(target);
  await copySrc(target, { storeMode: true });
  await patchStoreManifest(target);
  await patchStoreCdpExtractor(target);
  const zipPath = resolve(DIST, `ai-arena-store-v${version}.zip`);
  await zipDir(target, zipPath);
  console.log(`[store] zip: ${zipPath}`);
}

const [, , target = "all"] = process.argv;
const version = await readVersion();
console.log(`AI Arena build — version ${version}`);

if (target === "github") {
  const githubZip = await buildGithub(version);
  await syncDocsRelease(version, githubZip);
}
else if (target === "store") await buildStore(version);
else if (target === "all") {
  const githubZip = await buildGithub(version);
  await syncDocsRelease(version, githubZip);
  await buildStore(version);
}
else { console.error(`未知 target: ${target}`); process.exit(1); }

console.log("done.");
