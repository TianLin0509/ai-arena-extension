# AI Arena 公开发布实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 AI Arena Chrome 扩展改造为可公开分发版本，通过 GitHub 开源 + Chrome Web Store 双渠道发布，移除所有个人身份信息。

**Architecture:** 单仓库双构建——`src/` 为唯一源，`build.mjs` 产出 `dist/github/`（完整版含 CSP 剥离）和 `dist/store/`（上架版移除 `declarativeNetRequest` 和 `system.display`）。隐私政策通过 GitHub Pages 托管。

**Tech Stack:** Chrome MV3 Extension、原生 JS、Node.js（构建脚本）、`archiver`（zip 打包）、GitHub Pages、MIT LICENSE。

**Spec:** `docs/superpowers/specs/2026-04-16-ai-arena-publish-design.md`

**Repo root:** `C:\Users\lintian\AI_debate\ai-arena-extension`

---

## Task 1: 搬运运行时文件进 `src/` 并新建 `.gitignore` / `package.json`

**Files:**
- Create directory: `src/`
- Move: `manifest.json`, `background.js`, `sidepanel.html`, `sidepanel.css`, `sidepanel.js`, `content-*.js` (×6), `inject-images.js`, `debate-engine.js`, `state-machine.js`, `selectors-config.js`, `dnr-rules.json`, `icons/` → 全部移入 `src/`
- Create: `.gitignore`
- Create: `package.json`
- Keep at root: `docs/`, `_metadata/`

- [ ] **Step 1: 搬运文件**

用 git mv 保留历史：
```bash
cd C:/Users/lintian/AI_debate/ai-arena-extension
mkdir src
git mv manifest.json background.js sidepanel.html sidepanel.css sidepanel.js inject-images.js debate-engine.js state-machine.js selectors-config.js dnr-rules.json src/
git mv content-chatgpt.js content-claude.js content-deepseek.js content-doubao.js content-gemini.js content-qwen.js src/
git mv icons src/
```

- [ ] **Step 2: 创建 `.gitignore`**

内容：
```
node_modules/
dist/
*.zip
.DS_Store
Thumbs.db
```

- [ ] **Step 3: 创建 `package.json`**

内容：
```json
{
  "name": "ai-arena-extension",
  "version": "1.0.0",
  "private": true,
  "description": "Claude × Gemini × ChatGPT — 多 AI 辩论协作 Chrome 扩展",
  "scripts": {
    "build:github": "node build.mjs github",
    "build:store": "node build.mjs store",
    "build": "node build.mjs all"
  },
  "devDependencies": {
    "archiver": "^7.0.1"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 4: 验证 Chrome 可以加载 `src/` 目录**

打开 Chrome → `chrome://extensions` → 开启开发者模式 → "加载已解压的扩展程序" → 选择 `src/` 目录。
Expected: 扩展出现，图标显示，打开 sidePanel 正常（此时还是旧 UI，含署名）。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: move runtime files into src/ and add build scaffolding"
```

---

## Task 2: 移除 `src/sidepanel.html` 和 `src/sidepanel.css` 中的署名

**Files:**
- Modify: `src/sidepanel.html` — 删除第 17-21 行的 `.author-badge-fixed` div；修改第 123 行 footer
- Modify: `src/sidepanel.css` — 删除 `.author-badge-fixed` 相关规则（第 14-48 行，含注释）

- [ ] **Step 1: 删除 HTML 中的悬浮署名 div**

`src/sidepanel.html` 第 17-21 行原文：
```html
  <!-- 右下角悬浮署名 -->
  <div class="author-badge-fixed" title="出品：解决方案 · 林田l00807938">
    <span class="author-dept">解决方案出品</span>
    <span class="author-name">林田l00807938</span>
  </div>
```
**操作：** 整块 5 行连同注释一并删除。

- [ ] **Step 2: 修改 HTML footer 文案**

`src/sidepanel.html` 第 121-124 行原文：
```html
  <div class="footer">
    <div class="shortcuts-hint">快捷键: Ctrl+Enter 发送 | Ctrl+Shift+D 辩论</div>
    解决方案出品 · 林田l00807938 | AI Arena v6.0
  </div>
```
**改为：**
```html
  <div class="footer">
    <div class="shortcuts-hint">快捷键: Ctrl+Enter 发送 | Ctrl+Shift+D 辩论</div>
    AI Arena v1.0.0
  </div>
