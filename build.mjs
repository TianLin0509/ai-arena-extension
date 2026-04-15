// AI Arena 双构建脚本
// 用法: node build.mjs [github|store|all]
import { mkdir, cp, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync, createWriteStream } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import archiver from "archiver";

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

async function copySrc(target) {
  await cp(SRC, target, { recursive: true });
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
  await copySrc(target);
  const zipPath = resolve(DIST, `ai-arena-github-v${version}.zip`);
  await zipDir(target, zipPath);
  console.log(`[github] zip: ${zipPath}`);
}

async function buildStore(version) {
  const target = resolve(DIST, "store");
  console.log(`[store] building to ${target}`);
  await clean(target);
  await copySrc(target);
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
