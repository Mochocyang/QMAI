/**
 * 封号 / 解封 + 网关卡回源校验的账号状态判定。
 *
 * ## 为什么必须有这组测试
 *
 * `users.status` 从建表起就存在，`authenticate()` 也一直在按它拦人，但
 * **此前没有任何写入路径**：条款 4.4 承诺「可封禁账号」，实际封不了 ——
 * 管理员只能吊销会话，用户重新登录立刻复活。这是「承诺大于实现」的典型。
 *
 * 同样，`/v1/netcard/verify` 原来只查 sessions，不看账号状态：封号后
 * 已经签出去的长期卡（10 年有效）照样通过校验，等于「封了号还能用额度」。
 *
 * 这组用例锁住三件事：
 *   1. 封号真的写进 users.status，并连带吊销该用户全部会话；
 *   2. 解封只改状态，不复活旧设备上的登录态；
 *   3. verify 在账号非 active 时拒绝，且不再回吐 userId。
 */

import { describe, expect, it } from "vitest"

import { handleAdminSetUserStatus } from "../src/admin"
import { handleVerifyNetCard } from "../src/netcard-handler"
import type { Env } from "../src/types"

const NOW = 1_800_000_000

interface StoredUser {
  id: number
  email: string
  status: string
}

interface Fixture {
  /** 按 email 或 id 查到的用户。 */
  users?: StoredUser[]
  /** verify 返回的会话行（null = 不存在）。 */
  sessionRow?: { id: string; revoked_at: number | null; expires_at: number; user_status: string | null } | null
  /** 撤销会话时报告影响了几行。 */
  revokedSessionChanges?: number
}

/** 记录执行过的 SQL；按语句内容返回预置结果。 */
function fakeDb(fixture: Fixture = {}) {
  const statements: { sql: string; params: unknown[] }[] = []

  const db = {
    prepare(sql: string) {
      const entry = { sql, params: [] as unknown[] }
      statements.push(entry)
      const runner = {
        bind(...params: unknown[]) {
          entry.params = params
          return {
            async run() {
              if (/UPDATE users SET status/.test(sql)) return { meta: { changes: 1 } }
              if (/UPDATE sessions SET revoked_at/.test(sql)) {
                return { meta: { changes: fixture.revokedSessionChanges ?? 2 } }
              }
              if (/INSERT INTO revoke_audit/.test(sql)) return { meta: { changes: 1 } }
              if (/INSERT INTO rate_limits/.test(sql)) return { meta: { changes: 1 } }
              return { meta: { changes: 0 } }
            },
            async first() {
              // 限流桶：没有记录 = 未超限。
              if (/FROM rate_limits/.test(sql)) return null
              // UPSERT 限额：返回一个远低于上限的计数。
              if (/INSERT INTO rate_limits[\s\S]*RETURNING/.test(sql)) {
                return { window_start: NOW, count: 1 }
              }
              if (/FROM users WHERE email/.test(sql)) {
                const email = String(params[0] ?? "")
                return fixture.users?.find((u) => u.email === email) ?? null
              }
              if (/FROM users WHERE id/.test(sql)) {
                const id = Number(params[0])
                return fixture.users?.find((u) => u.id === id) ?? null
              }
              if (/FROM sessions s/.test(sql)) return fixture.sessionRow ?? null
              return null
            },
          }
        },
        async first() {
          // 少数调用不 bind 就直接 first（本文件里没有），保底返回 null。
          return null
        },
        async run() {
          return { meta: { changes: 0 } }
        },
      }
      return runner
    },
  }

  return { db: db as never, statements }
}

function envWith(db: unknown, overrides: Partial<Env> = {}): Env {
  return {
    DB: db,
    ADMIN_KEY: "admin-secret-key",
    AUTH_CODE_PEPPER: "pepper-for-tests",
    ENVIRONMENT: "production",
    ...overrides,
  } as Env
}

function adminRequest(body: unknown, key = "admin-secret-key"): Request {
  return new Request("https://account.test/admin/users/status", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-key": key, "CF-Connecting-IP": "203.0.113.7" },
    body: JSON.stringify(body),
  })
}

function verifyRequest(sessionId: string): Request {
  return new Request("https://account.test/v1/netcard/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7" },
    body: JSON.stringify({ sessionId }),
  })
}

