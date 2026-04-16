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
https://github.com/TianLin0509/ai-arena-extension/issues
