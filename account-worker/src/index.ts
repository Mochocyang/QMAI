/**
 * 青幕AI写作 · 账号 Worker 入口
 *
 * 只提供 /v1/auth/*，与 analytics-worker、New API 模型网关完全独立。
 * 统一在这里做 CORS、OPTIONS、no-store、配置失败关闭和兜底错误。
 */

import {
  handleLogin,
  handleLogout,
  handleMe,
  handleRefresh,
  handleRegister,
  handleResetPassword,
  handleSendCode,
} from "./auth"
import {
  applyResponseHeaders,
  failure,
  parseAllowedOrigins,
  preflightResponse,
} from "./http"
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

    if (!handler) {
      return applyResponseHeaders(failure("NOT_FOUND"), request, allowedOrigins)
    }

    const missing = findMissingConfiguration(env)
    if (missing) {
      // 配置不完整时失败关闭，绝不带病签发 JWT / 验证码。
      console.error("[account] configuration_invalid", { variable: missing })
      return applyResponseHeaders(failure("SERVER_ERROR"), request, allowedOrigins)
    }

    try {
      const response = await handler(request, env)
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
}
