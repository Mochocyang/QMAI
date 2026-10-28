/**
 * 账号错误的统一形状与中文映射。
 *
 * 服务端信封里的 `message` 只做兜底：界面优先按 `code` 显示固定文案，
 * 避免英文/内部错误直接出现在作者面前。
 */

import type { AccountErrorCode } from "./types"

export const ACCOUNT_ERROR_MESSAGES: Record<AccountErrorCode, string> = {
  VALIDATION: "请检查填写的内容。",
  EMAIL_TAKEN: "这个邮箱已经注册过，直接登录即可。",
  CODE_INVALID: "验证码不正确，请重新输入。",
  CODE_EXPIRED: "验证码已过期，请重新获取。",
  CODE_ATTEMPTS: "验证码尝试次数过多，请重新获取。",
  RATE_LIMITED: "操作太频繁，请稍后再试。",
  INVALID_CREDENTIALS: "邮箱或密码不正确。",
  WRONG_PASSWORD: "当前密码不正确。",
  ACCOUNT_DISABLED: "账号已被停用，请联系支持。",
  TOKEN_EXPIRED: "登录已过期，请重新登录。",
  INVALID_REFRESH: "登录已失效，请重新登录。",
  EMAIL_SEND_FAILED: "验证码邮件发送失败，请稍后重试。",
  PAYLOAD_TOO_LARGE: "文件太大，请选择更小的图片。",
  UNSUPPORTED_MEDIA_TYPE: "仅支持 PNG、JPEG 或 WebP 图片。",
  SERVER_ERROR: "账号服务暂时不可用，请稍后再试。",
  NOT_FOUND: "接口不存在。",
  CONFLICT: "云端配置已被其它设备更新，请先拉取最新版本。",
  NETWORK: "网络不可用，请检查连接后重试。",
}

export const ACCOUNT_ERROR_FALLBACK_MESSAGE = "操作失败，请稍后重试。"

export class AccountApiError extends Error {
  readonly code: AccountErrorCode
  readonly status: number

  constructor(
    code: AccountErrorCode,
    message: string = ACCOUNT_ERROR_MESSAGES[code],
    status = 0,
  ) {
    super(message)
    this.name = "AccountApiError"
    this.code = code
    this.status = status
  }
}

export function isAccountApiError(error: unknown): error is AccountApiError {
  return error instanceof AccountApiError
}

/** 已知错误码用固定中文文案；未知错误不暴露内部信息。 */
export function accountErrorMessage(error: unknown): string {
  if (!isAccountApiError(error)) {
    // 本地处理类错误（如头像裁剪失败）自带面向用户的文案，直接透出，
    // 否则用户只会看到「操作失败，请稍后重试」，无法判断该换图片还是重试。
    if (
      error instanceof Error &&
      error.name === "AvatarProcessError" &&
      error.message
    ) {
      return error.message
    }
    return ACCOUNT_ERROR_FALLBACK_MESSAGE
  }
  return ACCOUNT_ERROR_MESSAGES[error.code] ?? ACCOUNT_ERROR_FALLBACK_MESSAGE
}