describe("POST /admin/users/status", () => {
  it("封号：写 users.status，并连带吊销该用户全部会话", async () => {
    const { db, statements } = fakeDb({ users: [{ id: 42, email: "bad@example.com", status: "active" }] })

    const response = await handleAdminSetUserStatus(adminRequest({ userId: 42, status: "disabled" }), envWith(db))
    const payload = (await response.json()) as { success: boolean; data: { revokedSessions: number } }

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)

    const sqls = statements.map((s) => s.sql)
    expect(sqls.some((sql) => /UPDATE users SET status/.test(sql))).toBe(true)
    expect(sqls.some((sql) => /UPDATE sessions SET revoked_at/.test(sql))).toBe(true)

    // 参数顺序：status 是第二个（?2），用户 id 是第一个。
    const statusUpdate = statements.find((s) => /UPDATE users SET status/.test(s.sql))
    expect(statusUpdate?.params[0]).toBe(42)
    expect(statusUpdate?.params[1]).toBe("disabled")

    // 审计必须留痕，且记下连带吊销了几条会话。
    const audit = statements.find((s) => /INSERT INTO revoke_audit/.test(s.sql))
    expect(audit, "封号必须写审计").toBeTruthy()
    expect(audit?.params[0]).toBe("user_status")
    expect(payload.data.revokedSessions).toBe(2)
  })

  it("解封：只改状态，不复活旧设备上的登录态", async () => {
    const { db, statements } = fakeDb({ users: [{ id: 42, email: "bad@example.com", status: "disabled" }] })

    const response = await handleAdminSetUserStatus(adminRequest({ userId: 42, status: "active" }), envWith(db))

    expect(response.status).toBe(200)
    const sqls = statements.map((s) => s.sql)
    expect(sqls.some((sql) => /UPDATE users SET status/.test(sql))).toBe(true)
    // 解封不该去动 sessions：否则旧设备上的失效登录态会被"复活"。
    expect(sqls.some((sql) => /UPDATE sessions SET revoked_at/.test(sql))).toBe(false)
  })

  it("可以用 email 指定账号", async () => {
    const { db, statements } = fakeDb({ users: [{ id: 7, email: "by-email@example.com", status: "active" }] })

    const response = await handleAdminSetUserStatus(
      adminRequest({ email: "By-Email@Example.com", status: "disabled" }),
      envWith(db),
    )

    expect(response.status).toBe(200)
    const statusUpdate = statements.find((s) => /UPDATE users SET status/.test(s.sql))
    expect(statusUpdate?.params[0]).toBe(7)
  })

  it("status 不合法直接 400，不写库", async () => {
    const { db, statements } = fakeDb({ users: [{ id: 42, email: "x@example.com", status: "active" }] })

    const response = await handleAdminSetUserStatus(adminRequest({ userId: 42, status: "banned" }), envWith(db))

    expect(response.status).toBe(400)
    expect(statements.some((s) => /UPDATE users SET status/.test(s.sql))).toBe(false)
  })

  it("邮箱不存在时 404", async () => {
    const { db } = fakeDb({ users: [] })

    const response = await handleAdminSetUserStatus(adminRequest({ email: "nobody@example.com", status: "disabled" }), envWith(db))

    expect(response.status).toBe(404)
  })

  it("管理密钥错误时 401，且不写库", async () => {
    const { db, statements } = fakeDb({ users: [{ id: 42, email: "x@example.com", status: "active" }] })

    const response = await handleAdminSetUserStatus(adminRequest({ userId: 42, status: "disabled" }, "wrong-key"), envWith(db))

    expect(response.status).toBe(401)
    expect(statements.some((s) => /UPDATE users SET status/.test(s.sql))).toBe(false)
  })
})

describe("POST /v1/netcard/verify 的账号状态判定", () => {
  it("账号被封禁：卡立即失效（此前只查 sessions，封了号还能用额度）", async () => {
    const { db } = fakeDb({
      sessionRow: { id: "sid-1", revoked_at: null, expires_at: NOW + 1000, user_status: "disabled" },
    })

    const response = await handleVerifyNetCard(verifyRequest("sid-1"), envWith(db), NOW)
    const payload = (await response.json()) as { data: { valid: boolean; reason?: string } }

    expect(payload.data.valid).toBe(false)
    expect(payload.data.reason).toBe("account_disabled")
  })

  it("账号已不存在（LEFT JOIN 未命中）：同样拒绝", async () => {
    const { db } = fakeDb({
      sessionRow: { id: "sid-1", revoked_at: null, expires_at: NOW + 1000, user_status: null },
    })

    const response = await handleVerifyNetCard(verifyRequest("sid-1"), envWith(db), NOW)
    const payload = (await response.json()) as { data: { valid: boolean; reason?: string } }

    expect(payload.data.valid).toBe(false)
    expect(payload.data.reason).toBe("account_disabled")
  })

  it("正常账号：有效，且响应里不再出现 userId（匿名端点不该回吐身份）", async () => {
    const { db } = fakeDb({
      sessionRow: { id: "sid-1", revoked_at: null, expires_at: NOW + 1000, user_status: "active" },
    })

    const response = await handleVerifyNetCard(verifyRequest("sid-1"), envWith(db), NOW)
    const raw = await response.text()
    const payload = JSON.parse(raw) as { data: Record<string, unknown> }

    expect(payload.data.valid).toBe(true)
    expect(raw).not.toContain("userId")
    expect(payload.data).not.toHaveProperty("userId")
  })

  it("已吊销的会话仍然是 revoked（原有语义不变）", async () => {
    const { db } = fakeDb({
      sessionRow: { id: "sid-1", revoked_at: NOW - 5, expires_at: NOW + 1000, user_status: "active" },
    })

    const response = await handleVerifyNetCard(verifyRequest("sid-1"), envWith(db), NOW)
    const payload = (await response.json()) as { data: { valid: boolean; reason?: string } }

    expect(payload.data.valid).toBe(false)
    expect(payload.data.reason).toBe("revoked")
  })
})
