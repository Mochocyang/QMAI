/**
 * 管理接口的失败限流。
 *
 * ## 为什么需要
 *
 * `/admin/*` 此前只有常数时间比较、没有任何限流：ADMIN_KEY 短的话可以无限
 * 试错。而它一旦被猜中，攻击者能吊销全站会话、还能列出所有用户邮箱——
 * 是这套系统里权限最高的一把钥匙。
 *
 * 这组用例锁住：
 *   1. 错误密钥累计到上限后，即使这次密钥是对的也直接 429（窗口内一律拒绝）；
 *   2. 正常请求（密钥正确）不消耗失败额度，运维不会被自己锁在门外；
 *   3. 5 个 admin 端点共用同一个桶，换端点绕不过去。
 */

import { describe, expect, it } from "vitest"

import { guardAdmin, handleAdminListSessions, handleAdminRevokeAudit } from "../src/admin"
import type { Env } from "../src/types"

const NOW = 1_800_000_000
const IP = "203.0.113.9"

/** 有状态的 rate_limits 内存表，够模拟「同一 IP 累计失败」。 */
function rateLimitDb() {
  const buckets = new Map<string, { windowStart: number; count: number }>()
  const statements: string[] = []

  const db = {
    prepare(sql: string) {
      statements.push(sql)
      const api = (params: unknown[]) => ({
        async first() {
          if (/FROM rate_limits/.test(sql)) {
            const row = buckets.get(String(params[0]))
            return row ? { window_start: row.windowStart, count: row.count } : null
          }
          if (/INSERT INTO rate_limits[\s\S]*RETURNING/.test(sql)) {
            const bucket = String(params[0])
            const now = Number(params[1])
            const windowSeconds = Number(params[2])
            const existing = buckets.get(bucket)
            const inWindow = existing && existing.windowStart <= now && now < existing.windowStart + windowSeconds
            const next = inWindow
              ? { windowStart: existing.windowStart, count: existing.count + 1 }
              : { windowStart: now, count: 1 }
            buckets.set(bucket, next)
            return { window_start: next.windowStart, count: next.count }
          }
          // /admin/users 列表查询：返回空集。
          if (/FROM sessions s/.test(sql)) return null
          if (/FROM revoke_audit/.test(sql)) return null
          return null
        },
        async run() {
          return { meta: { changes: 0 } }
        },
        async all() {
          return { results: [] }
        },
      })
      return {
        bind: (...params: unknown[]) => api(params),
        ...api([]),
      }
    },
    async batch() {
      return []
    },
  }

  return { db: db as never, buckets }
}

function makeEnv(db: unknown): Env {
  return {
    DB: db,
    ADMIN_KEY: "the-real-admin-key",
    AUTH_CODE_PEPPER: "pepper",
    ENVIRONMENT: "production",
  } as Env
}

function req(key: string, path = "/admin/sessions"): Request {
  return new Request(`https://account.test${path}`, {
    method: "GET",
    headers: { "x-admin-key": key, "CF-Connecting-IP": IP },
  })
}

describe("admin 失败限流", () => {
  it("连续 10 次错误密钥后，第 11 次即使密钥正确也被 429", async () => {
    const { db } = rateLimitDb()
    const env = makeEnv(db)

    // 前 10 次：错误密钥，回 401。
    for (let i = 0; i < 10; i += 1) {
      const denied = await guardAdmin(req("wrong-key"), env, NOW)
      expect(denied?.status, `第 ${i + 1} 次应是 401`).toBe(401)
    }

    // 第 11 次：密钥是对的，但窗口内失败次数已满 → 一律拒绝。
    const denied = await guardAdmin(req("the-real-admin-key"), env, NOW)
    expect(denied?.status).toBe(429)
    expect(denied?.headers.get("Retry-After")).toBeTruthy()
  })

  it("密钥正确时不消耗失败额度（正常运维不会被自己锁住）", async () => {
    const { db, buckets } = rateLimitDb()
    const env = makeEnv(db)

    for (let i = 0; i < 30; i += 1) {
      expect(await guardAdmin(req("the-real-admin-key"), env, NOW)).toBeNull()
    }

    // 桶里要么不存在，要么计数为 0：成功请求不写失败桶。
    const bucket = [...buckets.values()][0]
    expect(bucket?.count ?? 0).toBe(0)
  })

  it("窗口滑过后恢复：失败桶按窗口重置", async () => {
    const { db } = rateLimitDb()
    const env = makeEnv(db)

    for (let i = 0; i < 10; i += 1) await guardAdmin(req("wrong-key"), env, NOW)
    expect((await guardAdmin(req("wrong-key"), env, NOW))?.status).toBe(429)

    // 15 分钟后再试：新窗口，可以继续（错误密钥回 401 而不是 429）。
    const later = NOW + 16 * 60
    expect((await guardAdmin(req("wrong-key"), env, later))?.status).toBe(401)
  })

  it("所有 admin 端点共用同一个失败桶：换端点绕不过去", async () => {
    const { db } = rateLimitDb()
    const env = makeEnv(db)

    for (let i = 0; i < 10; i += 1) await guardAdmin(req("wrong-key", "/admin/sessions"), env, NOW)

    // 换到另一个端点，仍然被拦。
    const denied = await guardAdmin(req("wrong-key", "/admin/revoke-audit"), env, NOW)
    expect(denied?.status).toBe(429)
  })

  it("handler 内部也走 guardAdmin：直接调用 handler 同样受限流", async () => {
    const { db } = rateLimitDb()
    const env = makeEnv(db)

    for (let i = 0; i < 10; i += 1) await handleAdminListSessions(req("wrong-key"), env, new URL("https://account.test/admin/sessions"))

    const response = await handleAdminRevokeAudit(
      req("the-real-admin-key", "/admin/revoke-audit"),
      env,
      new URL("https://account.test/admin/revoke-audit"),
    )
    expect(response.status).toBe(429)
  })
})