```

- [ ] **Step 3: 删除 CSS 中 `.author-badge-fixed` 相关规则**

`src/sidepanel.css` 第 14-48 行原文（从注释到最后一条子选择器规则）：
```css
/* 右下角悬浮署名 */
.author-badge-fixed {
  position: fixed;
  right: 10px; bottom: 10px;
  z-index: 1000;
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 10px; line-height: 1;
  padding: 4px 9px;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(238,242,255,0.95), rgba(253,242,248,0.95));
  border: 1px solid #e0e7ff;
  box-shadow: 0 2px 8px rgba(99,102,241,0.12);
  backdrop-filter: blur(4px);
  cursor: default;
  white-space: nowrap;
  opacity: 0.85;
  transition: opacity 0.2s;
}
.author-badge-fixed:hover { opacity: 1; }
.author-badge-fixed .author-dept {
  color: #6366f1;
  font-weight: 700;
  letter-spacing: 0.3px;
}
.author-badge-fixed .author-dept::after {
  content: "·";
  margin: 0 2px;
  color: #c7d2fe;
  font-weight: 400;
}
.author-badge-fixed .author-name {
  color: #ec4899;
  font-weight: 600;
  font-family: "SF Mono", Consolas, "Microsoft YaHei", monospace;
}
```
**操作：** 整块 35 行连同注释删除，留空行给下一条 `.mode-opt` 规则。

- [ ] **Step 4: 验证 grep 无命中**

```bash
cd C:/Users/lintian/AI_debate/ai-arena-extension
grep -rn "author-badge\|author-dept\|author-name\|林田\|l00807938\|解决方案" src/
```
Expected: 0 匹配。

- [ ] **Step 5: 加载扩展目视验证**

Chrome → `chrome://extensions` → 点 AI Arena 的"重新加载" → 打开 sidePanel。
Expected: 右下角无粉色 badge，footer 只剩"AI Arena v1.0.0"。

- [ ] **Step 6: Commit**

```bash
git add src/sidepanel.html src/sidepanel.css
git commit -m "chore: remove author badge and personal info from UI"
```

---

## Task 3: 统一版本号字符串 `v6.0` → `v1.0.0`

**Files:**
- Modify: `src/sidepanel.html:10`（顶部 header 版本标签）
- Modify: `src/sidepanel.js:1`（文件头注释）
- Modify: `src/background.js:1`（文件头注释）

注：`src/sidepanel.html:123` footer 已在 Task 2 中处理。

- [ ] **Step 1: 改 HTML header 版本号**

`src/sidepanel.html` 第 10 行原文：
```html
    <span class="version">v6.0</span>
```
**改为：**
```html
    <span class="version">v1.0.0</span>
```

- [ ] **Step 2: 改 sidepanel.js 文件头**

`src/sidepanel.js` 第 1 行原文：
```javascript
// AI Arena — Side Panel v6.0 (状态机驱动)
```
**改为：**
```javascript
// AI Arena — Side Panel v1.0.0
```

- [ ] **Step 3: 改 background.js 文件头**

`src/background.js` 第 1 行原文：
```javascript
// AI Arena — Background Service Worker v6.0 (状态机驱动)
```
**改为：**
```javascript
// AI Arena — Background Service Worker v1.0.0
```

- [ ] **Step 4: 验证 grep 无 `v6.0` 命中**

```bash
grep -rn "v6\.0" src/
```
Expected: 0 匹配。

- [ ] **Step 5: 加载扩展验证 header 显示 v1.0.0**

Chrome 重新加载扩展 → 打开 sidePanel → header 右边版本标签显示 "v1.0.0"。

- [ ] **Step 6: Commit**

```bash
git add src/sidepanel.html src/sidepanel.js src/background.js
git commit -m "chore: unify version string to v1.0.0"
```

---

## Task 4: 重构 `arrangeWindows` 移除 `system.display` 权限

**Files:**
- Modify: `src/background.js:423-463`（`arrangeWindows` 函数）
- Modify: `src/background.js:87`（消息路由传 screen 参数）
- Modify: `src/background.js:147`（内部调用用缓存）
- Modify: `src/background.js` 顶部附近（新增模块级缓存变量）
- Modify: `src/sidepanel.js:396`（发消息时带 screen payload）
- Modify: `src/manifest.json`（从 permissions 删除 `"system.display"`）

**设计要点：**
- sidepanel 发送 `arrangeWindows` 消息时附带 `window.screen.availWidth/Height/Left/Top`
- background 模块级变量 `lastKnownScreen` 缓存该值
- 内部调用（`:147` 新建参与者后自动排列）用缓存；若缓存为空用默认 1920×1080

