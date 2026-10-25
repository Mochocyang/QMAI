// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  parseFrom,
  resolveEmailProvider,
  sendRegisteredNotice,
  sendVerificationEmail,
} from "../src/email"
import type { Env } from "../src/types"

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as Env["DB"],
    AUTH_EMAIL_FROM: "青幕AI写作 <no-reply@qmai.pro>",
    ENVIRONMENT: "production",
    ...overrides,
  }
}

describe("resolveEmailProvider", () => {
  it("显式配置优先于自动推断", () => {
    expect(resolveEmailProvider(baseEnv({ EMAIL_PROVIDER: "resend", EMAIL: bindingSpy().binding }))).toBe(
      "resend",
    )
    expect(
      resolveEmailProvider(baseEnv({ EMAIL_PROVIDER: "cloudflare", RESEND_API_KEY: "re_x" })),
    ).toBe("cloudflare")
  })

  it("大小写与空白不敏感", () => {
    expect(resolveEmailProvider(baseEnv({ EMAIL_PROVIDER: "  Resend " }))).toBe("resend")
  })

  it("没配时按可用凭据推断", () => {
    expect(resolveEmailProvider(baseEnv({ EMAIL: bindingSpy().binding }))).toBe("cloudflare")
    expect(resolveEmailProvider(baseEnv({ RESEND_API_KEY: "re_x" }))).toBe("resend")
    expect(resolveEmailProvider(baseEnv())).toBeNull()
  })

  it("无法识别的值回落到推断", () => {
    expect(resolveEmailProvider(baseEnv({ EMAIL_PROVIDER: "sendgrid", RESEND_API_KEY: "re_x" }))).toBe(
      "resend",
    )
  })
})

describe("parseFrom", () => {
  it("拆分显示名与地址", () => {
    expect(parseFrom("青幕AI写作 <no-reply@qmai.pro>")).toEqual({
      email: "no-reply@qmai.pro",
      name: "青幕AI写作",
    })
  })

  it("支持纯地址", () => {
    expect(parseFrom("no-reply@qmai.pro")).toEqual({ email: "no-reply@qmai.pro" })
  })

  it("去掉地址两侧空白与引号包裹的显示名", () => {
    expect(parseFrom('"QMAI" < no-reply@qmai.pro >')).toEqual({
      email: "no-reply@qmai.pro",
      name: "QMAI",
    })
  })

  it("空值或空地址返回 null", () => {
    expect(parseFrom(undefined)).toBeNull()
    expect(parseFrom("   ")).toBeNull()
    expect(parseFrom("显示名 <>")).toBeNull()
  })
})

function bindingSpy(result: { messageId: string } | Error = { messageId: "msg_1" }) {
  const send = vi.fn(async () => {
    if (result instanceof Error) throw result
    return result
  })
  return { binding: { send }, send }
}

const silentConsole = () => vi.spyOn(console, "log").mockImplementation(() => {})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("sendVerificationEmail · cloudflare 通道", () => {
  it("调用绑定并返回成功", async () => {
    silentConsole()
    const spy = bindingSpy()
    const env = baseEnv({ EMAIL_PROVIDER: "cloudflare", EMAIL: spy.binding })

    const result = await sendVerificationEmail(env, {
      to: "user@example.com",
      code: "123456",
      purpose: "register",
    })

    expect(result.ok).toBe(true)
    expect(spy.send).toHaveBeenCalledTimes(1)
    const message = spy.send.mock.calls[0][0] as {
      to: string
      from: { email: string; name?: string }
      subject: string
      html: string
      text: string
    }
    expect(message.to).toBe("user@example.com")
    expect(message.from).toEqual({ email: "no-reply@qmai.pro", name: "青幕AI写作" })
    expect(message.subject).toContain("注册验证码")
    expect(message.html).toContain("123456")
    expect(message.text).toContain("123456")
  })

  it("绑定抛错时返回失败，且不抛出", async () => {
    silentConsole()
    const error = Object.assign(new Error("sender not verified"), {
      code: "E_SENDER_NOT_VERIFIED",
    })
    const spy = bindingSpy(error)
    const env = baseEnv({ EMAIL: spy.binding })

    const result = await sendVerificationEmail(env, {
      to: "user@example.com",
      code: "123456",
      purpose: "reset",
    })

    expect(result.ok).toBe(false)
  })

  it("缺少 AUTH_EMAIL_FROM 时失败关闭", async () => {
    silentConsole()
    const spy = bindingSpy()
    const env: Env = { DB: {} as Env["DB"], EMAIL: spy.binding, ENVIRONMENT: "production" }

    await expect(
      sendVerificationEmail(env, { to: "a@b.com", code: "1", purpose: "register" }),
    ).resolves.toEqual({ ok: false })
    expect(spy.send).not.toHaveBeenCalled()
  })
})

