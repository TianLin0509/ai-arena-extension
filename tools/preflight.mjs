// tools/preflight.mjs — 发布前一键防线
//
// 背景（两次血泪）：
//   - 2026-07 CWS 退审：store 包残留 chrome.debugger 引用 →「未声明权限」商品不可用
//   - 版本号分散 5 处（manifest×2 / popup.html / sidepanel.html×2），人工 bump 漏改过
// 本脚本把这两类事故 + 测试回归收敛为一条命令，全绿才允许打包发版。
//
// 用法:
//   node tools/preflight.mjs              # 全量：版本一致性 + 单测 + content harness + 构建扫描
//   node tools/preflight.mjs --skip-e2e   # 跳过 content harness（无浏览器环境）
//   node tools/preflight.mjs --skip-build # 跳过构建与违禁 token 扫描（纯代码改动快检）
//
// 退出码: 0 = 全绿; 1 = 任一检查失败（明细见输出）

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const failures = [];

function pass(name, detail = "") {
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, detail) {
  failures.push({ name, detail });
  console.log(`  ✗ ${name} — ${detail}`);
}
function section(title) {
  console.log(`\n[preflight] ${title}`);
}

// ── ① 版本号一致性（5 处） ────────────────────────────────────────────────
async function checkVersionConsistency() {
  section("版本号一致性");
  const manifest = JSON.parse(await readFile(resolve(ROOT, "src/manifest.json"), "utf8"));
  const v = manifest.version;
  if (!/^\d+\.\d+\.\d+$/.test(v)) {
    fail("manifest.version 格式", `"${v}" 不是纯数字三段式`);
    return v;
  }
  pass("manifest.version", v);

  if (manifest.version_name === v) pass("manifest.version_name 一致");
  else fail("manifest.version_name", `"${manifest.version_name}" ≠ version "${v}"`);

  const popup = await readFile(resolve(ROOT, "src/popup.html"), "utf8");
  if (popup.includes(`AI圆桌派-${v}`)) pass("popup.html chat-name 一致");
  else fail("popup.html chat-name", `未找到 "AI圆桌派-${v}"（漏 bump？）`);

  const sidepanel = await readFile(resolve(ROOT, "src/sidepanel.html"), "utf8");
  const hits = sidepanel.split(`v${v}`).length - 1;
  if (hits >= 2) pass("sidepanel.html 徽章+footer 一致", `${hits} 处`);
  else fail("sidepanel.html", `"v${v}" 只出现 ${hits} 处（应 ≥2：顶部徽章 + 底部 footer）`);

  return v;
}

// ── ② / ③ 测试 ───────────────────────────────────────────────────────────
function runStep(name, cmd, cmdArgs) {
  section(name);
  // shell:true 下传单串命令（args 数组只拼接不转义，触发 DEP0190；这里命令全为内部常量无注入面）
  const r = spawnSync([cmd, ...cmdArgs].join(" "), { cwd: ROOT, shell: true, encoding: "utf8" });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  if (r.status === 0) {
    const summary = out.split("\n").filter(l => /pass|fail|ok |✓|✗/.test(l)).slice(-3).join(" | ");
    pass(name, summary.slice(0, 160));
  } else {
    fail(name, `exit ${r.status}，末尾输出：\n${out.split("\n").slice(-15).join("\n")}`);
  }
}

// ── ④ 构建 + 违禁 token 扫描 ─────────────────────────────────────────────
// 违禁矩阵（CWS 静态审核按字面扫，注释残留同样触发退审）：
//   store      : chrome.debugger / declarativeNetRequest / dnr-rules（保留 MAIN world）
//   store-safe : 上述全部 + bootstrap-main-world / downloads.open / "world": "MAIN"
const FORBIDDEN = {
  store: ["chrome.debugger", "declarativeNetRequest", "dnr-rules"],
  "store-safe": [
    "chrome.debugger", "declarativeNetRequest", "dnr-rules",
    "bootstrap-main-world", "downloads.open", '"world": "MAIN"',
  ],
};
const SCAN_EXT = new Set([".js", ".json", ".html", ".css"]);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

async function scanPackage(variant) {
  const dir = resolve(ROOT, "dist", variant);
  if (!existsSync(dir)) {
    fail(`${variant} 包扫描`, `${dir} 不存在（构建失败？）`);
    return;
  }
  const tokens = FORBIDDEN[variant];
  const hits = [];
  for await (const file of walk(dir)) {
    if (!SCAN_EXT.has(extname(file))) continue;
    const text = await readFile(file, "utf8");
    for (const t of tokens) {
      if (text.includes(t)) hits.push(`${file.slice(dir.length + 1)} ← "${t}"`);
    }
  }
  if (hits.length === 0) pass(`${variant} 包违禁 token 扫描`, `${tokens.length} 项全干净`);
  else fail(`${variant} 包违禁 token 扫描`, `\n    ${hits.join("\n    ")}`);

  // manifest 权限白名单双保险（字面扫描之外按解析结构再核一遍）
  const m = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  const perms = m.permissions || [];
  const banned = ["debugger", "declarativeNetRequest"].filter(p => perms.includes(p));
  if (variant === "store-safe" && perms.includes("downloads.open")) banned.push("downloads.open");
  if (banned.length === 0) pass(`${variant} manifest 权限干净`);
  else fail(`${variant} manifest 权限`, `残留 ${banned.join(", ")}`);
  if (variant === "store-safe") {
    const mainWorld = (m.content_scripts || []).filter(cs => cs.world === "MAIN");
    if (mainWorld.length === 0) pass("store-safe 无 MAIN world content_scripts");
    else fail("store-safe MAIN world", `残留 ${mainWorld.length} 条声明`);
  }
}

// ── 主流程 ───────────────────────────────────────────────────────────────
console.log("AI圆桌派 preflight — 发布前防线");
const version = await checkVersionConsistency();

runStep("单元测试 (npm test)", "npm", ["test"]);

if (args.has("--skip-e2e")) section("content harness — 跳过 (--skip-e2e)");
else runStep("content harness (9 平台 send/extract)", "npm", ["run", "test:e2e:content"]);

if (args.has("--skip-build")) section("构建与违禁扫描 — 跳过 (--skip-build)");
else {
  runStep("构建 store 包", "node", ["build.mjs", "store"]);
  runStep("构建 store-safe 包", "node", ["build.mjs", "store-safe"]);
  section("违禁 token 扫描");
  await scanPackage("store");
  await scanPackage("store-safe");
}

console.log("\n────────────────────────────────────────");
if (failures.length === 0) {
  console.log(`preflight 全绿 ✓  version ${version} 可以打包发版`);
  process.exit(0);
} else {
  console.log(`preflight 失败 ✗  ${failures.length} 项未过：`);
  for (const f of failures) console.log(`  - ${f.name}`);
  process.exit(1);
}
