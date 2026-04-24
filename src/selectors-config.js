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
      '[data-message-author-role="assistant"]',
      ".markdown.prose"
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
    input: [
      '[contenteditable="true"]',
      "textarea",
      '[class*="input"][class*="editor"]'
    ],
    response: [
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
      '[class*="markdown"]',
      '[class*="assistant"] [class*="content"]',
      '[class*="message-content"]'
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
      '[class*="markdown"]',
      '[class*="assistant"] [class*="content"]',
      '[class*="bot-message"]',
      '[class*="answer"]'
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
