# Chrome Web Store 上架文案（直接复制到开发者后台）

> 适用版本：v5.0.15+
> 后台地址：https://chrome.google.com/webstore/devconsole

---

## 1. 商品详情（Product details）

### 1.1 扩展名（Name，最多 75 字符）
```
AI圆桌派
```

### 1.2 简短说明（Summary，最多 132 字符）
```
让 Claude、Gemini、ChatGPT 等主流 AI 同时回答同一个问题，并支持多轮辩论和总结，一个侧边栏统一调度。
```

### 1.3 详细描述（Description）

```
AI圆桌派是一个让你同时与多个主流 AI 对话的 Chrome 扩展。

【能做什么】
• 一键把同一个问题广播给 Claude、Gemini、ChatGPT、DeepSeek、豆包、通义千问、Kimi、元宝、Grok 中任意 3 个
• 让不同 AI 相互辩论、或围绕同一个问题群策群力
• 自动汇总对比各方回答
• 支持图片和文本文件上传
• 辩论轮次感知提示，自动引导每轮深化
• 队长模式默认开启，第一个 AI 会主动归纳其他 AI 队员观点；第一轮没有队员发言时不会强行总结
• Tab 模式新增“一键唤起 AI”，可依次把所有 AI 页面切到前台，方便检查网页登录和发送状态
• 一键复制对话摘要到新窗口继续追问

【适合谁】
• 需要多模型交叉验证答案的用户
• 做 AI 横向对比测评的研究者
• 希望让不同模型互相补充知识盲区的学习者

【使用前提】
使用本扩展前，请先在浏览器中分别登录你要使用的 AI 官网（Claude、Gemini、ChatGPT 等）。扩展本身不提供账号，也不代替你登录。

【隐私承诺】
本扩展不收集、不上传任何用户数据。所有对话内容仅在你的浏览器和你已登录的各 AI 官网之间流动。
完整政策：https://TianLin0509.github.io/ai-arena-extension/privacy.html

【开源】
源码公开在 GitHub：https://github.com/TianLin0509/ai-arena-extension
```

### 1.4 类别（Category）
```
生产力工具 / Productivity
```

### 1.5 语言（Language）
```
简体中文（Chinese - Simplified）
```

---

## 2. 隐私规范（Privacy practices）

### 2.1 单一用途声明（Single purpose）
```
本扩展的唯一用途是：让用户在一个侧边栏界面中同时与多个 AI 对话平台交互并对比回答。
```

英文版（可选）：
```
The single purpose of this extension is to let users interact with multiple AI chat platforms simultaneously in a unified side panel and compare their responses.
```

### 2.2 隐私政策 URL
```
https://TianLin0509.github.io/ai-arena-extension/privacy.html
```
（开 GitHub Pages 后此 URL 即生效，见手动操作清单）

### 2.3 数据使用声明
后台会问"是否收集以下数据"，全部勾选「不」即可：
- 个人身份信息：**否**
- 健康信息：**否**
- 财务和支付信息：**否**
- 鉴权信息：**否**
- 个人通信内容：**否**（对话内容只在本地浏览器和用户已登录的 AI 官网间流动）
- 位置信息：**否**
- 网页历史：**否**
- 用户活动：**否**
- 网站内容：**否**

三项遵守声明全部勾选：
- ☑ 我不会出售用户数据给第三方
- ☑ 我不会将用户数据用于与扩展功能无关的目的
- ☑ 我不会将用户数据用于贷款审批等用途

---

## 3. 权限申辩（Permission justification，全英文）

每个权限单独填写。**`debugger` 权限是退审重灾区，务必详细写。**

| 权限 | Justification |
|---|---|
| `sidePanel` | The extension's main UI is rendered as a persistent side panel so users can interact with multiple AI platforms while browsing. |
| `tabs` | To detect whether each AI platform tab is already open and route prompts to the correct tab. |
| `activeTab` | To read user-selected text on the active page and forward it as a prompt only when the user explicitly triggers the extension. |
| `storage` | To persist user preferences (participants, debate mode, presets) and local conversation history. Nothing is sent to any external server. |
| `windows` | To arrange the participant AI windows side-by-side when the user chooses the "tiled" layout mode. |
| `system.display` | To compute the correct geometry for the tiled-window layout based on the user's monitor configuration. |
| `contextMenus` | To offer a right-click shortcut for sending selected text to the extension. |
| `scripting` | To inject the prompt into each AI platform's chat box and read the streaming response back. Runs only on the listed host_permissions domains. |
| `downloads` | To allow the user to export a debate transcript or summary as a local file via the "Save" action. |
| `debugger` | **CRITICAL — write carefully**: Used exclusively as a fallback on specific AI platforms (Claude, Gemini) where standard content-script messaging cannot reliably detect streaming completion or read the assistant's output due to Shadow DOM and cross-frame isolation. The extension attaches the debugger only to tabs the user has explicitly added to a debate session, never to arbitrary tabs, and detaches as soon as the response is captured. No remote code is downloaded or executed; the debugger protocol is used only for local DOM observation. |
| `host_permissions` (10 origins) | Limited to the exact origins of the supported AI platforms: claude.ai, gemini.google.com, chatgpt.com, chat.deepseek.com, doubao.com, tongyi.aliyun.com, kimi.com/kimi.moonshot.cn, yuanbao.tencent.com, grok.com. Used only to inject prompts and read responses for the platforms the user has chosen to broadcast to. |

注：store 版 build 时已自动剥离 `declarativeNetRequest` 权限和 `dnr-rules.json`，无需填该项。

---

## 4. 图形资产

| 资产 | 规格 | 来源 |
|---|---|---|
| 商品图标 | 128×128 PNG | `src\icons\icon128.png`（已就绪） |
| 截图 | 1280×800，至少 1 张，最多 5 张 | **需手动截**，见手动操作清单 |
| 小宣传图（可选） | 440×280 | 暂不提交 |
| 大宣传图（可选） | 1400×560 | 暂不提交 |

---

## 5. 分发设置

| 项 | 选择 |
|---|---|
| 可见性 | 「不公开」首发（链接分享内测）→ 稳定后切「公开」 |
| 地区 | 全球所有地区 |
| 定价 | 免费 |
| 包含付费内容 | 否 |
| 包含广告 | 否 |
