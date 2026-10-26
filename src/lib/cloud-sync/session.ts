/**
 * 云同步会话层：把 Tauri 命令（凭据/令牌落盘、回调监听、MD5）与
 * 百度 OAuth / xpan API 封装粘在一起，供设置界面调用。
 */

import { invoke } from "@tauri-apps/api/core"
import { fetch as tauriFetch } from "@tauri-apps/plugin-http"

import type { FetchLike, BaiduTokens } from "./baidu-oauth"
import { exchangeCodeForTokens, refreshAccessToken } from "./baidu-oauth"

/** 生产环境统一走 plugin-http（Rust 侧 reqwest，绕过 WebView CORS）。 */
export const cloudFetch: FetchLike = tauriFetch as unknown as FetchLike

export interface DevCredentials {
  appKey: string
  secretKey: string
}

interface RawCredentials {
  appKey?: unknown
  secretKey?: unknown
}

function normalizeCredentials(raw: unknown): DevCredentials | null {
  if (!raw || typeof raw !== "object") return null
  const value = raw as RawCredentials
  if (typeof value.appKey !== "string" || typeof value.secretKey !== "string") return null
  if (!value.appKey || !value.secretKey) return null
  return { appKey: value.appKey, secretKey: value.secretKey }
}

export async function saveDevCredentials(appKey: string, secretKey: string): Promise<void> {
  await invoke("cloud_sync_save_dev_credentials", { appKey, secretKey })
}

export async function loadDevCredentials(): Promise<DevCredentials | null> {
  const raw = await invoke<unknown>("cloud_sync_load_dev_credentials")
  return normalizeCredentials(raw)
}

export async function clearDevCredentials(): Promise<void> {
  await invoke("cloud_sync_clear_dev_credentials")
}

function normalizeTokens(raw: unknown): BaiduTokens | null {
  if (!raw || typeof raw !== "object") return null
  const value = raw as Partial<BaiduTokens>
  if (typeof value.accessToken !== "string" || !value.accessToken) return null
  if (typeof value.refreshToken !== "string" || typeof value.expiresAtMs !== "number") return null
  return {
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    expiresAtMs: value.expiresAtMs,
    scope: value.scope,
    baiduName: value.baiduName,
  }
}

export async function storeTokens(tokens: BaiduTokens): Promise<void> {
  await invoke("cloud_sync_store_tokens", { tokens })
}

export async function loadTokens(): Promise<BaiduTokens | null> {
  const raw = await invoke<unknown>("cloud_sync_load_tokens")
  return normalizeTokens(raw)
}

export async function clearTokens(): Promise<void> {
  await invoke("cloud_sync_clear_tokens")
}

/** content md5（xpan precreate 的 block_list 用）。 */
export async function md5HexOf(data: Uint8Array): Promise<string> {
  return invoke<string>("cloud_sync_md5_hex", { data: Array.from(data) })
}

/** 打开系统浏览器授权页，并在本机回调服务上等待 code。 */
export async function startOAuthFlow(
  openExternal: (url: string) => Promise<void>,
  /**
   * 保留这个形参是为了兼容既有调用方；实际用的是下面动态导入的
   * `buildAuthorizeUrl`。加下划线前缀表示"有意未使用"，避免 tsc 常驻报错。
   */
  _buildUrl: (appKey: string, state: string) => string,
): Promise<{ code: string; tokens: BaiduTokens }> {
  const credentials = await loadDevCredentials()
  if (!credentials) {
    throw new Error("请先填写并保存开放平台 AppKey / SecretKey")
  }
  const { randomState, buildAuthorizeUrl } = await import("./baidu-oauth")
  const state = randomState()
  // 先起监听再开浏览器，避免百度跳回早于监听就绪。
  const waiting = invoke<{ code: string }>("cloud_sync_wait_oauth_callback", {
    expectedState: state,
  })
  try {
    await openExternal(buildAuthorizeUrl(credentials.appKey, state))
  } catch (error) {
    await invoke("cloud_sync_cancel_oauth_wait").catch(() => undefined)
    throw new Error(`无法打开浏览器授权页: ${String(error)}`)
  }
  try {
    const callback = await waiting
    const tokens = await exchangeCodeForTokens(cloudFetch, {
      appKey: credentials.appKey,
      secretKey: credentials.secretKey,
      code: callback.code,
    })
    await storeTokens(tokens)
    return { code: callback.code, tokens }
  } catch (error) {
    await invoke("cloud_sync_cancel_oauth_wait").catch(() => undefined)
    throw error
  }
}

/** 取一个可用的 access_token：过期前 5 分钟自动用 refresh_token 续期。 */
export async function ensureAccessToken(): Promise<string | null> {
  const tokens = await loadTokens()
  if (!tokens) return null
  if (tokens.expiresAtMs - Date.now() > 5 * 60 * 1000) {
    return tokens.accessToken
  }
  const credentials = await loadDevCredentials()
  if (!credentials || !tokens.refreshToken) {
    throw new Error("登录状态已过期，请重新授权连接百度网盘")
  }
  const fresh = await refreshAccessToken(cloudFetch, {
    appKey: credentials.appKey,
    secretKey: credentials.secretKey,
    refreshToken: tokens.refreshToken,
  })
  await storeTokens({ ...fresh, baiduName: tokens.baiduName })
  return fresh.accessToken
}
