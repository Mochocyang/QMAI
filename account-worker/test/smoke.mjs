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

// 同一 IP 视为同一人：连续错误码会累计 attempts 并最终作废该码（已知假设）。
const sameIpEmail = `same-ip-${Date.now()}@example.com`
const sameIp = "203.0.113.10"
const sameIpSend = await request(
  "/v1/auth/send-code",
  "POST",
  { email: sameIpEmail, purpose: "register" },
  { "X-Forwarded-For": sameIp },
)
assert(sameIpSend.status === 200, "same-IP code is sent")
for (let i = 1; i <= 5; i += 1) {
  const wrong = await request(
    "/v1/auth/register",
    "POST",
    { email: sameIpEmail, code: "000000", password },
    { "X-Forwarded-For": sameIp },
  )
  if (i < 5) {
    assert(
      wrong.status === 400 && wrong.json?.code === "CODE_INVALID",
      `same-IP wrong code ${i} returns CODE_INVALID`,
    )
  } else {
    assert(
      wrong.status === 429 && wrong.json?.code === "CODE_ATTEMPTS",
      "same-IP fifth wrong code exhausts attempts",
    )
  }
}
const sameIpCorrect = await request(
  "/v1/auth/register",
  "POST",
  { email: sameIpEmail, code: sameIpSend.json.data.devCode, password },
  { "X-Forwarded-For": sameIp },
)
assert(
  sameIpCorrect.status === 429 && sameIpCorrect.json?.code === "CODE_ATTEMPTS",
  "same-IP correct code after exhaustion stays blocked",
)

// attempts 早检查只对同 IP 生效：码已被发码人烧掉后，外来 IP 的正确码仍可成功。
const exhaustedEmail = `exhausted-${Date.now()}@example.com`
const exhaustedOwnerIp = "203.0.113.13"
const exhaustedOtherIp = "203.0.113.14"
const exhaustedSend = await request(
  "/v1/auth/send-code",
  "POST",
  { email: exhaustedEmail, purpose: "register" },
  { "X-Forwarded-For": exhaustedOwnerIp },
)
assert(exhaustedSend.status === 200, "exhaustion scenario code is sent")
for (let i = 1; i <= 5; i += 1) {
  const wrong = await request(
    "/v1/auth/register",
    "POST",
    { email: exhaustedEmail, code: "000000", password },
    { "X-Forwarded-For": exhaustedOwnerIp },
  )
  if (i < 5) {
    assert(wrong.status === 400, `owner wrong code ${i} returns CODE_INVALID`)
  } else {
    assert(
      wrong.status === 429 && wrong.json?.code === "CODE_ATTEMPTS",
      "owner fifth wrong code exhausts attempts",
    )
  }
}
const otherIpCorrect = await request(
  "/v1/auth/register",
  "POST",
  { email: exhaustedEmail, code: exhaustedSend.json.data.devCode, password },
  { "X-Forwarded-For": exhaustedOtherIp },
)
assert(
  otherIpCorrect.status === 200 && otherIpCorrect.json?.success === true,
  "other IP can still verify a correct code after owner exhaustion",
)

// 换 IP 提交错误码不累计 attempts；用 20 次外来猜测打满全局桶后，
// 发码人本人 IP 仍应能用正确码注册（全局桶只约束外来 IP）。
const crossIpEmail = `cross-ip-${Date.now()}@example.com`
const ownerIp = "203.0.113.11"
const attackerIp = "203.0.113.12"
const crossIpSend = await request(
  "/v1/auth/send-code",
  "POST",
  { email: crossIpEmail, purpose: "register" },
  { "X-Forwarded-For": ownerIp },
)
assert(crossIpSend.status === 200, "cross-IP code is sent from owner IP")
for (let i = 1; i <= 20; i += 1) {
  const wrong = await request(
    "/v1/auth/register",
    "POST",
    { email: crossIpEmail, code: "000000", password },
    { "X-Forwarded-For": attackerIp },
  )
  assert(
    wrong.status === 400 && wrong.json?.code === "CODE_INVALID",
    `different-IP wrong code ${i} does not burn attempts`,
  )
}
const crossIpCorrect = await request(
  "/v1/auth/register",
  "POST",
  { email: crossIpEmail, code: crossIpSend.json.data.devCode, password },
  { "X-Forwarded-For": ownerIp },
)
assert(
  crossIpCorrect.status === 200 && crossIpCorrect.json?.success === true,
  "owner IP can still use its code after other-IP guesses",
)

console.log("SMOKE PASSED")
