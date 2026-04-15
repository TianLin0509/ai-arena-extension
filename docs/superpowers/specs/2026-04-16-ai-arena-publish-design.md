# AI Arena 公开发布设计文档

**日期：** 2026-04-16
**作者：** lintian0509
**状态：** Draft，待实现

## 目标

将 AI Arena Chrome 扩展从"个人自用版"改造为"可公开分发版"，双渠道发布：

1. **GitHub 开源仓库**：保留完整功能（含 CSP 剥离），用户开发者模式加载
2. **Chrome Web Store**：上架一个合规精简版，最大化过审概率

**核心约束：** 公开版本不得包含任何个人身份信息（工号 `l00807938`、真名"林田"、公司标签"解决方案"）。

## 非目标

- 不重写现有辩论引擎、state machine、content scripts
- 不做 i18n 国际化（界面保持中文为主）
- 不改变现有功能集（预设、辩论模式、流式检测等保持原样）
- 不做移动端或 Web 版（`ai-arena-mobile`、`web-arena` 不在本次范围）

## 背景

当前状态（`C:\Users\lintian\AI_debate\ai-arena-extension`）：

- MV3 sidePanel 扩展，manifest 版本 `1.0.0`，UI 内部喊 `v6.0`
- 权限包含 `declarativeNetRequest` + `dnr-rules.json`（剥离各 AI 站点 CSP 以支持 `robustInject`）
- 权限包含 `system.display`，仅用于 `background.js:423` 的 `arrangeWindows()` 读取屏幕尺寸
- `sidepanel.html` 有 3 处显示"林田l00807938"（title、右下角 badge、footer）
- 未开源，无 LICENSE、无 README、无 `.gitignore`、无构建脚本

Chrome Web Store 对以下项极为敏感：
- 响应头/CSP 修改
- 多站点 host_permissions（尤其覆盖 Google 自家产品）
- 不透明的自动化/注入行为
- `system.display` 等 system 类权限

## 架构总览

```
ai-arena-extension/             (repo root)
├── src/                        (现有所有运行时文件搬入此目录)
│   ├── manifest.json
│   ├── background.js
│   ├── sidepanel.html / .css / .js
│   ├── content-*.js
│   ├── inject-images.js
│   ├── debate-engine.js
│   ├── state-machine.js
│   ├── selectors-config.js
│   ├── dnr-rules.json
│   └── icons/
├── build.mjs                   (新增：双构建脚本)
├── package.json                (新增：声明 node 版本、scripts)
├── dist/                       (gitignored)
│   ├── store/                  (上架版解包)
│   ├── github/                 (完整版解包)
│   ├── ai-arena-store-v1.0.0.zip
│   └── ai-arena-github-v1.0.0.zip
├── docs/
│   ├── store-listing.md        (商店详细描述+权限说明文案)
│   └── superpowers/specs/...   (本文档)
├── privacy.html                (GitHub Pages 入口)
├── PRIVACY.md                  (同源，便于 GitHub 浏览)
├── README.md
├── LICENSE                     (MIT)
└── .gitignore
```

## 组件设计

### 1. 代码改造（两版共用）

**1.1 移除个人信息**

- `src/sidepanel.html`
  - 第 17-21 行：整个 `<div class="author-badge-fixed">` 块删除
  - 第 123 行：footer 文案改为 `AI Arena v1.0.0`（删除"解决方案出品 · 林田l00807938 |"整段）
- `src/sidepanel.css`：随之移除 `.author-badge-fixed` 相关规则（避免死 CSS）
- 兜底：`grep -i "林田\|l00807938\|解决方案"` 全仓库扫一遍，预期 0 匹配

**1.2 版本号统一**

- `manifest.json` 保持 `"version": "1.0.0"`（首次公开发布，不用内部 v6.0）
- 代码中"v6.0" 字符串全部替换为 "v1.0.0"（预计只 `sidepanel.html` footer 一处）

**1.3 system.display 权限移除（重构 arrangeWindows）**

- `sidepanel.js`：在触发 `arrangeWindows` 消息前，读取 `window.screen.availWidth / availHeight / availLeft / availTop`，作为 payload 发给 background
- `background.js:423` 的 `arrangeWindows()`：
  - 删除 `chrome.system.display.getInfo()` 调用
  - 改为从消息 payload 接收 `{ screenW, screenH, left, top }`
  - 其余坐标计算逻辑不变
- `manifest.json`：从 permissions 数组删除 `"system.display"`

### 2. 双构建机制（`build.mjs`）

**职责：** 从 `src/` 生成两份可直接加载的扩展目录 + 对应 zip。

**伪代码：**
```
argv[2] ∈ {store, github, all}

copySrc(targetDir):
  cp -r src/* targetDir/

buildGithub():
  copySrc(dist/github)
  zip dist/github → dist/ai-arena-github-v<VERSION>.zip

buildStore():
  copySrc(dist/store)
  manifest = read(dist/store/manifest.json)
  manifest.permissions.remove("declarativeNetRequest")
  delete manifest.declarative_net_request
  write(manifest)
  rm dist/store/dnr-rules.json
  zip dist/store → dist/ai-arena-store-v<VERSION>.zip

all: buildGithub(); buildStore()
```

**约束：**
- 不修改 `src/` 本体（构建只影响 `dist/`）
- VERSION 从 `src/manifest.json` 动态读取，两版 zip 名自动带版本号
- 依赖仅用 Node 内置模块 + `archiver`（zip）— `package.json` 仅此一个运行时依赖

### 3. 仓库素材

