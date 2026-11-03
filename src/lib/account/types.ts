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
  | "NAME_LOCKED"
  | "NETWORK"

export interface AccountUser {
  id: number
  email: string
  displayName: string
  createdAt: number
  /** 头像版本号（Unix 秒）；null 表示没有头像。 */
  avatarUpdatedAt: number | null
  /**
   * 头像读取用的随机 token；没有头像时可能为 null。
   *
   * 头像 URL 用它寻址而不是自增 id：后者公开可枚举，任何人能从 1 开始
   * 把全站头像拉一遍。老会话里没有这个字段，届时界面退回首字母头像。
   */
  avatarToken?: string | null
  /** 上次修改昵称的时间（Unix 秒）；从未改过为 null。 */
  displayNameUpdatedAt: number | null
}

export interface AccountAuthPayload {
  user: AccountUser
  accessToken: string
  accessExpiresAt: number
  refreshToken: string
  refreshExpiresAt: number
  /**
   * 网关卡：与本次登录的 session 绑定的**长期** EdDSA 凭证，供内置模型中转站验签。
   * 登录一次拿到，之后永久不用换；失效靠服务端吊销，不靠过期。
   * 为 null 表示账号服务没配签名私钥（登录仍成功，内置模型不可用）。
   */
  netcard?: string | null
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
  /**
   * 网关卡（内置模型凭证）。与登录态同生共死：退出登录一起清掉。
   * 老版本存的会话没有这个字段，登录后会补上。
   */
  netcard?: string | null
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