- [ ] **Step 1: 修改 sidepanel.js 发消息处**

`src/sidepanel.js:395-398` 原文：
```javascript
    if (mode === "tiled" && participants.length > 0) {
      const r = await chrome.runtime.sendMessage({ type: "arrangeWindows" });
      if (r?.ok) addLog("窗口已排列", "success");
    }
```
**改为：**
```javascript
    if (mode === "tiled" && participants.length > 0) {
      const screen = {
        width: window.screen.availWidth,
        height: window.screen.availHeight,
        left: window.screen.availLeft,
        top: window.screen.availTop,
      };
      const r = await chrome.runtime.sendMessage({ type: "arrangeWindows", screen });
      if (r?.ok) addLog("窗口已排列", "success");
    }
```

- [ ] **Step 2: 同步更新 sidepanel.js 中 setWindowMode 之前的时机**

搜索 `src/sidepanel.js` 中其他可能发 `arrangeWindows` 的位置：
```bash
grep -n "arrangeWindows" src/sidepanel.js
```
Expected: 只上面一处。如有其他处，同样改造加 screen payload。

- [ ] **Step 3: 在 background.js 顶部增加模块级缓存**

在 `src/background.js` 第 2-5 行区域（顶部注释后、已有变量声明前）加：
```javascript
// 从 sidepanel 缓存的屏幕尺寸（用于并列模式，替代 chrome.system.display）
let lastKnownScreen = { width: 1920, height: 1080, left: 0, top: 0 };
```

- [ ] **Step 4: 修改 arrangeWindows 消息路由**

`src/background.js:87` 原文：
```javascript
        case "arrangeWindows":    sendResponse(await arrangeWindows()); break;
```
**改为：**
```javascript
        case "arrangeWindows":
          if (msg.screen) lastKnownScreen = msg.screen;
          sendResponse(await arrangeWindows(msg.screen || lastKnownScreen));
          break;
```

- [ ] **Step 5: 修改 arrangeWindows 函数签名和实现**

`src/background.js:423-432` 原文：
```javascript
async function arrangeWindows() {
  if (windowMode !== "tiled") return { ok: false, error: "非并列模式" };
  const parts = StateMachine.participants.filter(p => p.tabId);
  if (parts.length === 0) return { ok: false, error: "无参与者" };

  // 获取屏幕尺寸
  const displays = await chrome.system.display.getInfo();
  const primary = displays[0];
  const { width: screenW, height: screenH } = primary.workArea;
```
**改为：**
```javascript
async function arrangeWindows(screen = lastKnownScreen) {
  if (windowMode !== "tiled") return { ok: false, error: "非并列模式" };
  const parts = StateMachine.participants.filter(p => p.tabId);
  if (parts.length === 0) return { ok: false, error: "无参与者" };

  // 使用传入或缓存的屏幕尺寸（替代 chrome.system.display）
  const screenW = screen.width;
  const screenH = screen.height;
  const screenLeft = screen.left || 0;
  const screenTop = screen.top || 0;
```

- [ ] **Step 6: 修改 arrangeWindows 内部使用 workArea 的位置**

`src/background.js:446-449` 原文：
```javascript
    await chrome.windows.update(winId, {
      left: primary.workArea.left + i * perW,
      top: primary.workArea.top,
      width: isLast ? perW + sidePanelWidth : perW,
      height: screenH,
```
**改为：**
```javascript
    await chrome.windows.update(winId, {
      left: screenLeft + i * perW,
      top: screenTop,
      width: isLast ? perW + sidePanelWidth : perW,
      height: screenH,
```

- [ ] **Step 7: 验证内部调用（`:147`）无需修改**

`src/background.js:147` 原文：
```javascript
    setTimeout(() => arrangeWindows().catch(() => {}), 500);
```
此处调用不传参，`arrangeWindows` 默认使用 `lastKnownScreen`，正确。**不改。**

- [ ] **Step 8: 从 manifest.json 删除 system.display 权限**

`src/manifest.json` 第 6-16 行原 permissions 数组包含 `"system.display"`（第 10 行）。
**操作：** 删除 `"system.display",` 这一行。删除后数组应为：
```json
  "permissions": [
    "sidePanel",
    "tabs",
    "activeTab",
    "storage",
    "windows",
    "contextMenus",
    "scripting",
    "declarativeNetRequest"
  ],
```

- [ ] **Step 9: 验证 grep 无 system.display 残留**

