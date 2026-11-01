import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * 「立即同步 → 接口不存在」这一失败的诊断守卫。
 *
 * ## 现场
 *
 * 线上点「立即同步」返回 `code: NOT_FOUND`，界面显示「接口不存在。」。
 * 客户端打的地址是对的（`https://account.qmai.pro/v1/model-config`），
 * 仓库里 `account-worker` 也实现了这三个路由 —— 所以问题不在客户端，
 * 而在**部署的 Worker 版本比仓库旧**（没有这个路由）。
 *
 * 这类问题的特征是：所有本地测试都过，只有对着真实服务才暴露。
 * 所以这里守两件事：
 *   1. 客户端确实调 `/v1/model-config`（地址别再漂）；
 *   2. Worker 确实注册了 GET/PUT/DELETE 三条路由，且迁移表建好了。
 * 只要两者齐备，剩下的就是「重新部署」这一件运维动作。
 */
describe("模型同步：客户端与 Worker 的接口必须对得上", () => {
  const api = readFileSync(resolve(process.cwd(), "src/lib/account/api.ts"), "utf8")
  const workerIndex = readFileSync(resolve(process.cwd(), "account-worker/src/index.ts"), "utf8")

  it("客户端调用 /v1/model-config", () => {
    expect(api.match(/"\/v1\/model-config"/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
  })

  it("Worker 注册了 GET / PUT / DELETE 三条模型配置路由", () => {
    expect(workerIndex).toContain('"GET /v1/model-config": handleGetModelConfig')
    expect(workerIndex).toContain('"PUT /v1/model-config": handlePutModelConfig')
    expect(workerIndex).toContain('"DELETE /v1/model-config": handleDeleteModelConfig')
  })

  it("model_configs 表有对应迁移", () => {
    const migration = resolve(process.cwd(), "account-worker/migrations/0003_model_configs.sql")
    expect(() => readFileSync(migration, "utf8")).not.toThrow()
    expect(readFileSync(migration, "utf8")).toContain("CREATE TABLE IF NOT EXISTS model_configs")
  })

  it("迁移编号不重复（重复会让新库的应用顺序不确定）", () => {
    // 目录里只允许出现一次 0003 / 0006 这样的序号
    const { readdirSync } = require("node:fs") as typeof import("node:fs")
    const names = readdirSync(resolve(process.cwd(), "account-worker/migrations")) as string[]
    const prefixes = names.map((name) => name.split("_")[0])
    expect(new Set(prefixes).size).toBe(prefixes.length)
  })

  it("NOT_FOUND 会被翻译成「服务端未更新」的可操作提示", () => {
    const store = readFileSync(resolve(process.cwd(), "src/stores/model-sync-store.ts"), "utf8")
    expect(store).toContain("describeSyncEndpointError")
    expect(store).toContain("wrangler deploy")
  })
})
