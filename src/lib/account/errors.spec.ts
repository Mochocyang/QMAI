import { describe, expect, it } from "vitest"

import {
  ACCOUNT_ERROR_FALLBACK_MESSAGE,
  ACCOUNT_ERROR_MESSAGES,
  AccountApiError,
  accountErrorMessage,
  isAccountApiError,
} from "./errors"
import type { AccountErrorCode } from "./types"

const EXPECTED_MESSAGES: Record<AccountErrorCode, string> = {
  VALIDATION: "请检查填写的内容。",
  EMAIL_TAKEN: "这个邮箱已经注册过，直接登录即可。",
  CODE_INVALID: "验证码不正确，请重新输入。",
  CODE_EXPIRED: "验证码已过期，请重新获取。",
  CODE_ATTEMPTS: "验证码尝试次数过多，请重新获取。",
  RATE_LIMITED: "操作太频繁，请稍后再试。",
  INVALID_CREDENTIALS: "邮箱或密码不正确。",
  ACCOUNT_DISABLED: "账号已被停用，请联系支持。",
  TOKEN_EXPIRED: "登录已过期，请重新登录。",
  INVALID_REFRESH: "登录已失效，请重新登录。",
  EMAIL_SEND_FAILED: "验证码邮件发送失败，请稍后重试。",
  SERVER_ERROR: "账号服务暂时不可用，请稍后再试。",
  NETWORK: "网络不可用，请检查连接后重试。",
}

describe("accountErrorMessage", () => {
  it.each(Object.entries(EXPECTED_MESSAGES) as Array<[AccountErrorCode, string]>)(`%s 使用固定中文文案`, (code, message) => {
    expect(ACCOUNT_ERROR_MESSAGES[code]).toBe(message)

    const error = new AccountApiError(code, "服务端原始文案", 400)
    expect(accountErrorMessage(error)).toBe(message)
  })

  it("NETWORK 的文案按客户端约定显示", () => {
    expect(accountErrorMessage(new AccountApiError("NETWORK", "fetch failed", 0)))
      .toBe("网络不可用，请检查连接后重试。")
  })

  it("未知错误走兜底文案，不把内部错误甩给用户", () => {
    expect(accountErrorMessage(new Error("TypeError: boom"))).toBe(ACCOUNT_ERROR_FALLBACK_MESSAGE)
    expect(accountErrorMessage(null)).toBe(ACCOUNT_ERROR_FALLBACK_MESSAGE)
    expect(accountErrorMessage("failed")).toBe(ACCOUNT_ERROR_FALLBACK_MESSAGE)
  })

  it("头像处理错误透出可操作的原始文案，不退化成兜底", () => {
    // 否则用户只看到「操作失败，请稍后重试」，不知道该换图片还是重试。
    const error = new Error("请选择图片文件。")
    error.name = "AvatarProcessError"
    expect(accountErrorMessage(error)).toBe("请选择图片文件。")
  })
})

describe("AccountApiError / isAccountApiError", () => {
  it("携带 code 与 HTTP status", () => {
    const error = new AccountApiError("INVALID_REFRESH", "登录已失效", 401)
    expect(error.name).toBe("AccountApiError")
    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe("INVALID_REFRESH")
    expect(error.status).toBe(401)
  })

  it("只把 AccountApiError 识别为账号错误", () => {
    expect(isAccountApiError(new AccountApiError("SERVER_ERROR", "x", 500))).toBe(true)
    expect(isAccountApiError(new Error("x"))).toBe(false)
    expect(isAccountApiError({ code: "SERVER_ERROR" })).toBe(false)
  })
})