```bash
grep -rn "system\.display\|system_display" src/
```
Expected: 0 匹配。

- [ ] **Step 10: 加载扩展进行并列模式手动测试**

Chrome `chrome://extensions` → 重新加载 AI Arena → 打开 sidePanel:
1. 添加 Claude、Gemini、ChatGPT 三个参与者（会开 3 个标签页）
2. 点击顶部 "并列" 模式
3. Expected: 3 个窗口横向并排铺满屏幕，最右窗口带 sidePanel
4. 再添加一个参与者（本步骤跳过，因上限 3）— 改为移除一个再添加回来
5. Expected: `:147` 的自动 arrangeWindows 使用缓存的 screen 成功排列

- [ ] **Step 11: Commit**

```bash
git add src/background.js src/sidepanel.js src/manifest.json
git commit -m "refactor: drop system.display permission, pass screen info from sidepanel"
```

---

## Task 5: 实现 `build.mjs` 双构建脚本

**Files:**
- Create: `build.mjs`（仓库根目录）

- [ ] **Step 1: 安装 archiver 依赖**

```bash
cd C:/Users/lintian/AI_debate/ai-arena-extension
npm install
```
Expected: 生成 `node_modules/` 和 `package-lock.json`，安装 archiver。

- [ ] **Step 2: 将 package-lock.json 加入 git**

```bash
git add package-lock.json
```
(`node_modules/` 由 `.gitignore` 排除。)

- [ ] **Step 3: 创建 `build.mjs`**

```javascript
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
```

- [ ] **Step 4: 运行 `npm run build` 测试**

```bash
npm run build
```
Expected 输出包含：
```
AI Arena build — version 1.0.0
[github] building to .../dist/github
[github] zip: .../dist/ai-arena-github-v1.0.0.zip
[store] building to .../dist/store
[store] zip: .../dist/ai-arena-store-v1.0.0.zip
done.
```

- [ ] **Step 5: 验证 dist/store 无 DNR 相关文件**

```bash
ls dist/store/
grep -l "declarativeNetRequest\|declarative_net_request" dist/store/manifest.json
```
Expected: `dist/store/` 中无 `dnr-rules.json`；grep 无匹配。

- [ ] **Step 6: 验证 dist/github 完整**

```bash
ls dist/github/
grep -l "declarativeNetRequest" dist/github/manifest.json
```
Expected: `dist/github/` 中有 `dnr-rules.json`；grep 命中 1 处。

- [ ] **Step 7: 分别加载两版到 Chrome 验证**

`chrome://extensions`：
1. 先卸载之前加载的 `src/` 版本
2. 加载 `dist/github/` → 加 3 个 AI 参与者 → 发问 → 成功
3. 卸载 github 版
4. 加载 `dist/store/` → 同样流程 → 成功（某些站点 CSP 严格时可能注入偶尔失败，能走 execCommand 兜底即为合格）

- [ ] **Step 8: Commit**

```bash
git add build.mjs package.json package-lock.json
git commit -m "feat: add dual-target build script (github + store)"
```

---

## Task 6: 写 README.md

**Files:**
- Create: `README.md`（仓库根目录）

- [ ] **Step 1: 创建 README.md**

```markdown
# AI Arena

> 多 AI 协作辩论 Chrome 扩展 — 一次提问，三家 AI 同时回答，并支持多轮辩论 / 群策群力。

支持 Claude / Gemini / ChatGPT / DeepSeek / 豆包 / 通义千问，通过侧边栏统一调度。

## 主要特性

- **一键广播提问**：选中的 AI 同时收到相同 prompt
- **两种协作模式**：
  - ⚔️ **自由辩论** — 各 AI 相互质询、反驳
  - 🤝 **群策群力** — 各 AI 基于彼此答案迭代深化
- **辩论轮次感知 prompt**：每轮自动调整提问策略
- **简洁模式**：限制 AI 输出字数
- **上下文提炼**：AI 对话摘要一键复制到新窗口
- **辩论总结**：最后由裁判综合各方观点
- **文件上传**：图片走注入，文本文件拼入 prompt
- **预设**：三巨头（Claude + Gemini + GPT）/ 中外对决（Claude + DeepSeek + 千问）/ 深度对抗（Claude×2 + GPT）

## 安装方式

### 方式 1：Chrome Web Store（推荐）

> 审核中，通过后补链接。

### 方式 2：手动加载（开发者模式）

1. 下载最新 Release 的 `ai-arena-github-vX.Y.Z.zip`
2. 解压到任意目录
3. 打开 Chrome → `chrome://extensions`
4. 右上角开启"开发者模式"
5. 点击"加载已解压的扩展程序"，选择解压后的目录
6. 扩展图标出现在工具栏，点击即打开侧边栏

