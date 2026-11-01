import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * 「账号同步」（模型云同步）入口的守卫。
 *
 * ## 为什么需要这条测试
 *
 * 它曾经**真的丢过一次**：合并插件分支时，`settings-view.tsx` 整份取了分支版本，
 * 而分支那一版没有 `<ModelSyncPanel />`。类型检查、构建、测试全绿 ——
 * 因为面板文件本身还在、它自己的单测也还在跑，只是**没人渲染它了**。
 * 用户是在设置页里发现「云同步功能没了」才知道的。
 *
 * 所以这条断言盯的不是「文件存在」，而是「设置页真的渲染了它」。
 */
describe("设置页必须渲染模型云同步入口", () => {
  const view = readFileSync(
    resolve(process.cwd(), "src/components/settings/settings-view.tsx"),
    "utf8",
  )

  it("导入了 ModelSyncPanel", () => {
    expect(view).toMatch(/import\s*\{\s*ModelSyncPanel\s*\}\s*from\s*"\.\/sections\/model-sync-panel"/)
  })

  it("真的渲染了 <ModelSyncPanel />（不只是 import）", () => {
    expect(view).toContain("<ModelSyncPanel />")
  })

  it("渲染位置在页签条之外：它同步的是整份模型配置，不属于某个页签", () => {
    const renderAt = view.indexOf("<ModelSyncPanel />")
    const llmTabAt = view.indexOf('<LlmProviderSection />')
    // 面板出现在页签面板之前，说明挂在页签条下方而不是被塞进某个页签里
    expect(renderAt).toBeGreaterThan(-1)
    expect(renderAt).toBeLessThan(llmTabAt)
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
