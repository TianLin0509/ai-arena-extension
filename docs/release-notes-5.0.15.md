# AI Arena v5.0.15

## 本次重点

- 新增队长模式，默认开启：第一个 AI 成员会收到额外协作提示，负责总结其他 AI 队员观点；如果当前轮没有队员发言，则直接回答，不会编造总结。
- 设置页新增“队长模式 / 普通模式”切换按钮，用户可以随时关闭队长身份注入。
- Tab 模式主界面 header 新增“唤起 AI”按钮，可依次把所有已加入的 AI Tab 切到前台，方便检查登录、页面就绪和发送状态。
- 修复折叠到顶后内容折叠但窗口高度不变的问题，MV3 service worker 重启后也能用按钮携带的 windowId 找回弹窗。

## 构建产物

- `ai-arena-github-v5.0.15.zip`：GitHub / 手动安装版本。
- `ai-arena-store-v5.0.15.zip`：Chrome Web Store 提审版本，已自动剥离测试和 POC 目录。

## 验证

- `npm test`
- `npm run build`