## 使用说明

1. 先分别登录 Claude / Gemini / ChatGPT 等要使用的 AI 官网（扩展不替你登录）
2. 点击扩展图标，侧边栏打开
3. 添加参与者（最多 3 个）或使用顶部预设
4. 输入框输入问题，Ctrl+Enter 发送
5. 辩论模式下用 Ctrl+Shift+D 触发多轮

## 兼容性与限制

- 需要各 AI 官网已登录
- 站点 DOM 频繁变化，选择器偶尔会失效，issue 区反馈即可
- 完整版（GitHub Release）通过 `declarativeNetRequest` 剥离响应头 CSP 以提高注入稳定性；商店版不带此能力，极少数站点首次注入可能需要重试

## 隐私声明

本扩展不收集、不上传任何用户数据。详见 [隐私政策](https://lintian0509.github.io/ai-arena-extension/privacy.html)。

## 从源码构建

```bash
npm install
npm run build         # 同时产出 github 和 store 两版 zip
npm run build:github  # 仅 github 版
npm run build:store   # 仅 store 版
```
产物在 `dist/` 目录。

## 许可证

[MIT](./LICENSE)
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README"
```

---

## Task 7: 写 LICENSE

**Files:**
- Create: `LICENSE`

- [ ] **Step 1: 创建 LICENSE（MIT）**

```
MIT License

Copyright (c) 2026 lintian0509

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Commit**

```bash
git add LICENSE
git commit -m "docs: add MIT license"
```

---

## Task 8: 写 PRIVACY.md 和 privacy.html

**Files:**
- Create: `PRIVACY.md`
- Create: `privacy.html`（GitHub Pages 入口）

- [ ] **Step 1: 创建 PRIVACY.md**

```markdown
# AI Arena 隐私政策

最后更新：2026-04-16

## 概述

AI Arena 是一个 Chrome 浏览器扩展，用于让用户同时向多个主流 AI 对话平台（Claude、Gemini、ChatGPT、DeepSeek、豆包、通义千问）发送问题并汇总回答。

**本扩展不会收集、存储或上传任何用户数据到扩展开发者或任何第三方服务器。**

## 数据处理说明

扩展运行期间会处理以下数据，且**全部仅在用户本地浏览器内流动**：

1. **用户输入的 prompt 和上传的文件**：由扩展直接注入到用户已登录的 AI 官网页面，等同于用户自己在对应网站输入框粘贴发送。
2. **AI 返回的回答内容**：扩展从各 AI 官网页面读取后显示在侧边栏，同时可选择性地复制或导出为文本。
3. **扩展配置和历史会话**：存储在 `chrome.storage.local`，仅当前浏览器可访问，不上传云端。

用户的账号、密码、Cookie 等凭证完全由各 AI 官网管理，扩展无法访问也不尝试访问。

## 各 AI 平台的数据处理

用户在 Claude、Gemini、ChatGPT 等官网与扩展交互时，数据的后续处理由**各平台自身的隐私政策**决定，与本扩展无关。

## 权限用途说明

| 权限 | 用途 |
|---|---|
| `sidePanel` | 显示主界面侧边栏 |
| `tabs` / `windows` | 管理和切换各 AI 平台的标签页和窗口 |
| `activeTab` | 获取当前活动标签页信息 |
| `storage` | 本地保存扩展配置和会话历史 |
| `scripting` | 向各 AI 平台注入提问和读取回答 |
| `contextMenus` | 右键菜单快捷操作 |
| `declarativeNetRequest`（仅 GitHub 版） | 剥离目标站点响应头 CSP，提高内容注入稳定性 |
| `host_permissions` | 限定仅访问列出的 AI 官网域名 |

## 联系方式

如有隐私相关疑问，请在 GitHub 仓库提交 Issue：
https://github.com/lintian0509/ai-arena-extension/issues
```

- [ ] **Step 2: 创建 privacy.html（GitHub Pages 入口）**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Arena 隐私政策</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; max-width: 760px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; line-height: 1.75; }
  h1 { border-bottom: 2px solid #6366f1; padding-bottom: 8px; }
  h2 { margin-top: 32px; color: #4338ca; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; }
  th, td { border: 1px solid #e5e7eb; padding: 8px 12px; text-align: left; font-size: 14px; }
  th { background: #f5f3ff; }
  code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 90%; }
  a { color: #6366f1; }
</style>
</head>
<body>
<h1>AI Arena 隐私政策</h1>
<p><strong>最后更新：</strong>2026-04-16</p>

<h2>概述</h2>
<p>AI Arena 是一个 Chrome 浏览器扩展，用于让用户同时向多个主流 AI 对话平台（Claude、Gemini、ChatGPT、DeepSeek、豆包、通义千问）发送问题并汇总回答。</p>
<p><strong>本扩展不会收集、存储或上传任何用户数据到扩展开发者或任何第三方服务器。</strong></p>

<h2>数据处理说明</h2>
<p>扩展运行期间会处理以下数据，且<strong>全部仅在用户本地浏览器内流动</strong>：</p>
<ol>
  <li><strong>用户输入的 prompt 和上传的文件</strong>：由扩展直接注入到用户已登录的 AI 官网页面，等同于用户自己在对应网站输入框粘贴发送。</li>
  <li><strong>AI 返回的回答内容</strong>：扩展从各 AI 官网页面读取后显示在侧边栏，同时可选择性地复制或导出为文本。</li>
  <li><strong>扩展配置和历史会话</strong>：存储在 <code>chrome.storage.local</code>，仅当前浏览器可访问，不上传云端。</li>
</ol>
<p>用户的账号、密码、Cookie 等凭证完全由各 AI 官网管理，扩展无法访问也不尝试访问。</p>

<h2>各 AI 平台的数据处理</h2>
<p>用户在 Claude、Gemini、ChatGPT 等官网与扩展交互时，数据的后续处理由<strong>各平台自身的隐私政策</strong>决定，与本扩展无关。</p>

<h2>权限用途说明</h2>
<table>
  <thead><tr><th>权限</th><th>用途</th></tr></thead>
  <tbody>
    <tr><td><code>sidePanel</code></td><td>显示主界面侧边栏</td></tr>
    <tr><td><code>tabs</code> / <code>windows</code></td><td>管理和切换各 AI 平台的标签页和窗口</td></tr>
    <tr><td><code>activeTab</code></td><td>获取当前活动标签页信息</td></tr>
    <tr><td><code>storage</code></td><td>本地保存扩展配置和会话历史</td></tr>
    <tr><td><code>scripting</code></td><td>向各 AI 平台注入提问和读取回答</td></tr>
    <tr><td><code>contextMenus</code></td><td>右键菜单快捷操作</td></tr>
    <tr><td><code>declarativeNetRequest</code>（仅 GitHub 版）</td><td>剥离目标站点响应头 CSP，提高内容注入稳定性</td></tr>
    <tr><td><code>host_permissions</code></td><td>限定仅访问列出的 AI 官网域名</td></tr>
  </tbody>
</table>

<h2>联系方式</h2>
<p>如有隐私相关疑问，请在 GitHub 仓库提交 Issue：<br>
<a href="https://github.com/lintian0509/ai-arena-extension/issues">https://github.com/lintian0509/ai-arena-extension/issues</a></p>
</body>
</html>
```

- [ ] **Step 3: Commit**

```bash
git add PRIVACY.md privacy.html
git commit -m "docs: add privacy policy (Markdown + GitHub Pages HTML)"
```

---

## Task 9: 写 `docs/store-listing.md`（商店后台填表文案）

**Files:**
- Create: `docs/store-listing.md`

- [ ] **Step 1: 创建 docs/store-listing.md**

```markdown
# Chrome Web Store 上架文案（复制到开发者后台）

## 扩展名
AI Arena

## 简短说明（Summary，最多 132 字）
让 Claude、Gemini、ChatGPT 等主流 AI 同时回答同一个问题，并支持多轮辩论和总结，一个侧边栏统一调度。

## 分类
Productivity

## 语言
Simplified Chinese（可选补充 English）

---

## 详细描述（Description）

AI Arena 是一个让你同时与多个主流 AI 对话的 Chrome 扩展。

### 能做什么
- 一键把同一个问题发给 Claude、Gemini、ChatGPT、DeepSeek、豆包、通义千问中任意 3 个
- 让不同 AI 相互辩论、或围绕同一个问题群策群力
- 自动汇总对比各方回答
- 支持图片和文本文件上传
- 辩论轮次感知提示，自动引导每轮深化
- 一键复制对话摘要到新窗口继续追问

### 适合谁
- 需要多模型交叉验证答案的用户
- 做 AI 横向对比测评
- 希望让不同模型互相补充知识盲区的研究者和学习者

### 使用前提
使用本扩展前，请先在浏览器中分别登录你要使用的 AI 官网（Claude、Gemini、ChatGPT 等）。扩展本身不提供账号，也不代替你登录。

### 隐私承诺
本扩展不收集、不上传任何用户数据。所有对话内容仅在你的浏览器和你已登录的各 AI 官网之间流动。
完整政策：https://lintian0509.github.io/ai-arena-extension/privacy.html

### 开源
源码公开在 GitHub：https://github.com/lintian0509/ai-arena-extension

---

## 单一用途声明（Single Purpose）

本扩展的唯一用途是：让用户在一个侧边栏界面中同时与多个 AI 对话平台交互并对比回答。

---

## 权限说明（Permission Justification）

按商店后台要求逐条填写：

| 权限 | 填写的 Justification |
|---|---|
| `sidePanel` | The extension's main UI is rendered as a side panel for persistent access across tabs. |
| `tabs` | To detect whether the user already has each AI platform open, and to route prompts to the correct tab. |
| `activeTab` | To read selected text and forward it as a prompt when the user triggers the extension on the active page. |
| `storage` | To save user preferences (selected participants, debate mode, presets) and conversation history locally. |
| `windows` | To arrange participant windows side by side when the user chooses "tiled" window mode. |
| `contextMenus` | To offer right-click shortcuts for sending selected page text to the extension. |
| `scripting` | To inject prompts into and read responses from each AI platform's chat interface, strictly on the user-triggered action. |
| `host_permissions` (6 domains) | Limited to the exact domains of the supported AI platforms the user explicitly chooses to broadcast to. |

---

## 截图（Screenshots）

尺寸要求 1280×800 或 640×400，至少 1 张，建议 3-5 张。

建议拍摄：
1. 侧边栏首屏（空状态 + 预设按钮）
2. 三个 AI 参与者添加后、并列模式下的窗口布局
3. 发送一个问题后三家 AI 同时回答的瞬间
4. 辩论模式进行中
5. 裁判总结界面

---

## 宣传图（可选）

Small promo tile: 440×280
Marquee promo tile: 1400×560

暂不提交，必要时后补。
```

- [ ] **Step 2: Commit**

```bash
git add docs/store-listing.md
git commit -m "docs: add Chrome Web Store listing copy"
```

---

## Task 10: 最终完整构建 + 全面个人信息清扫 + 端到端手动验证

**Files:** 无代码变更，仅验证和生成最终产物。

- [ ] **Step 1: 重新执行完整构建**

```bash
cd C:/Users/lintian/AI_debate/ai-arena-extension
rm -rf dist
npm run build
```
Expected: `dist/github/`、`dist/store/`、`dist/ai-arena-github-v1.0.0.zip`、`dist/ai-arena-store-v1.0.0.zip` 全部生成成功。

- [ ] **Step 2: 对两份构建输出做个人信息终检**

```bash
grep -ri "林田\|l00807938\|解决方案\|author-badge\|author-dept\|author-name" dist/
```
Expected: 0 匹配（此命令范围覆盖两份 dist）。

- [ ] **Step 3: 对 store 版做合规项终检**

```bash
grep -l "declarativeNetRequest\|declarative_net_request\|system\.display" dist/store/
ls dist/store/dnr-rules.json 2>&1
```
Expected:
- 第一条 grep 无匹配
- 第二条 `ls` 报 "No such file or directory"

- [ ] **Step 4: 对 github 版做完整性终检**

```bash
grep -l "declarativeNetRequest" dist/github/manifest.json
ls dist/github/dnr-rules.json
```
Expected:
- manifest.json 命中 1 处
- dnr-rules.json 存在

- [ ] **Step 5: 端到端手动测试 — GitHub 版**

Chrome `chrome://extensions`：
1. 卸载任何已加载的 AI Arena
2. "加载已解压的扩展程序" → 选 `dist/github/`
3. 侧边栏打开，header 显示 "AI Arena v1.0.0"，右下角无 badge，footer 只有 "AI Arena v1.0.0"
4. 点"三巨头"预设 → 自动打开 3 个标签页（Claude + Gemini + ChatGPT）
5. 输入 "用一句话介绍你自己" → Ctrl+Enter
6. 三家都能收到问题并返回回答
7. 切换"并列"模式 → 三窗口并排 + 侧边栏贴最右 → **此步验证 system.display 重构不回归**
8. 新添加一个参与者（先移除一个再加回来）→ 自动并列排列（**此步验证 :147 内部调用用缓存正常**）

- [ ] **Step 6: 端到端手动测试 — Store 版**

1. 卸载 github 版
2. 加载 `dist/store/`
3. 扩展页面检查权限清单：**无** `declarativeNetRequest`、**无** `system.display`
4. 重复 Step 5 的 4-7 流程
5. 注入可能在极少数站点需要一次重试（execCommand 兜底），但整体功能应完整

- [ ] **Step 7: 若手动测试有任何功能回归，退回对应 Task 修复再重新构建**

Expected: 全部通过，无回归。

- [ ] **Step 8: 确认 git 状态干净**

```bash
git status
```
Expected: `working tree clean`（dist/ 被 gitignore）。

---

## Task 11: 发布前置 — 推送 GitHub 仓库 + 开启 Pages

**Files:** 无代码变更，外部操作。

> **注：** 本步骤涉及不可逆的公开发布操作。执行前用户应亲自确认仓库名、可见性、提交身份。Claude 执行 `git push` 前必须再次向用户确认。

- [ ] **Step 1: 用户在 GitHub 新建仓库**

登录 GitHub（lintian0509 账号）→ New repository：
- 名字：`ai-arena-extension`
- 描述：`Multi-AI Chrome extension — broadcast, debate, summarize across Claude / Gemini / ChatGPT / DeepSeek / 豆包 / 通义千问.`
- Public
- 不勾 README / LICENSE / gitignore（我们本地已有）

- [ ] **Step 2: 绑定远端并首次推送**

```bash
cd C:/Users/lintian/AI_debate/ai-arena-extension
git remote add origin https://github.com/lintian0509/ai-arena-extension.git
git branch -M main
git push -u origin main
```
⚠️ **执行前向用户口头确认。**

- [ ] **Step 3: 在 GitHub 仓库设置启用 Pages**

Settings → Pages → Source: `Deploy from a branch` → Branch: `main` → Folder: `/ (root)` → Save

等 1-2 分钟后访问 `https://lintian0509.github.io/ai-arena-extension/privacy.html`：
Expected: 隐私政策页面正确显示。

- [ ] **Step 4: 创建 GitHub Release v1.0.0**

GitHub 仓库页 → Releases → Draft a new release：
- Tag: `v1.0.0`
- Title: `AI Arena v1.0.0 — 首次公开发布`
- Description: 粘贴 README 的"主要特性"章节，补一句"手动加载请下载下方 `ai-arena-github-v1.0.0.zip`"
- Attach: 上传本地 `dist/ai-arena-github-v1.0.0.zip`
- Publish

- [ ] **Step 5: 提交 Chrome Web Store 审核**

用户操作（Claude 只给指引，不代为上传）：
1. 登录 https://chrome.google.com/webstore/devconsole/（首次需付 $5）
2. 新建 Item → 上传 `dist/ai-arena-store-v1.0.0.zip`
3. 按 `docs/store-listing.md` 填入所有文案
4. 上传 3-5 张截图（用户自己截）
5. Privacy Policy URL 填 `https://lintian0509.github.io/ai-arena-extension/privacy.html`
6. 逐条填写 Permission justification
7. Single purpose 填 `docs/store-listing.md` 对应章节
8. 提交审核

- [ ] **Step 6: 审核通过后更新 README**

审核过后拿到商店 URL（形如 `https://chromewebstore.google.com/detail/<id>`），在 `README.md` "方式 1"下补链接，commit 并 push。

---

## 自审检查（Plan 作者自检结论）

- **Spec 覆盖：** spec §1 代码改造 → Task 2/3/4；§2 双构建 → Task 5；§3 素材 → Task 6/7/8/9；§4 提交策略 → Task 11；§2.1.3 system.display 重构 → Task 4 专项覆盖；spec 中测试策略对应 Task 10 的终检步骤 — 无遗漏。
- **Placeholder 扫描：** 无 TBD / TODO / "稍后补充" — 所有代码片段都是完整可粘贴的，所有命令可直接运行。
- **类型/签名一致性：** `arrangeWindows(screen = lastKnownScreen)` 签名在 Task 4 Step 5 定义，Step 4/7 调用一致；`lastKnownScreen` 对象形状 `{width,height,left,top}` 在定义和使用处一致。
- **未决事项：** 截图素材 + 英文文案为 Task 11 Step 5 用户侧补足，不阻塞代码发布。
