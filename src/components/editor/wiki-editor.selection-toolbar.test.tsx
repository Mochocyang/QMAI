import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "wiki-editor.tsx"), "utf8")

describe("正文划词工具栏", () => {
  it("提供 AI润色 和 去AI味 两个动作", () => {
    expect(source).toContain("AI润色")
    expect(source).toContain("去AI味")
  })

  it("将选中的正文片段回传给上层处理", () => {
    expect(source).toContain("onSelectionAction")
    expect(source).toContain('triggerSelectionAction("polish")')
    expect(source).toContain('triggerSelectionAction("de-ai")')
  })
})
