import { describe, expect, it } from "vitest"
import { DEFAULT_NOVEL_CONFIG } from "@/stores/wiki-store"
import { shouldRequestUsageTutorial } from "@/lib/usage-tutorial"

/**
 * 丙-4c：「这次要不要自动弹分步引导教程」的真值表。
 *
 * 这些用例存在的意义就是让「把判据删掉/写反」这类改动**变红** ——
 * 只有源码文本断言时，删掉 `!config.usageTutorialSeen` 是无声的。
 *
 * ⚠️ 修复批 F2 之后，第二维 `isCurrentProject` 也在这里按真值表钉住：
 * 它原来写在 `App.tsx` 调用点（`&& isCurrentProject(proj)`），评审实测
 * **删掉它全套测试仍然全绿** —— 那种「只有一行代码 + 一段解释」的守卫，
 * 等于没有守卫。现在两条路径各有一条断言：
 *   · 判据本身（含这一维）→ 本文件；
 *   · `App.tsx` 真的把项目身份传了进去 → `App.usage-tutorial.test.ts` 的源码断言
 *     （判据被删会红在真值表上，调用点把参数写死成 true 会红在那条源码断言上）。
 */
describe("shouldRequestUsageTutorial", () => {
  it("这本书还没弹过、且仍是当前项目 → 请求弹（新书的正常路径）", () => {
    expect(shouldRequestUsageTutorial({ usageTutorialSeen: false }, true)).toBe(true)
  })

  it("这本书已经弹过 → 不再自动弹", () => {
    expect(shouldRequestUsageTutorial({ usageTutorialSeen: true }, true)).toBe(false)
  })

  it("字段缺失（旧配置文件）→ 按「没弹过」处理，教程照常弹", () => {
    // 这条与 project-store 里 `?? DEFAULT` 的默认值方向是同一件事的两端。
    expect(shouldRequestUsageTutorial({}, true)).toBe(true)
  })

  it("读不到配置（null）→ 不弹，避免在状态不明的书上弹一次并把 seen 记成 true", () => {
    expect(shouldRequestUsageTutorial(null, true)).toBe(false)
    expect(shouldRequestUsageTutorial(undefined, true)).toBe(false)
  })

  /*
   * ── F2：迟到的项目打开不得作用在已经切走的窗口上 ──
   *
   * 这正是 `App.tsx` 里那 ~18 行注释在解释的竞态：书 A 的
   * `await loadNovelConfig` 迟到返回时，store 里可能已经是书 B。
   * 变异：把 `!isCurrentProject` 从判据里删掉 → 下面两条立刻红。
   */
  it("这次打开的那个项目已经不是当前项目（用户已经切走）→ 一次都不弹", () => {
    expect(
      shouldRequestUsageTutorial({ usageTutorialSeen: false }, false),
      "书 A 迟到的打开结果不能作用在已经切到书 B 的窗口上",
    ).toBe(false)
  })

  it("已经不是当前项目时，无论 seen 是什么都不弹", () => {
    expect(shouldRequestUsageTutorial({ usageTutorialSeen: true }, false)).toBe(false)
    expect(shouldRequestUsageTutorial({}, false)).toBe(false)
    expect(
      shouldRequestUsageTutorial(null, false),
      "两个维度可以同时为假，不必二选一",
    ).toBe(false)
  })

  it("全项目默认值就是「没弹过」——否则任何新书都不会自动弹", () => {
    expect(DEFAULT_NOVEL_CONFIG.usageTutorialSeen).toBe(false)
    expect(shouldRequestUsageTutorial(DEFAULT_NOVEL_CONFIG, true)).toBe(true)
  })
})
