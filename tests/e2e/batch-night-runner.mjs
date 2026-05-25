// tests/e2e/batch-night-runner.mjs
// 后台无人值守：循环跑 night-runner N 轮，每轮间隔 20 min
// 用法：node tests/e2e/batch-night-runner.mjs [num-rounds=12] [interval-min=20]

import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const ARTIFACTS = path.join(PROJECT_ROOT, ".arena", "artifacts", "real-debate", "night");
fs.mkdirSync(ARTIFACTS, { recursive: true });

const NUM_ROUNDS = parseInt(process.argv[2] || "12", 10);
const INTERVAL_MIN = parseInt(process.argv[3] || "20", 10);
const INTERVAL_MS = INTERVAL_MIN * 60 * 1000;
const ROUND_TIMEOUT_MS = 70 * 60 * 1000; // 70 min/round 上限

// 起始 round 号（从已有报告里推断 + 1）
const existingRounds = fs.readdirSync(ARTIFACTS)
  .filter(n => /^round-\d+/.test(n))
  .map(n => parseInt(n.match(/round-(\d+)/)[1], 10));
const START_ROUND = (existingRounds.length ? Math.max(...existingRounds) : 0) + 1;

const batchLog = path.join(ARTIFACTS, `batch-runner-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.log`);
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(batchLog, line + "\n");
}

log(`batch-runner start: ${NUM_ROUNDS} 轮 × ${INTERVAL_MIN} min 间隔，从 round ${START_ROUND} 开始`);
log(`报告目录: ${ARTIFACTS}`);

function runRound(roundNum) {
  return new Promise(resolve => {
    log(`================ ROUND ${roundNum} START ================`);
    const t0 = Date.now();
    const proc = spawn("node", ["tests/e2e/night-runner.mjs", String(roundNum)], {
      cwd: PROJECT_ROOT, stdio: "inherit", shell: false,
    });
    const timer = setTimeout(() => {
      log(`ROUND ${roundNum} TIMEOUT (>${ROUND_TIMEOUT_MS / 60000} min), kill`);
      try { proc.kill("SIGTERM"); } catch {}
      setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, 5000);
    }, ROUND_TIMEOUT_MS);
    proc.on("exit", code => {
      clearTimeout(timer);
      const elapsed = Date.now() - t0;
      log(`ROUND ${roundNum} END exit=${code} elapsed=${Math.round(elapsed/1000)}s`);
      resolve({ roundNum, code, elapsed });
    });
    proc.on("error", e => {
      clearTimeout(timer);
      log(`ROUND ${roundNum} ERROR ${e.message}`);
      resolve({ roundNum, code: -1, elapsed: Date.now() - t0, err: e.message });
    });
  });
}

const results = [];
for (let i = 0; i < NUM_ROUNDS; i++) {
  const roundNum = START_ROUND + i;
  const r = await runRound(roundNum);
  results.push(r);

  if (i < NUM_ROUNDS - 1) {
    log(`sleep ${INTERVAL_MIN} min...`);
    await new Promise(rr => setTimeout(rr, INTERVAL_MS));
  }
}

// 总结
log(`\n================ ALL ROUNDS DONE ================`);
log(`pass: ${results.filter(r => r.code === 0).length}/${results.length}`);
log(`fail: ${results.filter(r => r.code !== 0).length}`);
results.forEach(r => log(`  round ${r.roundNum} exit=${r.code} elapsed=${Math.round(r.elapsed/1000)}s`));
log(`batch log: ${batchLog}`);
process.exit(0);
