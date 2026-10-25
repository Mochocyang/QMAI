/**
 * 账号 Worker 的纯 HTTP 接入层。
 *
 * 本文件不碰 React、store、toast；只负责：
 * - 地址解析（构建环境变量 → 默认地址）；
 * - 统一信封解析与错误码映射；
 * - 通过注入的 fetch 发请求，便于单测替换网络。
 *
 * 默认 fetch 走 `getHttpFetch()`（Tauri plugin-http），但不会在模块加载时
 * 调用它：这里先包成一个惰性函数，调用方也可以在最后一个参数直接注入。
 */

import { getHttpFetch } from "@/lib/tauri-fetch"

import {
  ACCOUNT_ERROR_MESSAGES,
  AccountApiError,
} from "./errors"
import type {
  AccountAuthPayload,
  AccountErrorCode,
  AccountPurpose,
  AccountUser,
  AvatarUpload,
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  SendCodeResult,
} from "./types"
import { normalizeEmail } from "./validation"

export const DEFAULT_ACCOUNT_BASE_URL = "https://qmai-account.qmai.workers.dev"

/** 单次账号请求（含读响应体）的上限；超时统一映射为 NETWORK。 */
export const ACCOUNT_REQUEST_TIMEOUT_MS = 20_000

type FetchImpl = typeof fetch
type HttpMethod = "GET" | "POST" | "DELETE"

/**
 * 默认请求函数。本身不发起网络请求，只把参数转交给 Tauri 提供的 fetch，
 * 因此模块加载时不会访问 `window` / Tauri 全局。
 */
const lazyAccountFetch: FetchImpl = async (input, init) => {
  const fetcher = await getHttpFetch()
  return fetcher(input, init)
}

/**
 * 严格解析账号服务地址：只接受带 http/https 协议的绝对地址、必须有不带
 * userinfo 的主机、不允许 query/hash。返回 `null` 表示调用方应回默认地址
 * 或拒绝该会话。
 */
export function parseAccountBaseUrl(raw: string): string | null {
  const trimmed = typeof raw === "string" ? raw.trim() : ""
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  if (!url.hostname) return null
  if (url.username || url.password) return null
  if (url.search || url.hash) return null

  const pathname = url.pathname.replace(/\/+$/, "")
  return `${url.origin}${pathname}`
}

/** trim、去尾部 `/`；缺少前缀时补 `https://`；非法/空回默认地址。 */
export function normalizeAccountBaseUrl(raw: string): string {
  const trimmed = typeof raw === "string" ? raw.trim() : ""
  if (!trimmed) return DEFAULT_ACCOUNT_BASE_URL

  // 明确写了 `://` 就按原协议交给严格解析（ftp 等会被拒绝）；否则补 https。
  const withScheme = trimmed.includes("://") ? trimmed : `https://${trimmed}`
  return parseAccountBaseUrl(withScheme) ?? DEFAULT_ACCOUNT_BASE_URL
}

/**
 * 解析本次请求应使用的账号服务地址：`VITE_QMAI_ACCOUNT_URL` → 默认地址。
 * 不读 localStorage：本地覆盖若被 XSS 改写，可能把 token 送到钓鱼地址。
 */
export function resolveAccountBaseUrl(): string {
  const envUrl = import.meta.env.VITE_QMAI_ACCOUNT_URL
  if (typeof envUrl === "string" && envUrl.trim()) return normalizeAccountBaseUrl(envUrl)

  return DEFAULT_ACCOUNT_BASE_URL
}

const ACCOUNT_ERROR_CODES = new Set<string>(Object.keys(ACCOUNT_ERROR_MESSAGES))