**3.1 README.md（中文）**

章节：
1. 简介（一句话 + 主要特性列表）
2. 截图（3-5 张，占位 `![](docs/screenshots/xxx.png)` — 截图用户稍后补）
3. 安装方式
   - 商店安装（附商店链接，上架后回填）
   - 手动安装（下载 Release zip → 解压 → 开发者模式加载 `dist/github/`）
4. 使用说明（基础流程、预设、两种辩论模式）
5. 兼容性与限制（各 AI 站点登录前置、简洁模式、CSP 说明）
6. 隐私声明（不收集数据，链接 privacy.html）
7. 许可证（MIT）

**3.2 LICENSE**

标准 MIT，版权人 `lintian0509`，年份 `2026`。

**3.3 PRIVACY.md / privacy.html**

GitHub Pages 托管，URL: `https://lintian0509.github.io/ai-arena-extension/privacy.html`

内容要点：
- 本扩展不收集、不存储、不传输任何用户数据到扩展开发者或第三方
- 所有 prompt、对话内容只在本地 `chrome.storage.local` 和用户已登录的各 AI 官网之间流动
- 各 AI 官网的数据处理以其自身隐私政策为准
- 扩展请求的权限逐条解释用途
- 联系方式：GitHub Issues

**3.4 .gitignore**
```
node_modules/
dist/
*.zip
.DS_Store
```

**3.5 docs/store-listing.md**

商店后台填表文案（中英双语），包含：
- 简短说明（132 字以内）
- 详细描述（Markdown，~500 字）
- 每条权限的"Justification"（商店现在强制要求）
- 单一用途声明（Chrome 政策：扩展必须有单一明确用途）

### 4. Chrome Web Store 提交策略

**准备清单：**
- [ ] $5 开发者注册费（lintian0509 账号）
- [ ] 上传 `ai-arena-store-v1.0.0.zip`
- [ ] 粘贴 `docs/store-listing.md` 内容
- [ ] 上传 5 张截图（1280×800）
- [ ] 填入 `privacy.html` URL
- [ ] 分类：Productivity
- [ ] 语言：简体中文

**风险缓解：**
- 商店版无 `declarativeNetRequest`、无 `system.display`，权限列表更干净
- 文案中避免 `bypass`、`inject`、`automation`、`scrape` 等敏感词
- 每条权限的 justification 用"用户驱动"语气（"The user clicks X, therefore we need Y"）

## 数据流

无新增数据流。唯一变化：

**并列模式屏幕尺寸**（之前 background→chrome.system.display，现在 sidepanel→background message payload）：

```
[用户点击"并列"]
    ↓
sidepanel.js: 读 window.screen.available*
    ↓ chrome.runtime.sendMessage({ type: 'arrangeWindows', screen: {...} })
background.js: arrangeWindows(msg.screen)
    ↓ chrome.windows.update(...) × N
```

## 错误处理

- **构建脚本**：任何一步失败（文件不存在、zip 失败）直接 exit 1，打印报错
- **arrangeWindows 屏幕尺寸缺失**：sidepanel 传空对象时 background 降级用默认 `{ screenW: 1920, screenH: 1080, left: 0, top: 0 }` 并 console.warn
- **GitHub Pages privacy.html 404**：商店审核必看此 URL，提交前必须手动访问确认 200

## 测试策略

**构建脚本：**
1. `node build.mjs github` → 检查 `dist/github/manifest.json` 包含 `declarativeNetRequest`，`dnr-rules.json` 存在
2. `node build.mjs store` → 检查 `dist/store/manifest.json` **不含** `declarativeNetRequest` 和 `system.display`，**不存在** `dnr-rules.json`
3. 两个 zip 用 `unzip -l` 核对文件清单

**功能回归（两版都要）：**
1. Chrome 开发者模式加载 `dist/github/` 和 `dist/store/`，分别执行：
   - 三巨头预设 → 发问 → 收到 3 个回复
   - 并列模式 → 窗口正确排布（验证 system.display 重构无回归）
   - 彻底重置 → 状态干净
2. 商店版在某个 CSP 严格的站点测试：robustInject 是否仍通过 execCommand 兜底成功（预期偶尔失败但不崩）

**个人信息清除：**
- `grep -ri "林田\|l00807938\|解决方案" dist/` 两版结果必须为空

## 构建与发布序列

按顺序执行（每步验证通过再进下一步）：

1. 代码改造（移除署名、统一版本号、system.display 重构）
2. 新增 `build.mjs` / `package.json` / `.gitignore`
3. `node build.mjs all` 本地产出两版，本地加载验证功能
4. 写 `README.md` / `LICENSE` / `PRIVACY.md` / `privacy.html` / `docs/store-listing.md`
5. `git init` 已存在，新建 GitHub 远端 `lintian0509/ai-arena-extension`，首次 push
6. 开启 GitHub Pages，验证 privacy.html 可访问
7. 创建 GitHub Release v1.0.0，附 `ai-arena-github-v1.0.0.zip`
8. 注册 Chrome Developer 账号（$5），提交 `ai-arena-store-v1.0.0.zip` + 素材
9. 审核通过后回填商店链接到 README

## 未决事项

- **截图素材**：实现阶段给占位图，最终由用户提供 3-5 张真实使用截图
- **商店描述文案**：我会先草拟中文版，用户审阅后再写英文版
- **过审失败的 Plan B**：若被拒，根据拒信决定是进一步降级（例如砍掉某个 host_permission）还是放弃上架只走 GitHub 渠道 — 到时再决定，本 spec 不预先设计
