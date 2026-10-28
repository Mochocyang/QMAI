/**
 * 账号模块的共享类型。
 *
 * 这里只描述客户端与账号 Worker 之间的稳定契约：
 * - 网络层用 `AccountAuthPayload` / `AccountUser`；
 * - 登录态持久化用 `StoredAccountSession`；
 * - store 与 UI 共用 `AccountStatus` / `AccountAuthMode`。
 */

export type AccountErrorCode =
  | "VALIDATION"
  | "EMAIL_TAKEN"
  | "CODE_INVALID"
  | "CODE_EXPIRED"
  | "CODE_ATTEMPTS"
  | "RATE_LIMITED"
  | "INVALID_CREDENTIALS"
  | "WRONG_PASSWORD"
  | "ACCOUNT_DISABLED"
  | "TOKEN_EXPIRED"
  | "INVALID_REFRESH"
  | "EMAIL_SEND_FAILED"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "SERVER_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "NETWORK"

export interface AccountUser {
  id: number
  email: string
  displayName: string
  createdAt: number
  /** 头像版本号（Unix 秒）；null 表示没有头像。 */
  avatarUpdatedAt: number | null
}

export interface AccountAuthPayload {
  user: AccountUser
  accessToken: string
  accessExpiresAt: number
  refreshToken: string
  refreshExpiresAt: number
}

export type AccountPurpose = "register" | "reset"
export type AccountAuthMode = "login" | "register" | "reset"
export type AccountStatus = "idle" | "booting" | "anonymous" | "authenticated"

export interface StoredAccountSession {
  baseUrl: string
  accessToken: string
  accessExpiresAt: number
  refreshToken: string
  refreshExpiresAt: number
  user: AccountUser
  /** 本地保存时间（Unix 秒）。 */
  savedAt: number
}

export interface SendCodeResult {
  cooldownSeconds: number
  devCode?: string
}

export interface LoginInput {
  email: string
  password: string
  deviceLabel?: string
}

export interface RegisterInput {
  email: string
  code: string
  password: string
  displayName?: string
}

export interface ResetPasswordInput {
  email: string
  code: string
  password: string
}

export interface ChangePasswordInput {
  currentPassword: string
  newPassword: string
}

/** 头像上传时的图片原始字节与 MIME。 */
export interface AvatarUpload {
  data: ArrayBuffer
  mime: string
}