function isAccountErrorCode(value: unknown): value is AccountErrorCode {
  return typeof value === "string" && ACCOUNT_ERROR_CODES.has(value)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function fallbackCodeForStatus(status: number, unauthorizedCode: AccountErrorCode): AccountErrorCode {
  if (status === 400) return "VALIDATION"
  if (status === 401) return unauthorizedCode
  if (status === 409) return "EMAIL_TAKEN"
  if (status === 429) return "RATE_LIMITED"
  if (status >= 500) return "SERVER_ERROR"
  // 403 只有服务端明确给出 ACCOUNT_DISABLED 才算停用；HTML/网关页兜底为服务错误。
  return "SERVER_ERROR"
}

/**
 * 信封失败时优先使用服务端 `code`；缺失/未知按 HTTP 状态兜底。
 * 401 的具体码由路径决定：登录/注册/重置是 INVALID_CREDENTIALS，
 * refresh 是 INVALID_REFRESH，me 是 TOKEN_EXPIRED。
 */
function buildAccountError(
  payload: unknown,
  status: number,
  unauthorizedCode: AccountErrorCode,
): AccountApiError {
  const record = asRecord(payload)
  const rawCode = record?.code
  const code = isAccountErrorCode(rawCode)
    ? rawCode
    : fallbackCodeForStatus(status, unauthorizedCode)

  const rawMessage = typeof record?.message === "string" ? record.message.trim() : ""
  const message = rawMessage || ACCOUNT_ERROR_MESSAGES[code]

  return new AccountApiError(code, message, status)
}

function invalidStructure(status: number): AccountApiError {
  return new AccountApiError("SERVER_ERROR", ACCOUNT_ERROR_MESSAGES.SERVER_ERROR, status)
}

function expectUser(raw: unknown, status: number): AccountUser {
  const record = asRecord(raw)
  if (!record) throw invalidStructure(status)

  const id = record.id
  const email = record.email
  const displayName = record.displayName
  const createdAt = record.createdAt

  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) throw invalidStructure(status)
  if (typeof email !== "string" || email.length === 0) throw invalidStructure(status)
  if (typeof displayName !== "string") throw invalidStructure(status)
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) throw invalidStructure(status)

  // 头像版本号可选：老服务端不返回时为 null，不视为结构错误。
  const rawAvatar = record.avatarUpdatedAt
  const avatarUpdatedAt =
    typeof rawAvatar === "number" && Number.isFinite(rawAvatar) ? rawAvatar : null

  return { id, email, displayName, createdAt, avatarUpdatedAt }
}

function expectAuthPayload(raw: unknown, status: number): AccountAuthPayload {
  const record = asRecord(raw)
  if (!record) throw invalidStructure(status)

  const user = expectUser(record.user, status)
  const { accessToken, accessExpiresAt, refreshToken, refreshExpiresAt } = record

  if (typeof accessToken !== "string" || accessToken.length === 0) throw invalidStructure(status)
  if (typeof accessExpiresAt !== "number" || !Number.isFinite(accessExpiresAt)) {
    throw invalidStructure(status)
  }
  if (typeof refreshToken !== "string" || refreshToken.length === 0) throw invalidStructure(status)
  if (typeof refreshExpiresAt !== "number" || !Number.isFinite(refreshExpiresAt)) {
    throw invalidStructure(status)
  }

  return { user, accessToken, accessExpiresAt, refreshToken, refreshExpiresAt }
}

function expectSendCodeResult(raw: unknown, status: number): SendCodeResult {
  const record = asRecord(raw)
  if (!record) throw invalidStructure(status)

  const cooldownSeconds = record.cooldownSeconds
  if (typeof cooldownSeconds !== "number" || !Number.isFinite(cooldownSeconds) || cooldownSeconds < 0) {
    throw invalidStructure(status)
  }

  if (record.devCode !== undefined && typeof record.devCode !== "string") {
    throw invalidStructure(status)
  }

  const result: SendCodeResult = { cooldownSeconds }
  if (typeof record.devCode === "string") result.devCode = record.devCode
  return result
}

interface AccountRequestOptions {
  method: HttpMethod
  path: string
  body?: Record<string, unknown>
  accessToken?: string
  unauthorizedCode: AccountErrorCode
  fetchImpl: FetchImpl
  /** void 接口（logout/reset）允许 204 或空响应体。 */
  acceptEmptySuccess?: boolean
}

interface AccountResponse {
  status: number
  data: unknown
}

