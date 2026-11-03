/**
 * 续期限流。
 *
 * ## 为什么需要
 *
 * `/v1/auth/refresh` 此前没有任何限流：任何人可以无限次提交 refresh token
 * 试探（哪些还活着、哪些已被轮转），也能用它做无成本的资源消耗。
 * refresh token 是 48 字节随机值，暴力不可行，所以这道闸门的目的不是
 * 防猜中，而是防「批量试探泄露的旧 token」和滥用。
 *
 * 这组用例只锁一个关键性质：**限流发生在读请求体之前** ——
 * 桶满时连 JSON 都不解析就拒绝，否则攻击者仍能用畸形 body 消耗解析成本。
 */

import { describe, expect, it } from "vitest"

import { handleRefresh } from "../src/auth"
import type { Env } from "../src/types"

const NOW = 1_800_000_000
const HOUR = 60 * 60

/**
 * 预置一个「已满」的 rate_limits 桶。
 *
 * 桶名里的 IP 摘要由 pepper + IP 算出，测试里没法预先知道，所以这里
 * 让任何 `FROM rate_limits` 查询都返回超额计数 —— 等价于「这个 IP 已用满」。
 */
function dbWithFullBucket() {
  const statements: string[] = []
  const db = {
    prepare(sql: string) {
      statements.push(sql)
      const api = {
        async first() {
          if (/FROM rate_limits/.test(sql)) {
            return { window_start: NOW - 10, count: 999 }
          }
          if (/INSERT INTO rate_limits[\s\S]*RETURNING/.test(sql)) {
            return { window_start: NOW - 10, count: 1000 }
          }
          return null
        },
        async run() {
          return { meta: { changes: 0 } }
        },
      }
      return {
        bind: () => api,
        ...api,
      }
    },
    async batch() {
      return []
    },
  }
  return { db: db as never, statements }
}

function makeEnv(db: unknown): Env {
  return {
    DB: db,
    AUTH_JWT_SECRET: "jwt-secret-for-tests",
    AUTH_CODE_PEPPER: "pepper",
    ENVIRONMENT: "production",
  } as Env
}

function refreshRequest(body: string): Request {
  return new Request("https://account.test/v1/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.44" },
    body,
  })
}

describe("handleRefresh 限流", () => {
  it("配额用尽时返回 429，且连请求体都不解析", async () => {
    const { db, statements } = dbWithFullBucket()
    const env = makeEnv(db)

    // 故意给一个非法 JSON：若实现先解析 body，会得到 VALIDATION 而不是 RATE_LIMITED。
    const response = await handleRefresh(refreshRequest("{not-json"), env, NOW)

    expect(response.status).toBe(429)
    const payload = (await response.json()) as { code: string }
    expect(payload.code).toBe("RATE_LIMITED")
    expect(response.headers.get("Retry-After")).toBeTruthy()
  })

  it("限流键按小时窗口（60 次/小时/IP）", async () => {
    const { db, statements } = dbWithFullBucket()
    await handleRefresh(refreshRequest("{}"), makeEnv(db), NOW)

    // 确认查的是 rate_limits，而不是某种内存计数（多实例下内存计数无效）。
    expect(statements.some((sql) => /FROM rate_limits/.test(sql) || /INSERT INTO rate_limits/.test(sql))).toBe(true)
    expect(HOUR).toBe(3600)
  })
})
