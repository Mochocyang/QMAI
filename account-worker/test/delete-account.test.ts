import { describe, expect, it } from "vitest"

import { deleteUserAccount } from "../src/db"

/**
 * 账号注销的数据清除。
 *
 * 这组用例锁住「注销必须删干净」这条底线。它比任何免责条款都重要：
 * 只要有一个表漏删，条款里「注销后删除全部个人信息」的承诺就是假的，
 * 那属于对用户权利的实质虚假陈述，比免责写得不严谨风险大得多。
 *
 * 另外锁住两件事：
 * 1. 子表必须先于 users 删除（外键约束），顺序错了整个 batch 会失败；
 * 2. revoke_audit 不能被删——它是「删除权已行使」的审计证据。
 */

/** 记录 batch 里执行过的 SQL，用来断言顺序与范围。 */
function fakeDb() {
  const statements: { sql: string; params: unknown[] }[] = []
  const db = {
    prepare(sql: string) {
      const entry = { sql, params: [] as unknown[] }
      statements.push(entry)
      return {
        bind(...params: unknown[]) {
          entry.params = params
          return {
            async run() {
              return { meta: { changes: 1 } }
            },
          }
        },
      }
    },
    async batch(list: unknown[]) {
      return list
    },
  }
  return { db: db as never, statements }
}

describe("deleteUserAccount", () => {
  it("删除用户的全部关联数据", async () => {
    const { db, statements } = fakeDb()

    await deleteUserAccount(db, 42, "someone@example.com")

    const sqls = statements.map((s) => s.sql)
    expect(sqls.some((sql) => sql.includes("DELETE FROM sessions WHERE user_id"))).toBe(true)
    expect(sqls.some((sql) => sql.includes("DELETE FROM model_configs WHERE user_id"))).toBe(true)
    expect(sqls.some((sql) => sql.includes("DELETE FROM device_accounts WHERE user_id"))).toBe(true)
    expect(sqls.some((sql) => sql.includes("DELETE FROM email_codes WHERE email"))).toBe(true)
    expect(sqls.some((sql) => sql.includes("DELETE FROM users WHERE id"))).toBe(true)
  })

  it("子表先删、users 最后删（外键约束要求引用方先消失）", async () => {
    const { db, statements } = fakeDb()

    await deleteUserAccount(db, 42, "someone@example.com")

    const usersIndex = statements.findIndex((s) => s.sql.includes("DELETE FROM users"))
    expect(usersIndex).toBe(statements.length - 1)
  })

  it("email_codes 按邮箱删：验证码表没有 user_id", async () => {
    const { db, statements } = fakeDb()

    await deleteUserAccount(db, 42, "someone@example.com")

    const emailCodeStmt = statements.find((s) => s.sql.includes("DELETE FROM email_codes"))
    expect(emailCodeStmt?.params).toEqual(["someone@example.com"])
  })

  it("用户相关的表都按 userId 绑定，不会误删别人的数据", async () => {
    const { db, statements } = fakeDb()

    await deleteUserAccount(db, 42, "someone@example.com")

    for (const stmt of statements) {
      if (stmt.sql.includes("email_codes")) continue
      expect(stmt.params).toEqual([42])
    }
  })

  it("不删除审计记录：删除权行使本身需要留痕", async () => {
    const { db, statements } = fakeDb()

    await deleteUserAccount(db, 42, "someone@example.com")

    expect(statements.some((s) => s.sql.includes("revoke_audit"))).toBe(false)
  })
})
