/**
 * 账号 Worker 的公共类型与 D1 行结构。
 * 时间一律是 Unix 秒；对外只暴露 PublicUser。
 */

export interface Env {
  DB: D1Database
  /** HS256 签名密钥，至少 32 字节；缺失时 Worker 失败关闭。 */
  AUTH_JWT_SECRET?: string
  /** 验证码 / IP 哈希 pepper，至少 16 字节；缺失时 Worker 失败关闭。 */
  AUTH_CODE_PEPPER?: string
  /**
   * 发信通道：`cloudflare`（send_email 绑定）或 `resend`（HTTP API）。
   * 留空时按可用凭据自动推断。
   */
  EMAIL_PROVIDER?: string
  /** Cloudflare Workers send_email 绑定；仅在 EMAIL_PROVIDER=cloudflare 时使用。 */
  EMAIL?: SendEmailBinding
  /** Resend API key；仅在 EMAIL_PROVIDER=resend 时使用。 */
  RESEND_API_KEY?: string
  /** 发件人，支持 `"显示名 <a@b.com>"` 或纯地址。 */
  AUTH_EMAIL_FROM?: string
  APP_ALLOWED_ORIGINS?: string
  ENVIRONMENT?: string
  PASSWORD_ITERATIONS?: string
  ALLOW_DEV_CODE?: string
  /**
   * 百度网盘开放平台的 AppKey（即 OAuth 的 client_id）。
   *
   * AppKey 是公开标识，放在 vars 里没问题；真正敏感的 AppSecret 必须走
   * `wrangler secret put BAIDU_APP_SECRET`，绝不出现在仓库与 wrangler.toml。
   */
  BAIDU_APP_KEY?: string
  /** 百度网盘开放平台的 SecretKey（client_secret）。只能存在于 Worker secret。 */
  BAIDU_APP_SECRET?: string
  /**
   * 授权回调地址，必须与百度开放平台【安全设置】里配置的完全一致。
   * 抽成变量是因为本地调试要走 ngrok/自定义域名，硬编码会让两处漂移。
   */
  BAIDU_REDIRECT_URI?: string
  /**
   * 授权模式：`general`（默认，通用授权 basic,netdisk）
   * 或 `dir`（目录级授权 nd_open_read,nd_open_write）。
   *
   * 两种模式的端点/scope/换 token 方式都不同，参数不能混用。
   * 目录级授权需要应用先获得 nd_* 权限，否则授权页打不开。
   */
  BAIDU_AUTH_MODE?: string

  /** 一台设备最多绑定的账号数，默认 3。 */
  MAX_ACCOUNTS_PER_DEVICE?: string
  /**
   * 网关卡签名私钥（Ed25519，PKCS#8 base64）。
   * 只存在于 Worker secret：`wrangler secret put NETCARD_PRIVATE_KEY`。
   * 对应公钥配到自建中转站与账号服务自身的 `NETCARD_PUBLIC_KEY`。
   * 缺失时登录仍成功，但不下发网关卡（内置模型不可用）。
   */
  NETCARD_PRIVATE_KEY?: string
  /**
   * 管理接口密钥（/admin/*）。只存在于 Worker secret：`wrangler secret put ADMIN_KEY`。
   * 未配置时所有 /admin/* 返回 503（失败关闭）—— 宁可没有管理功能，也不开一个没锁的门。
   */
  ADMIN_KEY?: string
}

export type CodePurpose = "register" | "reset"

/** 只声明用到的 send_email 绑定形状，避免把 Workers 运行时类型带进单测。 */
export interface SendEmailBinding {
  send(message: {
    to: string | { email: string; name?: string } | Array<string | { email: string; name?: string }>
    from: string | { email: string; name?: string }
    subject: string
    html?: string
    text?: string
  }): Promise<{ messageId: string }>
}

export interface UserRow {
  id: number
  email: string
  display_name: string
  password_hash: string
  status: string
  created_at: number
  updated_at: number
  avatar_mime: string | null
  avatar_data: ArrayBuffer | Uint8Array | null
  avatar_updated_at: number | null
  /** 上次修改昵称的时间（Unix 秒）；NULL 表示从未改过。 */
  display_name_updated_at: number | null
}

export interface EmailCodeRow {
  id: number
  email: string
  purpose: string
  code_hash: string
  created_at: number
  expires_at: number
  attempts: number
  consumed_at: number | null
  request_ip_hash: string | null
}

export interface SessionRow {
  id: string
  user_id: number
  family_id: string
  token_hash: string
  previous_token_hash: string | null
  device_label: string | null
  device_id: string | null
  created_at: number
  last_used_at: number
  expires_at: number
  revoked_at: number | null
}

export interface PublicUser {
  id: number
  email: string
  displayName: string
  createdAt: number
  /**
   * 头像版本号（Unix 秒）；无头像为 null。
   * 客户端据此拼 `/v1/account/avatar/{id}?v=…`，换头像后 URL 变化即可破缓存。
   */
  avatarUpdatedAt: number | null
  /**
   * 上次修改昵称的时间（Unix 秒）；从未改过为 null。
   * 客户端据此显示「下次可修改时间」，服务端才是真正的每月一次限制。
   */
  displayNameUpdatedAt: number | null
}

export interface AuthPayload {
  user: PublicUser
  accessToken: string
  accessExpiresAt: number
  refreshToken: string
  refreshExpiresAt: number
  /**
   * 网关卡：与该 session 绑定的**长期** EdDSA 凭证，供自建中转站验签。
   * 缺失（null）表示账号服务没配签名私钥 —— 登录本身仍然成功。
   */
  netcard?: string | null
}

export interface AccessTokenClaims {
  iss: string
  sub: string
  email: string
  iat: number
  exp: number
  jti: string
}

export type ApiErrorCode =
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
  | "DEVICE_LIMIT"
