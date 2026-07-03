import { describe, it, expect } from "vitest"
import { createPostWriteCheckPlugin, runPostWriteCheck } from "./post-write-check-plugin"
import type { PrePluginInput } from "../pipeline"
import type { PostWriteCheckItem } from "../context-trace"

describe("createPostWriteCheckPlugin", () => {
  it("should return empty output when no content is available", async () => {
    const plugin = createPostWriteCheckPlugin()
    const result = await plugin.run({} as PrePluginInput)
    expect(result).toEqual({})
  })

  it("should perform checks when content is provided via deps", async () => {
    const plugin = createPostWriteCheckPlugin({ chapterContent: "test content with enough length and, however, some transition words. But suddenly something happened." })
    const result = await plugin.run({} as PrePluginInput)
    expect(result.postWriteCheck).toBeDefined()
    expect((result as any).postWriteCheck!.items.length).toBe(7)
    expect((result as any).postWriteCheck!.passedCount).toBeGreaterThan(0)
  })

  it("should detect empty content as failing certain checks", async () => {
    const plugin = createPostWriteCheckPlugin({ chapterContent: "short" })
    const result = await plugin.run({} as PrePluginInput)
    expect(result.postWriteCheck).toBeDefined()
    expect((result as any).postWriteCheck!.allPassed).toBe(false)
  })

  it("should detect placeholder markers", async () => {
    const plugin = createPostWriteCheckPlugin({ chapterContent: "这是一章内容。其中【待补充】了部分细节。" })
    const result = await plugin.run({} as PrePluginInput)
    const mainLineItem = (result as any).postWriteCheck!.items.find((i: any) => i.name === "主线推进")
    expect(mainLineItem?.passed).toBe(false)
  })
})

describe("runPostWriteCheck", () => {
  it("should return PostWriteCheck for any content", () => {
    const result = runPostWriteCheck("Some content with transitions. However, something happened. But then...")
    expect(result.items.length).toBe(7)
    expect(result.passedCount).toBeGreaterThan(0)
    expect(result.totalCount).toBe(7)
  })

  it("should detect all-pass for rich content", () => {
    const result = runPostWriteCheck("第一章内容开始了。但是遇到了困难。然而主人公没有放弃。突然出现转机。却引发了新的问题。这是一段足够长的文本来确保所有检查通过。人物动机明确，冲突激烈，节奏紧凑。这篇内容足够复杂，包含了足够多的文字和情感深度。角色之间的对话生动有趣，情节推进自然流畅。每一个细节都经过精心打磨，力求给读者最完美的阅读体验。作者在写作过程中不断调整节奏，确保故事既有张力又不失细腻。人物性格鲜明，彼此之间的互动充满戏剧性。")
    expect(result.allPassed).toBe(true)
  })

  it("空内容不会全部通过，但仍返回 7 项结构", () => {
    const result = runPostWriteCheck("")
    expect(result.totalCount).toBe(7)
    expect(result.items.length).toBe(7)
    expect(result.allPassed).toBe(false)
    expect(result.passedCount).toBeLessThan(result.totalCount)
  })

  it("包含 chapter_plan 标记的内容仍返回 7 项结构（不触发误报）", () => {
    const content = "<!-- chapter_plan -->计划<!-- /chapter_plan -->"
    const result = runPostWriteCheck(content)
    expect(result.totalCount).toBe(7)
    expect(result.items.length).toBe(7)
  })

  it("合格的长正文大部分通过", () => {
    const content = [
      "主角推开门，然而屋内空无一人。",
      "他突然意识到自己被追踪了，却发现手机没信号。",
      "但是，桌上的一张纸条改变了一切。",
      "他决定先离开，再想办法联系队友。",
      "夜色已深，街道上只有零星的路灯。",
    ].join("\n")
    const result = runPostWriteCheck(content)
    expect(result.totalCount).toBe(7)
    expect(result.passedCount).toBeGreaterThanOrEqual(4)
  })

  it("返回的每项都有 name/passed/detail 字段且类型正确", () => {
    const result = runPostWriteCheck("短内容")
    for (const item of result.items) {
      expect(item).toHaveProperty("name")
      expect(item).toHaveProperty("passed")
      expect(item).toHaveProperty("detail")
      expect(typeof item.name).toBe("string")
      expect(typeof item.passed).toBe("boolean")
      expect(typeof item.detail).toBe("string")
    }
  })

  it("passedCount 等于 passed=true 的项数", () => {
    const result = runPostWriteCheck("测试内容但是有转折词")
    const manualCount = result.items.filter((i) => i.passed).length
    expect(result.passedCount).toBe(manualCount)
  })

  it("allPassed 在全部通过时为 true，否则为 false", () => {
    const content = "a".repeat(300) + " 但是然而突然却 " + "b".repeat(300)
    const result = runPostWriteCheck(content)
    if (result.passedCount === result.totalCount) {
      expect(result.allPassed).toBe(true)
    } else {
      expect(result.allPassed).toBe(false)
    }
  })
})

describe("PostWriteCheckItem 字段扩展", () => {
  it("类型定义包含 severity/evidence/suggestion 可选字段", () => {
    const item: PostWriteCheckItem = { name: "测试", passed: true, detail: "测试" }
    const withFields: PostWriteCheckItem = {
      name: "测试",
      passed: true,
      detail: "测试",
      severity: "warning",
      evidence: "证据",
      suggestion: "建议",
    }
    expect(item.severity).toBeUndefined()
    expect(withFields.severity).toBe("warning")
  })
})
