// selectors-config.js — 内置默认选择器配置
// 每个平台的每个 action 是一个选择器数组，按优先级排列

const DEFAULT_SELECTORS = {
  claude: {
    input: [
      "div.ProseMirror[contenteditable='true']",
      ".ProseMirror[contenteditable]",
      "[contenteditable='true']"
    ],
    response: [
      "[data-testid='chat-message-content']",
      ".font-claude-message",
      "[data-is-streaming]",
      ".prose, .markdown",
      '[class*="message"], [class*="response"], [class*="assistant"]'
    ],
    streaming: [
      '[data-is-streaming="true"]',
      '.font-claude-message [data-is-streaming="true"]',
      ".is-streaming",
      'button[aria-label="Stop Response"]',
      'button[aria-label="Stop response"]',
      '[data-is-thinking="true"]',
      ".font-claude-message .thinking-indicator",
      '.font-claude-message [class*="thinking"]',
      'button[aria-label="Cancel"]',
      ".font-claude-message .animate-spin",
      "[data-is-streaming] .animate-spin"
    ],
    sendButton: [
      'button[aria-label="Send Message"]',
      'button[aria-label="Send message"]',
      'button[data-testid="send-button"]'
    ],
    userMessage: [
      '[data-testid="human-turn"]'
    ],
    conversation: [
      '[data-testid="human-turn"], .font-claude-message, [data-is-streaming]'
    ]
  },
  chatgpt: {
    input: [
      "#prompt-textarea",
      "textarea",
      "[contenteditable='true']"
    ],
    response: [
      // v4.3.2: 加宽匹配，捕获 ChatGPT 生图模式下的 image attachment 容器
      '[data-message-author-role="assistant"]',
      '[data-testid^="conversation-turn-"]:has([data-message-author-role="assistant"])',
      ".markdown.prose",
      'div.group\\/turn-messages:last-child'
    ],
    streaming: [
      'button[aria-label="Stop generating"]',
      'button[aria-label="Stop streaming"]',
      '[data-testid="stop-button"]'
    ],
    sendButton: [
      '[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send"]'
    ],
    conversation: [
      "[data-message-author-role]"
    ]
  },
  gemini: {
    input: [
      ".ql-editor[contenteditable='true']",
      "rich-textarea .ql-editor",
      ".text-input-field textarea",
      "[contenteditable='true']"
    ],
    response: [
      ".model-response-text .markdown",
      ".response-container .markdown",
      "[data-content-type='model']"
    ],
    streaming: [
      "model-response .loading-indicator",
      "button[aria-label='Stop response']",
      "button[aria-label='Stop generating']",
      "button[aria-label*='Stop']",
      ".thinking-indicator",
      "thinking-tag",
      "model-response .thinking",
      "model-response [class*='thinking']",
      "model-response .animate-spin",
      "model-response mat-spinner"
    ],
    sendButton: [
      'button[aria-label="Send message"]',
      'button[aria-label*="发送"]',
      "button.send-button"
    ],
    conversation: [
      "user-query, model-response",
      "[data-content-type]"
    ]
  },
  deepseek: {
    input: [
      "#chat-input",
      "textarea[placeholder]",
      "textarea",
      '[contenteditable="true"]'
    ],
    response: [
      ".ds-markdown",
      '[class*="assistant-message"]',
      '[class*="bot-message"]',
      ".markdown-body",
      ".prose"
    ],
    streaming: [
      ".ds-loading",
      'button[aria-label="Stop generating"]',
      'button[aria-label="Stop"]'
    ],
    sendButton: [
      '[data-testid="send-button"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="发送"]'
    ],
    userMessage: [
      '[class*="user-message"]',
      '[class*="human"]',
      ".fbb737a4"
    ]
  },
  doubao: {
    // v5.2.2: 用户登录态 console 实测确认真实命名（v5.2.1 的 bg-g-receive 推断错了，豆包不对称设计）
    //   · 消息行容器：[class*="v_list_row"] （在 [class*="list_items"] 内）
    //   · AI 回复 = v_list_row 内不含 bg-g-send 的（用户消息内才有 bg-g-send）
    //   · 用户消息：[class*="bg-g-send"]
    //   · 输入框：textarea.semi-input-textarea（Semi Design）
    //   · 注意 [class*="inner-item-{hash}"] 含 CSS Modules hash 不能用
    input: [
      'textarea.semi-input-textarea',                    // 主输入框（实测）
      '[contenteditable="true"]',
      "textarea",
      '[class*="input"][class*="editor"]'
    ],
    response: [
      // v5.2.2: 核心 selector — v_list_row 但不含 bg-g-send（=AI 消息行）
      '[class*="v_list_row"]:not(:has([class*="bg-g-send"]))',
      // 兜底：万一 v_list_row 命名变了，fallback 到老命名
      '[class*="assistant"] [class*="content"]',
      '[class*="bot-message"]',
      '[class*="markdown"]'
    ],
    streaming: [
      'button[class*="stop"]',
      '[class*="generating"]'
    ],
    sendButton: [
      'button[class*="send"]',
      '[class*="send-btn"]'
    ],
    userMessage: [
      // v5.2.2: 用户消息 = v_list_row 内含 bg-g-send；或直接抓 bg-g-send 块
      '[class*="bg-g-send"]',
      '[class*="send-msg-bubble-text"]',
      // 老 selector：
      '[class*="user-message"]',
      '[class*="human-message"]',
      '[class*="user_message"]'
    ]
  },
  qwen: {
    input: [
      '[role="textbox"]',
      '[contenteditable="true"]',
      '[contenteditable]',
      "textarea"
    ],
    response: [
      '[class*="assistant"] [class*="content"]',
      '[class*="answer-content"]',
      '[class*="markdown"]'
    ],
    streaming: [
      'button[class*="stop"]',
      '[class*="generating"]'
    ],
    sendButton: [
      'button[class*="send"]',
      'button[class*="submit"]'
    ],
    userMessage: [
      '[class*="user"] [class*="content"]',
      '[class*="human"] [class*="text"]',
      '[class*="question"]'
    ]
  },
  kimi: {
    input: [
      '[role="textbox"]',
      '[contenteditable="true"]',
      '[contenteditable]',
      "textarea"
    ],
    response: [
      // v4.3.7 加宽 — Kimi 网页改 class 频繁
      '[class*="segment-assistant"]',
      '[class*="assistant-segment"]',
      '[class*="message-content"]',
      '[class*="assistant"] [class*="content"]',
      '[class*="assistant"] [class*="markdown"]',
      '[class*="markdown-body"]',
      '[data-role="assistant"]',
      'div.markdown',
      '[class*="ChatBubble"][class*="assistant"]'
    ],
    streaming: [
      'button[class*="stop"]',
      '[class*="generating"]',
      '[class*="loading"]'
    ],
    sendButton: [
      'button[class*="send"]',
      'button[class*="submit"]'
    ],
    userMessage: [
      '[class*="user"] [class*="content"]',
      '[class*="human"]'
    ]
  },
  yuanbao: {
    input: [
      '[contenteditable="true"]',
      "textarea",
      '#chat-input'
    ],
    response: [
      // v4.3.10 优先精确 markdown 容器，避免包含底部推荐/工具栏/安装按钮等噪声
      '[class*="bot-message"] [class*="markdown"]',
      '[class*="assistant"] [class*="markdown"]',
      '[class*="answer"] [class*="markdown"]',
      '[class*="markdown-body"]',
      // 兜底（旧匹配）
      '[class*="bot-message"]',
      '[class*="answer"]',
      '[class*="assistant"] [class*="content"]'
    ],
    streaming: [
      'button[class*="stop"]',
      '[class*="generating"]',
      '[class*="loading"]'
    ],
    sendButton: [
      'button[class*="send"]',
      'button[class*="submit"]'
    ],
    userMessage: [
      '[class*="user"] [class*="content"]',
      '[class*="human"]'
    ]
  },
  grok: {
    input: [
      'div.tiptap.ProseMirror[contenteditable="true"]',
      '[contenteditable="true"]',
      '[role="textbox"]',
      "textarea"
    ],
    response: [
      '[class*="message-bubble"] [class*="markdown"]',
      '[class*="assistant"] [class*="content"]',
      '[class*="markdown"]',
      ".prose"
    ],
    streaming: [
      'button[aria-label="Stop"]',
      'button[aria-label="Stop generating"]',
      'button[aria-label="停止"]',
      '[class*="stop"]'
    ],
    sendButton: [
      'button[aria-label="提交"]',
      'button[aria-label="Submit"]',
      'button[aria-label="Send"]'
    ],
    userMessage: [
      '[class*="user"] [class*="content"]',
      '[class*="human"]'
    ]
  }
};
