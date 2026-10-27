/**
 * 发信适配层。
 *
 * 支持两种通道，由 `EMAIL_PROVIDER` 选择：
 * - `cloudflare`：Workers `send_email` 绑定（需 Workers Paid 才能发给任意收件人）；
 * - `resend`：Resend HTTP API（免费档每天 100 封，需先验证发信域名）。
 *
 * 业务层只调用 sendVerificationEmail / sendRegisteredNotice，不关心通道。
 * 所有密钥只在本文件读取，不写日志。
 */

import { MAX_CODE_ATTEMPTS } from "./constants"
import type { Env } from "./types"

const RESEND_ENDPOINT = "https://api.resend.com/emails"

export type EmailProvider = "cloudflare" | "resend"

export interface EmailResult {
  ok: boolean
}

/** 只有 development 且显式打开 ALLOW_DEV_CODE，才允许把验证码打到控制台。 */
export function isDevCodeAllowed(env: Env): boolean {
  return env.ENVIRONMENT === "development" && env.ALLOW_DEV_CODE === "true"
}

function logEvent(event: string, fields: Record<string, string | number> = {}): void {
  console.log(`[account] ${event}`, fields)
}

/**
 * 决定本次用哪条通道发信。
 *
 * 显式 `EMAIL_PROVIDER` 优先；没配时按可用凭据推断：
 * 有 `send_email` 绑定走 cloudflare，有 `RESEND_API_KEY` 走 resend。
 * 都没有时返回 null，由调用方按开发/生产分别处理。
 */
export function resolveEmailProvider(env: Env): EmailProvider | null {
  const configured = (env.EMAIL_PROVIDER ?? "").trim().toLowerCase()
  if (configured === "cloudflare" || configured === "resend") return configured

  if (env.EMAIL) return "cloudflare"
  if (env.RESEND_API_KEY) return "resend"
  return null
}

interface MailContent {
  to: string
  subject: string
  html: string
  text: string
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
      <p style="margin:0 0 8px;line-height:1.7;color:#5d6878;">验证码 10 分钟内有效，最多尝试 ${MAX_CODE_ATTEMPTS} 次。</p>
      <p style="margin:0;line-height:1.7;color:#5d6878;">如果不是你本人操作，请忽略这封邮件，不要向任何人透露验证码。</p>
    </div>
  </body>
</html>`
}

function textFor(purpose: "register" | "reset", code: string): string {
  const action = purpose === "register" ? "注册账号" : "重置密码"
  return `青幕AI写作\n\n你正在${action}，验证码是：${code}\n\n验证码 10 分钟内有效，最多尝试 ${MAX_CODE_ATTEMPTS} 次。\n如果不是你本人操作，请忽略这封邮件，不要向任何人透露验证码。`
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

/**
 * 拆分 `AUTH_EMAIL_FROM`。
 *
 * 支持 `"显示名 <a@b.com>"` 与纯地址两种写法。Cloudflare 绑定的 from 只接受
 * 纯地址 + 可选 name，因此这里统一拆成两段，再由各通道自行拼装。
 */
export function parseFrom(raw: string | undefined): { email: string; name?: string } | null {
  const value = (raw ?? "").trim()
  if (!value) return null

  const angled = /^(.*)<([^<>]*)>$/.exec(value)
  if (angled) {
    const email = angled[2].trim()
    // `显示名 <>` 这类空地址必须拒绝，否则会把整串当地址发出去。
    if (!email || !email.includes("@")) return null
    const name = angled[1].trim().replace(/^"|"$/g, "").trim()
    return name ? { email, name } : { email }
  }

  if (!value.includes("@")) return null
  return { email: value }
}

async function sendViaCloudflare(env: Env, mail: MailContent): Promise<EmailResult> {
  const binding = env.EMAIL
  if (!binding) {
    logEvent("email_config_missing", { variable: "EMAIL binding" })
    return { ok: false }
  }

  const from = parseFrom(env.AUTH_EMAIL_FROM)
  if (!from) {
    logEvent("email_config_missing", { variable: "AUTH_EMAIL_FROM" })
    return { ok: false }
  }

  try {
    const result = await binding.send({
      to: mail.to,
      from: from.name ? { email: from.email, name: from.name } : from.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    })
    if (!result || typeof result.messageId !== "string" || !result.messageId) {
      logEvent("email_send_failed", { provider: "cloudflare", reason: "empty_message_id" })
      return { ok: false }
    }
    return { ok: true }
  } catch (error) {
    // 绑定抛出的 Error 带 code，例如 E_SENDER_NOT_VERIFIED / E_RATE_LIMIT_EXCEEDED。
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : ""
    logEvent("email_send_failed", { provider: "cloudflare", code: code || "unknown" })
    return { ok: false }
  }
}

async function sendViaResend(env: Env, mail: MailContent): Promise<EmailResult> {
  const apiKey = env.RESEND_API_KEY
  if (!apiKey) {
    logEvent("email_config_missing", { variable: "RESEND_API_KEY" })
    return { ok: false }
  }
  if (!parseFrom(env.AUTH_EMAIL_FROM)) {
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
        from: env.AUTH_EMAIL_FROM,
        to: [mail.to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      }),
    })
    if (!response.ok) {
      // 只记录状态码与 Resend 错误名，不记录收件人与正文。
      let name = ""
      try {
        const payload = (await response.json()) as { name?: unknown }
        if (typeof payload?.name === "string") name = payload.name
      } catch {
        name = ""
      }
      logEvent("email_send_failed", {
        provider: "resend",
        status: response.status,
        code: name || "unknown",
      })
      return { ok: false }
    }
    return { ok: true }
  } catch (error) {
    logEvent("email_network_error", {
      provider: "resend",
      name: error instanceof Error ? error.name : "UnknownError",
    })
    return { ok: false }
  }
}

async function deliver(env: Env, mail: MailContent, event: string): Promise<EmailResult> {
  const provider = resolveEmailProvider(env)

  if (!provider) {
    if (isDevCodeAllowed(env)) {
      // 开发替身：不请求网络，仅把验证码写到本地控制台，并视为发送成功。
      console.log(`[account] ${event}`, { to: mail.to, detail: mail.text })
      return { ok: true }
    }
    logEvent("email_config_missing", { variable: "EMAIL_PROVIDER / 凭据" })
    return { ok: false }
  }

  return provider === "cloudflare" ? sendViaCloudflare(env, mail) : sendViaResend(env, mail)
}

export async function sendVerificationEmail(
  env: Env,
  input: { to: string; code: string; purpose: "register" | "reset" },
): Promise<EmailResult> {
  return deliver(
    env,
    {
      to: input.to,
      subject: subjectFor(input.purpose),
      html: htmlFor(input.purpose, input.code),
      text: textFor(input.purpose, input.code),
    },
    `dev verification code email=${input.to} purpose=${input.purpose} code=${input.code}`,
  )
}

/** 已注册邮箱请求 register 验证码时，只发通知，不生成/写入验证码。 */
export async function sendRegisteredNotice(env: Env, to: string): Promise<EmailResult> {
  return deliver(
    env,
    {
      to,
      subject: "青幕AI写作 · 你已注册，请直接登录",
      html: registeredNoticeHtml(),
      text: registeredNoticeText(),
    },
    `dev registered notice email=${to}`,
  )
}
