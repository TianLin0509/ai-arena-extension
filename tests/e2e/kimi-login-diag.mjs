// 诊断 Kimi 未登录页面的 DOM 特征，看为什么 F22 启发式漏报
import { chromium } from "playwright";

const ctx = await chromium.launch({ headless: false });
const page = await ctx.newPage();
console.log("打开 kimi.com 未登录页…");
await page.goto("https://www.kimi.com/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);  // 等 SPA 加载

const diag = await page.evaluate(() => {
  const result = {};
  // URL 检查
  result.url = location.href;
  result.pathname = location.pathname;
  result.urlLooksLikeLogin = /(?:^|\/)(login|signin|sign[_-]?in|sign[_-]?up)(?:\/|\?|$)/i.test(location.pathname);

  // 找登录 CTA 按钮（同 F22 启发式）
  const LOGIN_CTA = /^(登录|登陆|登入|立即登录|账号登录|账户登录|微信登录|扫码登录|手机登录|Sign in|Sign up|Sign Up|Log in|Log In|Login|Get started|Continue with)$/i;
  result.ctas = Array.from(document.querySelectorAll('button, a, [role="button"]'))
    .map(el => ({
      tag: el.tagName,
      text: (el.innerText || el.textContent || "").trim().slice(0, 30),
      cls: (el.className || "").toString().slice(0, 60),
      visible: el.getBoundingClientRect?.()?.width > 0,
    }))
    .filter(c => c.text && LOGIN_CTA.test(c.text));

  // 找含登录关键字的可见短文本元素（更宽松）
  result.loginTextElements = Array.from(document.querySelectorAll('button, a, [role="button"], span, div'))
    .map(el => ({
      tag: el.tagName,
      text: (el.innerText || el.textContent || "").trim(),
      cls: (el.className || "").toString().slice(0, 60),
    }))
    .filter(c => c.text && c.text.length < 20 && /^(登录|登陆|登入|sign in|log in|登 录)$/i.test(c.text))
    .slice(0, 10);

  // body 含登录字眼吗？
  result.bodyHasLoginText = /登录|Sign in|Log in/i.test(document.body?.innerText || "");

  // dialog/modal
  result.dialogs = Array.from(document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="login"], [class*="signin"]'))
    .map(el => ({
      cls: (el.className || "").toString().slice(0, 80),
      visible: el.getBoundingClientRect?.()?.width > 100,
      hasLoginText: /登录|Sign in|Log in/i.test((el.innerText || "")),
    }))
    .slice(0, 5);

  // 输入框存在吗
  result.hasInputBox = !!document.querySelector("textarea, [contenteditable='true'], [role='textbox'], rich-textarea .ql-editor");

  // body 前 500 字
  result.bodyTextPreview = (document.body?.innerText || "").slice(0, 500);

  return result;
});

console.log(JSON.stringify(diag, null, 2));
await ctx.close();