describe("sendVerificationEmail · resend 通道", () => {
  it("调用 Resend HTTP API 并带上 from 原始写法", async () => {
    silentConsole()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "email_1" }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    const env = baseEnv({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test" })

    const result = await sendVerificationEmail(env, {
      to: "user@example.com",
      code: "654321",
      purpose: "reset",
    })

    expect(result.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://api.resend.com/emails")
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test")
    const body = JSON.parse(String(init.body)) as { to: string[]; from: string; html: string }
    expect(body.to).toEqual(["user@example.com"])
    expect(body.from).toBe("青幕AI写作 <no-reply@qmai.pro>")
    expect(body.html).toContain("654321")
  })

  it("非 2xx 返回失败并记录状态与错误名", async () => {
    const log = silentConsole()
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ name: "validation_error" }), { status: 422 }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const env = baseEnv({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test" })

    const result = await sendVerificationEmail(env, {
      to: "user@example.com",
      code: "111111",
      purpose: "register",
    })

    expect(result.ok).toBe(false)
    const logged = log.mock.calls.map((call) => JSON.stringify(call)).join("\n")
    expect(logged).toContain("422")
    expect(logged).toContain("validation_error")
    expect(logged).not.toContain("111111")
    expect(logged).not.toContain("re_test")
  })

  it("网络异常返回失败", async () => {
    silentConsole()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down")
      }),
    )
    const env = baseEnv({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test" })

    await expect(
      sendVerificationEmail(env, { to: "a@b.com", code: "1", purpose: "register" }),
    ).resolves.toEqual({ ok: false })
  })

  it("缺少 key 时失败关闭", async () => {
    silentConsole()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const env = baseEnv({ EMAIL_PROVIDER: "resend" })

    await expect(
      sendVerificationEmail(env, { to: "a@b.com", code: "1", purpose: "register" }),
    ).resolves.toEqual({ ok: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("没有通道时的行为", () => {
  it("生产环境失败关闭", async () => {
    silentConsole()
    await expect(sendRegisteredNotice(baseEnv(), "a@b.com")).resolves.toEqual({ ok: false })
  })

  it("开发模式且 ALLOW_DEV_CODE=true 时输出验证码并视为成功", async () => {
    const log = silentConsole()
    const env = baseEnv({ ENVIRONMENT: "development", ALLOW_DEV_CODE: "true" })

    await expect(
      sendVerificationEmail(env, { to: "dev@example.com", code: "999999", purpose: "register" }),
    ).resolves.toEqual({ ok: true })

    const logged = log.mock.calls.map((call) => JSON.stringify(call)).join("\n")
    expect(logged).toContain("999999")
  })

  it("开发模式但未开 ALLOW_DEV_CODE 时仍失败关闭", async () => {
    silentConsole()
    const env = baseEnv({ ENVIRONMENT: "development" })
    await expect(
      sendVerificationEmail(env, { to: "dev@example.com", code: "999999", purpose: "register" }),
    ).resolves.toEqual({ ok: false })
  })
})
