/**
 * 账号 Worker 的纯 HTTP 接入层。
 *
 * 本文件不碰 React、store、toast；只负责：
 * - 地址归一化与解析（localStorage 覆盖 → 构建环境变量 → 默认地址）；
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
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  SendCodeResult,
} from "./types"
import { normalizeEmail } from "./validation"

export const DEFAULT_ACCOUNT_BASE_URL = "https://qmai-account.qmai.workers.dev"
export const ACCOUNT_BASE_URL_STORAGE_KEY = "qmai.account.baseUrl.v1"

type FetchImpl = typeof fetch
type HttpMethod = "GET" | "POST"

/**
 * 默认请求函数。本身不发起网络请求，只把参数转交给 Tauri 提供的 fetch，
 * 因此模块加载时不会访问 `window` / Tauri 全局。
 */
const lazyAccountFetch: FetchImpl = async (input, init) => {
  const fetcher = await getHttpFetch()
  return fetcher(input, init)
}

/** trim、去尾部 `/`；缺少 http(s) 前缀时补 `https://`；空串回默认地址。 */
export function normalizeAccountBaseUrl(raw: string): string {
  const trimmed = typeof raw === "string" ? raw.trim() : ""
  if (!trimmed) return DEFAULT_ACCOUNT_BASE_URL

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  const stripped = withScheme.replace(/\/+$/, "")
  // `https://` / `http://` 这类只有协议没有主机的输入没有意义，回默认地址。
  return /^https?:\/\/[^/]/i.test(stripped) ? stripped : DEFAULT_ACCOUNT_BASE_URL
}

function readStoredBaseUrlOverride(): string {
  try {
    if (typeof localStorage === "undefined") return ""
    return localStorage.getItem(ACCOUNT_BASE_URL_STORAGE_KEY) ?? ""
  } catch {
    return ""
  }
}

/**
 * 解析本次请求应使用的账号服务地址：
 * localStorage 覆盖 → `VITE_QMAI_ACCOUNT_URL` → 默认地址。
 * 任何存储异常都只影响覆盖值，不阻塞登录。
 */
export function resolveAccountBaseUrl(): string {
  const stored = readStoredBaseUrlOverride()
  if (stored.trim()) return normalizeAccountBaseUrl(stored)

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
  if (status === 403) return "ACCOUNT_DISABLED"
  if (status === 409) return "EMAIL_TAKEN"
  if (status === 429) return "RATE_LIMITED"
  if (status >= 500) return "SERVER_ERROR"
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

  return { id, email, displayName, createdAt }
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

  let response: Response
  try {
    response = await options.fetchImpl(`${normalizeAccountBaseUrl(baseUrl)}${options.path}`, {
      method: options.method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    })
  } catch {
    throw new AccountApiError("NETWORK", ACCOUNT_ERROR_MESSAGES.NETWORK, 0)
  }

  let text = ""
  try {
    text = await response.text()
  } catch {
    throw new AccountApiError("NETWORK", ACCOUNT_ERROR_MESSAGES.NETWORK, 0)
  }

  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }

  const envelope = asRecord(payload)
  if (!response.ok || envelope?.success !== true) {
    throw buildAccountError(payload, response.status, options.unauthorizedCode)
  }

  return { status: response.status, data: envelope.data }
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
  })
}
