/**
 * 本地端到端冒烟（可选，不属于 vitest 套件）。
 *
 * 前置：
 *   1. 在 account-worker/.dev.vars 配置 AUTH_JWT_SECRET、AUTH_CODE_PEPPER、
 *      ENVIRONMENT=development、ALLOW_DEV_CODE=true，并覆盖本地 APP_ALLOWED_ORIGINS。
 *   2. npx wrangler d1 execute qmai-account-db --local --file=./schema.sql
 *   3. npx wrangler dev --local --port 8787
 *   4. npm run smoke
 *
 * 脚本会等待 61 秒验证发码冷却，总耗时约 1 分钟；只访问本地 8787。
 */

const BASE = process.env.ACCOUNT_BASE_URL ?? "http://127.0.0.1:8787"
const ORIGIN = "tauri://localhost"

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`)
  console.log(`ok - ${message}`)
}

async function request(path, method, body, extraHeaders = {}) {
  const headers = { Origin: ORIGIN, ...extraHeaders }
  if (body !== undefined) headers["Content-Type"] = "application/json"
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: response.status, headers: response.headers, json, text }
}

const email = `smoke-${Date.now()}@example.com`
const password = "smoke-password-123"

const preflight = await request("/v1/auth/login", "OPTIONS", undefined, {
  "Access-Control-Request-Method": "POST",
})
assert(preflight.status === 204, "OPTIONS returns 204")
assert(
  preflight.headers.get("access-control-allow-origin") === ORIGIN,
  "preflight returns allowlisted ACAO",
)
assert(
  (preflight.headers.get("access-control-allow-headers") ?? "").includes("Authorization"),
  "preflight allows Authorization header",
)

const send = await request("/v1/auth/send-code", "POST", { email, purpose: "register" })
assert(send.status === 200 && send.json?.success === true, "send-code succeeds")
assert(send.json?.data?.cooldownSeconds === 60, "send-code returns 60s cooldown")
assert(/^\d{6}$/.test(send.json?.data?.devCode ?? ""), "development returns devCode")
assert(send.headers.get("cache-control") === "no-store", "responses are no-store")
const code = send.json.data.devCode

const register = await request("/v1/auth/register", "POST", {
  email,
  code,
  password,
  displayName: "冒烟用户",
})
assert(register.status === 200 && register.json?.success === true, "register succeeds")
assert(register.json?.data?.user?.email === email, "register returns user")
assert(register.json?.data?.user?.displayName === "冒烟用户", "register keeps displayName")
assert(typeof register.json?.data?.accessToken === "string", "register returns access token")
assert(
  /^[A-Za-z0-9_-]{43}$/.test(register.json?.data?.refreshToken ?? ""),
  "register returns refresh token",
)
const firstSession = register.json.data

const me = await request("/v1/auth/me", "GET", undefined, {
  Authorization: `Bearer ${firstSession.accessToken}`,
})
assert(me.status === 200 && me.json?.data?.user?.id === firstSession.user.id, "me returns the user")

const refresh = await request("/v1/auth/refresh", "POST", {
  refreshToken: firstSession.refreshToken,
})
assert(refresh.status === 200 && refresh.json?.success === true, "refresh succeeds")
assert(refresh.json.data.refreshToken !== firstSession.refreshToken, "refresh rotates token")
assert(
  refresh.json.data.refreshExpiresAt >= firstSession.refreshExpiresAt,
  "refresh slides expiry",
)
const secondSession = refresh.json.data

const reuse = await request("/v1/auth/refresh", "POST", {
  refreshToken: firstSession.refreshToken,
})
assert(
  reuse.status === 401 && reuse.json?.code === "INVALID_REFRESH",
  "reusing old refresh is rejected",
)
const familyRevoked = await request("/v1/auth/refresh", "POST", {
  refreshToken: secondSession.refreshToken,
})
assert(
  familyRevoked.status === 401 && familyRevoked.json?.code === "INVALID_REFRESH",
  "refresh reuse revokes the whole family",
)

const login = await request("/v1/auth/login", "POST", {
  email,
  password,
  deviceLabel: "smoke",
})
assert(login.status === 200 && login.json?.success === true, "login succeeds")
const loginSession = login.json.data

const logout = await request("/v1/auth/logout", "POST", {
  refreshToken: loginSession.refreshToken,
})
assert(
  logout.status === 200 && logout.json?.success === true && logout.json?.data === null,
  "logout succeeds",
)
const logoutAgain = await request("/v1/auth/logout", "POST", {
  refreshToken: loginSession.refreshToken,
})
assert(logoutAgain.status === 200, "logout is idempotent")
const refreshAfterLogout = await request("/v1/auth/refresh", "POST", {
  refreshToken: loginSession.refreshToken,
})
assert(
  refreshAfterLogout.status === 401 && refreshAfterLogout.json?.code === "INVALID_REFRESH",
  "refresh after logout is rejected",
)

const wrongPassword = await request("/v1/auth/login", "POST", {
  email,
  password: "wrong-password",
})
assert(
  wrongPassword.status === 401 && wrongPassword.json?.code === "INVALID_CREDENTIALS",
  "wrong password is rejected",
)

const duplicateRegister = await request("/v1/auth/register", "POST", {
  email,
  code: "123456",
  password,
})
assert(
  duplicateRegister.status === 409 && duplicateRegister.json?.code === "EMAIL_TAKEN",
  "duplicate register returns EMAIL_TAKEN",
)

// 冷却期 60 秒：等待后验证 reset 用途（同邮箱仍可发码）。
await new Promise((resolve) => setTimeout(resolve, 61_000))
const resetSend = await request("/v1/auth/send-code", "POST", { email, purpose: "reset" })
assert(
  resetSend.status === 200 && /^\d{6}$/.test(resetSend.json?.data?.devCode ?? ""),
  "reset code is sent",
)

const reset = await request("/v1/auth/password/reset", "POST", {
  email,
  code: resetSend.json.data.devCode,
  password: "new-password-456",
})
assert(
  reset.status === 200 && reset.json?.success === true && reset.json?.data === null,
  "password reset succeeds",
)
const loginOldPassword = await request("/v1/auth/login", "POST", { email, password })
assert(
  loginOldPassword.status === 401 && loginOldPassword.json?.code === "INVALID_CREDENTIALS",
  "old password no longer works",
)
const loginNewPassword = await request("/v1/auth/login", "POST", {
  email,
  password: "new-password-456",
})
assert(
  loginNewPassword.status === 200 && loginNewPassword.json?.success === true,
  "new password works",
)

const oversized = await request("/v1/auth/send-code", "POST", {
  email: `${"a".repeat(8200)}@example.com`,
  purpose: "register",
})
assert(
  oversized.status === 400 && oversized.json?.code === "VALIDATION",
  "oversized body is rejected",
)

const badOrigin = await fetch(`${BASE}/v1/auth/me`, {
  headers: { Origin: "https://evil.example" },
})
assert(
  badOrigin.headers.get("access-control-allow-origin") === null,
  "non-allowlisted origin gets no ACAO",
)

console.log("SMOKE PASSED")