async function requestAccount(
  baseUrl: string,
  options: AccountRequestOptions,
): Promise<AccountResponse> {
  const headers: Record<string, string> = { Accept: "application/json" }
  if (options.body) headers["Content-Type"] = "application/json"
  if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`

  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  // 自己计时，避免注入的 fetch 不响应 abort 时请求永远挂起。
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new AccountApiError("NETWORK", ACCOUNT_ERROR_MESSAGES.NETWORK, 0))
    }, ACCOUNT_REQUEST_TIMEOUT_MS)
  })
  // 请求先完成时 timeout 仍会到点；先挂一个 catch，避免迟到的 rejection 报警。
  void timeout.catch(() => undefined)

  try {
    let response: Response
    try {
      response = await Promise.race([
        options.fetchImpl(`${normalizeAccountBaseUrl(baseUrl)}${options.path}`, {
          method: options.method,
          headers,
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        }),
        timeout,
      ])
    } catch {
      throw new AccountApiError("NETWORK", ACCOUNT_ERROR_MESSAGES.NETWORK, 0)
    }

    let text = ""
    try {
      text = await Promise.race([response.text(), timeout])
    } catch {
      throw new AccountApiError("NETWORK", ACCOUNT_ERROR_MESSAGES.NETWORK, 0)
    }

    let payload: unknown = null
    if (text.trim()) {
      try {
        payload = JSON.parse(text)
      } catch {
        payload = null
      }
    }

    if (!response.ok) {
      throw buildAccountError(payload, response.status, options.unauthorizedCode)
    }

    // 204 / 空 body 对 logout、reset 是合法成功；有 body 则必须仍是统一信封。
    if (!text.trim()) {
      if (options.acceptEmptySuccess) return { status: response.status, data: null }
      throw buildAccountError(payload, response.status, options.unauthorizedCode)
    }

    const envelope = asRecord(payload)
    if (envelope?.success !== true) {
      throw buildAccountError(payload, response.status, options.unauthorizedCode)
    }

    return { status: response.status, data: envelope.data }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function optionalBodyField(
  body: Record<string, unknown>,
  key: string,
  value: string | undefined,
): void {
  if (value !== undefined) body[key] = value
}

export async function sendCode(
  baseUrl: string,
  email: string,
  purpose: AccountPurpose,
  fetchImpl: FetchImpl = lazyAccountFetch,
): Promise<SendCodeResult> {
  const { status, data } = await requestAccount(baseUrl, {
    method: "POST",
    path: "/v1/auth/send-code",
    body: { email: normalizeEmail(email), purpose },
    unauthorizedCode: "INVALID_CREDENTIALS",
    fetchImpl,
  })
  return expectSendCodeResult(data, status)
}

export async function registerAccount(
  baseUrl: string,
  input: RegisterInput,
  fetchImpl: FetchImpl = lazyAccountFetch,
): Promise<AccountAuthPayload> {
  const body: Record<string, unknown> = {
    email: normalizeEmail(input.email),
    code: input.code,
    password: input.password,
  }
  optionalBodyField(body, "displayName", input.displayName)

  const { status, data } = await requestAccount(baseUrl, {
    method: "POST",
    path: "/v1/auth/register",
    body,
    unauthorizedCode: "INVALID_CREDENTIALS",
    fetchImpl,
  })
  return expectAuthPayload(data, status)
}

export async function loginAccount(
  baseUrl: string,
  input: LoginInput,
  fetchImpl: FetchImpl = lazyAccountFetch,
): Promise<AccountAuthPayload> {
  const body: Record<string, unknown> = {
    email: normalizeEmail(input.email),
    password: input.password,
  }
  optionalBodyField(body, "deviceLabel", input.deviceLabel)

  const { status, data } = await requestAccount(baseUrl, {
    method: "POST",
    path: "/v1/auth/login",
    body,
    unauthorizedCode: "INVALID_CREDENTIALS",
    fetchImpl,
  })
  return expectAuthPayload(data, status)
}

export async function refreshAccountSession(
  baseUrl: string,
  refreshToken: string,
  fetchImpl: FetchImpl = lazyAccountFetch,
): Promise<AccountAuthPayload> {
  const { status, data } = await requestAccount(baseUrl, {
    method: "POST",
    path: "/v1/auth/refresh",
    body: { refreshToken },
    unauthorizedCode: "INVALID_REFRESH",
    fetchImpl,
  })
  return expectAuthPayload(data, status)
}

export async function logoutAccount(
  baseUrl: string,
  refreshToken: string,
  fetchImpl: FetchImpl = lazyAccountFetch,
): Promise<void> {
  await requestAccount(baseUrl, {
    method: "POST",
    path: "/v1/auth/logout",
    body: { refreshToken },
    unauthorizedCode: "TOKEN_EXPIRED",
    fetchImpl,
    acceptEmptySuccess: true,
  })
}

export async function fetchAccountMe(
  baseUrl: string,
  accessToken: string,
  fetchImpl: FetchImpl = lazyAccountFetch,
): Promise<AccountUser> {
  const { status, data } = await requestAccount(baseUrl, {
    method: "GET",
    path: "/v1/auth/me",
    accessToken,
    unauthorizedCode: "TOKEN_EXPIRED",
    fetchImpl,
  })

  const record = asRecord(data)
  if (!record) throw invalidStructure(status)
  return expectUser(record.user, status)
}

export async function resetAccountPassword(
  baseUrl: string,
  input: ResetPasswordInput,
  fetchImpl: FetchImpl = lazyAccountFetch,
): Promise<void> {
  await requestAccount(baseUrl, {
    method: "POST",
    path: "/v1/auth/password/reset",
    body: {
      email: normalizeEmail(input.email),
      code: input.code,
      password: input.password,
    },
    unauthorizedCode: "INVALID_CREDENTIALS",
    fetchImpl,
    acceptEmptySuccess: true,
  })
}

/**
 * 已登录改密。带上当前 refresh token，服务端据此只撤销「其它设备」，
 * 当前设备保持登录。
 */
export async function changeAccountPassword(
  baseUrl: string,
  accessToken: string,
  refreshToken: string,
  input: ChangePasswordInput,
  fetchImpl: FetchImpl = lazyAccountFetch,
): Promise<void> {
  await requestAccount(baseUrl, {
    method: "POST",
    path: "/v1/auth/password/change",
    body: {
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
      refreshToken,
    },
    accessToken,
    unauthorizedCode: "TOKEN_EXPIRED",
    fetchImpl,
    acceptEmptySuccess: true,
  })
}

/**
 * 上传头像：请求体是图片原始字节，Content-Type 直接用图片 MIME。
 * 不复用 requestAccount，因为那条路径固定发 JSON。
 */
export async function uploadAccountAvatar(
  baseUrl: string,
  accessToken: string,
  upload: AvatarUpload,
  fetchImpl: FetchImpl = lazyAccountFetch,
): Promise<AccountUser> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new AccountApiError("NETWORK", ACCOUNT_ERROR_MESSAGES.NETWORK, 0))
    }, ACCOUNT_REQUEST_TIMEOUT_MS)
  })
  void timeout.catch(() => undefined)

  try {
    let response: Response
    try {
      response = await Promise.race([
        fetchImpl(`${normalizeAccountBaseUrl(baseUrl)}/v1/account/avatar`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": upload.mime,
            Authorization: `Bearer ${accessToken}`,
          },
          body: upload.data,
          signal: controller.signal,
        }),
        timeout,
      ])
    } catch {
      throw new AccountApiError("NETWORK", ACCOUNT_ERROR_MESSAGES.NETWORK, 0)
    }

    let text = ""
    try {
      text = await Promise.race([response.text(), timeout])
    } catch {
      throw new AccountApiError("NETWORK", ACCOUNT_ERROR_MESSAGES.NETWORK, 0)
    }

    let payload: unknown = null
    if (text.trim()) {
      try {
        payload = JSON.parse(text)
      } catch {
        payload = null
      }
    }

    if (!response.ok) {
      throw buildAccountError(payload, response.status, "TOKEN_EXPIRED")
    }

    const envelope = asRecord(payload)
    if (envelope?.success !== true) {
      throw buildAccountError(payload, response.status, "TOKEN_EXPIRED")
    }
    const data = asRecord(envelope.data)
    if (!data) throw invalidStructure(response.status)
    return expectUser(data.user, response.status)
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** 删除头像；服务端幂等，没有头像也算成功。 */
export async function deleteAccountAvatar(
  baseUrl: string,
  accessToken: string,
  fetchImpl: FetchImpl = lazyAccountFetch,
): Promise<void> {
  await requestAccount(baseUrl, {
    method: "DELETE",
    path: "/v1/account/avatar",
    accessToken,
    unauthorizedCode: "TOKEN_EXPIRED",
    fetchImpl,
    acceptEmptySuccess: true,
  })
}

/** 头像展示地址：带版本号，换头像后自动换 URL，绕开浏览器缓存。 */
export function accountAvatarUrl(
  baseUrl: string,
  userId: number,
  avatarUpdatedAt: number | null,
): string | null {
  if (avatarUpdatedAt === null) return null
  if (!Number.isInteger(userId) || userId <= 0) return null
  return `${normalizeAccountBaseUrl(baseUrl)}/v1/account/avatar/${userId}?v=${avatarUpdatedAt}`
}
