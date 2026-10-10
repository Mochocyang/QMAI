import { describe, expect, it } from "vitest"
import { DEFAULT_NOVEL_CONFIG } from "@/stores/wiki-store"
import { shouldRequestUsageTutorial } from "@/lib/usage-tutorial"

/**
 * 丙-4c：「这次要不要自动弹分步引导教程」的真值表。
 *
 * 这些用例存在的意义就是让「把判据删掉/写反」这类改动**变红** ——
 * 只有源码文本断言时，删掉 `!config.usageTutorialSeen` 是无声的。
 */
describe("shouldRequestUsageTutorial", () => {
  it("这本书还没弹过 → 请求弹（新书的正常路径）", () => {
    expect(shouldRequestUsageTutorial({ usageTutorialSeen: false })).toBe(true)
  })

  it("这本书已经弹过 → 不再自动弹", () => {
    expect(shouldRequestUsageTutorial({ usageTutorialSeen: true })).toBe(false)
  })

  it("字段缺失（旧配置文件）→ 按「没弹过」处理，教程照常弹", () => {
    // 这条与 project-store 里 `?? DEFAULT` 的默认值方向是同一件事的两端。
    expect(shouldRequestUsageTutorial({})).toBe(true)
  })

  it("读不到配置（null）→ 不弹，避免在状态不明的书上弹一次并把 seen 记成 true", () => {
    expect(shouldRequestUsageTutorial(null)).toBe(false)
    expect(shouldRequestUsageTutorial(undefined)).toBe(false)
  })

  it("全项目默认值就是「没弹过」——否则任何新书都不会自动弹", () => {
    expect(DEFAULT_NOVEL_CONFIG.usageTutorialSeen).toBe(false)
    expect(shouldRequestUsageTutorial(DEFAULT_NOVEL_CONFIG)).toBe(true)
  })
})
