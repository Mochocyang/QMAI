/**
 * Resend 发信适配器。
 * 只在这里接触 RESEND_API_KEY；业务层不关心邮件通道。
 */

import type { Env } from "./types"

const RESEND_ENDPOINT = "https://api.resend.com/emails"

export interface EmailResult {
  ok: boolean
}

function isDevelopment(env: Env): boolean {
  return env.ENVIRONMENT === "development"
}

function logEvent(event: string, fields: Record<string, string | number> = {}): void {
  console.log(`[account] ${event}`, fields)
}

function subjectFor(purpose: "register" | "reset"): string {
  return purpose === "register" ? "青幕AI写作 · 注册验证码" : "青幕AI写作 · 重置密码验证码"
}

function htmlFor(purpose: "register" | "reset", code: string): string {
  const action = purpose === "register" ? "注册账号" : "重置密码"
  return `<!doctype html>
<html lang="zh-CN">
  <body style="margin:0;padding:24px;background:#f6f7f9;font-family:'PingFang SC','Microsoft YaHei',Arial,sans-serif;color:#1d2430;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #dfe4ea;border-radius:14px;padding:28px 30px;">
      <h2 style="margin:0 0 14px;font-size:20px;color:#3f6f5f;">青幕AI写作</h2>
      <p style="margin:0 0 10px;line-height:1.7;">你好，</p>
      <p style="margin:0 0 16px;line-height:1.7;">你正在${action}，验证码是：</p>
      <p style="margin:0 0 18px;font-size:30px;font-weight:700;letter-spacing:7px;color:#23483c;">${code}</p>
      <p style="margin:0 0 8px;line-height:1.7;color:#5d6878;">验证码 10 分钟内有效，最多尝试 5 次。</p>
      <p style="margin:0;line-height:1.7;color:#5d6878;">如果不是你本人操作，请忽略这封邮件，不要向任何人透露验证码。</p>
    </div>
  </body>
</html>`
}

function textFor(purpose: "register" | "reset", code: string): string {
  const action = purpose === "register" ? "注册账号" : "重置密码"
  return `青幕AI写作\n\n你正在${action}，验证码是：${code}\n\n验证码 10 分钟内有效，最多尝试 5 次。\n如果不是你本人操作，请忽略这封邮件，不要向任何人透露验证码。`
}

function registeredNoticeHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <body style="margin:0;padding:24px;background:#f6f7f9;font-family:'PingFang SC','Microsoft YaHei',Arial,sans-serif;color:#1d2430;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #dfe4ea;border-radius:14px;padding:28px 30px;">
      <h2 style="margin:0 0 14px;font-size:20px;color:#3f6f5f;">青幕AI写作</h2>
      <p style="margin:0 0 10px;line-height:1.7;">你好，</p>
      <p style="margin:0 0 16px;line-height:1.7;">这个邮箱已经注册过青幕AI写作账号，请直接登录。</p>
      <p style="margin:0 0 8px;line-height:1.7;color:#5d6878;">如果忘记密码，可以在登录页点击「忘记密码？」重置。</p>
      <p style="margin:0;line-height:1.7;color:#5d6878;">如果不是你本人操作，请忽略这封邮件。</p>
    </div>
  </body>
</html>`
}

function registeredNoticeText(): string {
  return "青幕AI写作\n\n这个邮箱已经注册过青幕AI写作账号，请直接登录。\n如果忘记密码，可以在登录页点击「忘记密码？」重置。\n如果不是你本人操作，请忽略这封邮件。"
}

async function postResend(
  env: Env,
  payload: { subject: string; html: string; text: string; to: string },
): Promise<EmailResult> {
  const apiKey = env.RESEND_API_KEY
  const from = env.AUTH_EMAIL_FROM

  if (!apiKey) {
    if (isDevelopment(env)) {
      // 仅开发模式、且未配置 Resend 时才允许把验证码打到本地日志。
      logEvent(payload.subject.includes("注册验证码") ? "dev_code_email" : "dev_email", {
        to: payload.to,
      })
      return { ok: true }
    }
    logEvent("email_config_missing", { variable: "RESEND_API_KEY" })
    return { ok: false }
  }

  if (!from) {
    logEvent("email_config_missing", { variable: "AUTH_EMAIL_FROM" })
    return { ok: false }
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [payload.to],
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
      }),
    })
    if (!response.ok) {
      logEvent("email_send_failed", { status: response.status })
      return { ok: false }
    }
    return { ok: true }
  } catch (error) {
    logEvent("email_network_error", {
      name: error instanceof Error ? error.name : "UnknownError",
    })
    return { ok: false }
  }
}

export async function sendVerificationEmail(
  env: Env,
  input: { to: string; code: string; purpose: "register" | "reset" },
): Promise<EmailResult> {
  if (!env.RESEND_API_KEY && isDevelopment(env)) {
    // 开发替身：不请求网络，仅把验证码写到本地控制台，并视为发送成功。
    console.log(
      `[account] dev verification code email=${input.to} purpose=${input.purpose} code=${input.code}`,
    )
    return { ok: true }
  }

  return postResend(env, {
    to: input.to,
    subject: subjectFor(input.purpose),
    html: htmlFor(input.purpose, input.code),
    text: textFor(input.purpose, input.code),
  })
}

/** 已注册邮箱请求 register 验证码时，只发通知，不生成/写入验证码。 */
export async function sendRegisteredNotice(env: Env, to: string): Promise<EmailResult> {
  if (!env.RESEND_API_KEY && isDevelopment(env)) {
    console.log(`[account] dev registered notice email=${to}`)
    return { ok: true }
  }

  return postResend(env, {
    to,
    subject: "青幕AI写作 · 你已注册，请直接登录",
    html: registeredNoticeHtml(),
    text: registeredNoticeText(),
  })
}
