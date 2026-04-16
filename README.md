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

本扩展不收集、不上传任何用户数据。详见 [隐私政策](https://TianLin0509.github.io/ai-arena-extension/privacy.html)。

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
