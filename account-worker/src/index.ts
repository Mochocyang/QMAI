/**
 * 青幕AI写作 · 账号 Worker 入口
 *
 * 只提供 /v1/auth/*，与 analytics-worker、New API 模型网关完全独立。
 * 统一在这里做 CORS、OPTIONS、no-store、配置失败关闭和兜底错误。
 */

import {
  handleChangePassword,
  handleDeleteAvatar,
  handleGetAvatar,
  handleLogin,
  handleLogout,
  handleMe,
  handleRefresh,
  handleRegister,
  handleResetPassword,
  handleSendCode,
  handleUploadAvatar,
} from "./auth"
import {
  applyResponseHeaders,
  failure,
  parseAllowedOrigins,
  preflightResponse,
} from "./http"
import { cleanupExpiredData } from "./db"
import { hashRefreshToken } from "./crypto"
import { handleIssueNetCard, handleVerifyNetCard } from "./netcard-handler"
import type { Env } from "./types"

type RouteHandler = (request: Request, env: Env) => Promise<Response>

const ROUTES: Record<string, RouteHandler> = {
  "POST /v1/auth/send-code": handleSendCode,
  "POST /v1/auth/register": handleRegister,
  "POST /v1/auth/login": handleLogin,
  "POST /v1/auth/refresh": handleRefresh,
  "POST /v1/auth/logout": handleLogout,
  "GET /v1/auth/me": handleMe,
  "POST /v1/auth/password/reset": handleResetPassword,
  "POST /v1/auth/password/change": handleChangePassword,
  "POST /v1/account/avatar": handleUploadAvatar,
  "DELETE /v1/account/avatar": handleDeleteAvatar,
  // 网关卡：与 session 绑定的**长期**凭证，供自建中转站验签（推荐路径）。
  "POST /v1/netcard": handleIssueNetCardRoute,
  // 吊销回源：中转站需要"立刻踢人"时来问一次。
  "POST /v1/netcard/verify": handleVerifyNetCardRoute,
}

/** 网关卡签发：把登录态换成与 session 绑定的长期 Ed25519 凭证。 */
async function handleIssueNetCardRoute(request: Request, env: Env): Promise<Response> {
  return handleIssueNetCard(request, env, Math.floor(Date.now() / 1000))
}

/** 网关卡回源校验：给中转站查吊销用。 */
async function handleVerifyNetCardRoute(request: Request, env: Env): Promise<Response> {
  return handleVerifyNetCard(request, env, Math.floor(Date.now() / 1000))
}

/** 头像读取是公开路径：`/v1/account/avatar/{userId}`。 */
const AVATAR_PATH = /^\/v1\/account\/avatar\/([1-9][0-9]{0,17})$/

/**
 * 改密需要知道「当前设备」的 refresh token 哈希，才能只撤销其它设备。
 * refresh token 放在请求体里（不放进 URL，避免进日志/历史）。
 */
async function handleChangePasswordRoute(request: Request, env: Env): Promise<Response> {
  const cloned = request.clone()
  let keepTokenHash: string | null = null
  try {
    const body = (await cloned.json()) as { refreshToken?: unknown }
    if (typeof body?.refreshToken === "string" && body.refreshToken.length === 43) {
      keepTokenHash = await hashRefreshToken(body.refreshToken)
    }
  } catch {
    // 读不出来就退化成撤销全部会话，安全侧默认。
    keepTokenHash = null
  }
  return handleChangePassword(request, env, Math.floor(Date.now() / 1000), keepTokenHash)
}

const MIN_JWT_SECRET_BYTES = 32
const MIN_CODE_PEPPER_BYTES = 16

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

/** 返回第一个缺失/过短的配置项名称；不打印任何 secret 值。 */
function findMissingConfiguration(env: Env): string | null {
  if (!env.AUTH_JWT_SECRET || byteLength(env.AUTH_JWT_SECRET) < MIN_JWT_SECRET_BYTES) {
    return "AUTH_JWT_SECRET"
  }
  if (!env.AUTH_CODE_PEPPER || byteLength(env.AUTH_CODE_PEPPER) < MIN_CODE_PEPPER_BYTES) {
    return "AUTH_CODE_PEPPER"
  }
  return null
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const allowedOrigins = parseAllowedOrigins(env.APP_ALLOWED_ORIGINS)

    if (request.method === "OPTIONS") {
      return preflightResponse(request, allowedOrigins)
    }

    const path = new URL(request.url).pathname
    const handler = ROUTES[`${request.method} ${path}`]

    // 头像读取走路径参数，单独匹配。
    const avatarMatch = request.method === "GET" ? AVATAR_PATH.exec(path) : null

    if (!handler && !avatarMatch) {
      return applyResponseHeaders(failure("NOT_FOUND"), request, allowedOrigins)
    }

    const missing = findMissingConfiguration(env)
    if (missing) {
      // 配置不完整时失败关闭，绝不带病签发 JWT / 验证码。
      console.error("[account] configuration_invalid", { variable: missing })
      return applyResponseHeaders(failure("SERVER_ERROR"), request, allowedOrigins)
    }

    try {
      const response = avatarMatch
        ? await handleGetAvatar(request, env, Number(avatarMatch[1]))
        : await (path === "/v1/auth/password/change" && request.method === "POST"
            ? handleChangePasswordRoute(request, env)
            : handler!(request, env))
      return applyResponseHeaders(response, request, allowedOrigins)
    } catch (error) {
      // 只记录错误类型与路由，不记录请求体、密码、验证码或 token。
      console.error("[account] unhandled_error", {
        path,
        name: error instanceof Error ? error.name : "UnknownError",
      })
      return applyResponseHeaders(failure("SERVER_ERROR"), request, allowedOrigins)
    }
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    try {
      const counts = await cleanupExpiredData(env.DB, now)
      console.log("[account] cleanup_done", counts)
    } catch (error) {
      console.error("[account] cleanup_failed", {
        name: error instanceof Error ? error.name : "UnknownError",
      })
    }
  },
}
