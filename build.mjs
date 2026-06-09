// AI Arena 双构建脚本
// 用法: node build.mjs [github|store|all]
import { mkdir, cp, readFile, writeFile, rm } from "node:fs/promises";
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
];

// 整段目录排除（只对 store 版生效，github 版保留便于开源贡献者跑测试）
const STORE_ONLY_EXCLUDE_DIRS = [
  `${sep}test${sep}`,          // 单元测试，运行时用不到
  `${sep}poc${sep}`,           // 早期 POC 代码，运行时不引用
];

function makeFilter(extraDirs = []) {
  const all = [...EXCLUDE_PATTERNS, ...extraDirs];
  return (src) => !all.some(p => src.includes(p))
              && !extraDirs.some(d => src.endsWith(d.replace(/\\$|\/$/, '')));
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
  m.permissions = m.permissions.filter(x => x !== "declarativeNetRequest");
  delete m.declarative_net_request;
  await writeFile(p, JSON.stringify(m, null, 2) + "\n", "utf8");
  const dnr = resolve(target, "dnr-rules.json");
  if (existsSync(dnr)) await rm(dnr);
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
}

async function buildStore(version) {
  const target = resolve(DIST, "store");
  console.log(`[store] building to ${target}`);
  await clean(target);
  await copySrc(target, { storeMode: true });
  await patchStoreManifest(target);
  const zipPath = resolve(DIST, `ai-arena-store-v${version}.zip`);
  await zipDir(target, zipPath);
  console.log(`[store] zip: ${zipPath}`);
}

const [, , target = "all"] = process.argv;
const version = await readVersion();
console.log(`AI Arena build — version ${version}`);

if (target === "github") await buildGithub(version);
else if (target === "store") await buildStore(version);
else if (target === "all") { await buildGithub(version); await buildStore(version); }
else { console.error(`未知 target: ${target}`); process.exit(1); }

console.log("done.");
