import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "settings-view.tsx"), "utf8")

describe("settings-view 小说设置入口", () => {
  it("左侧分类包含 novel，用户可以进入小说模型测试页", () => {
    expect(source).toContain('id: "novel"')
    expect(source).toContain('labelKey: "settings.categories.novel"')
    expect(source).toContain("icon: BookOpen")
    expect(source).toContain('case "novel":')
    expect(source).toContain("<NovelSection")
  })
})
