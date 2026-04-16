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
完整政策：https://TianLin0509.github.io/ai-arena-extension/privacy.html

### 开源
源码公开在 GitHub：https://github.com/TianLin0509/ai-arena-extension

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
