import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * 「模型同步」入口的守卫。
 *
 * ## 为什么需要这条测试
 *
 * 它曾经**真的丢过一次**：合并插件分支时，`settings-view.tsx` 整份取了分支版本，
 * 而分支那一版没有 `<ModelSyncPanel />`。类型检查、构建、测试全绿 ——
 * 因为面板文件本身还在、它自己的单测也还在跑，只是**没人渲染它了**。
 * 用户是在设置页里发现「云同步功能没了」才知道的。
 *
 * 所以这条断言盯的不是「文件存在」，而是「设置页真的渲染了它」。
 *
 * ## 位置（2026-11-02 迁移）
 *
 * 面板原来挂在模型页（settings-view 的页签条下方），用户要求移到
 * **「账号」页**：同步的是「账号的模型配置」，入口放账号下更名副其实，
 * 模型页也少一块干扰。现在它由 account-section 渲染（已登录分支内，
 * 面板自身在未登录时返回 null，正好与账号页的登录门槛一致）。
 * 守卫相应改为盯 account-section：面板丢了、或退回模型页，都在这里失败。
 *
 * 同时断言 settings-view **不再**引用它：两处都挂会出现两份面板、
 * 两个 store 订阅在同一个状态上互相打架。
 */
const view = readFileSync(
  resolve(process.cwd(), "src/components/settings/settings-view.tsx"),
  "utf8",
)
const account = readFileSync(
  resolve(process.cwd(), "src/components/settings/sections/account-section.tsx"),
  "utf8",
)

describe("设置页必须渲染模型云同步入口（账号页内）", () => {
  it("账号页导入了 ModelSyncPanel", () => {
    expect(account).toMatch(/import\s*\{\s*ModelSyncPanel\s*\}\s*from\s*"\.\/model-sync-panel"/)
  })

  it("账号页真的渲染了 <ModelSyncPanel />（不只是 import）", () => {
    expect(account).toContain("<ModelSyncPanel />")
  })

  it("模型页不再挂面板：两处都放会出现两份面板、两份心跳订阅互相打架", () => {
    expect(view).not.toContain("ModelSyncPanel")
  })

  it("模型同步的核心模块仍在（服务/加密/合并/调度）", () => {
    for (const path of [
      "src/lib/model-sync/service.ts",
      "src/lib/model-sync/crypto.ts",
      "src/lib/model-sync/merge.ts",
      "src/lib/model-sync/scheduler.ts",
      "src/stores/model-sync-store.ts",
      "src/hooks/use-model-sync-auto-sync.ts",
    ]) {
      expect(() => readFileSync(resolve(process.cwd(), path), "utf8"), path).not.toThrow()
    }
  })
})
