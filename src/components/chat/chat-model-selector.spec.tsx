import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { getChatModelDropdownStyle, resolveModelItemLabel } from "./chat-model-selector"

const source = readFileSync(resolve(__dirname, "chat-model-selector.tsx"), "utf8")

describe("chat model selector sizing", () => {
  it("uses a narrow fixed trigger width with truncated model text", () => {
    expect(source).toContain('className="h-8 w-fit max-w-40 justify-start gap-1 px-2 text-xs"')
    expect(source).toContain('className="max-w-32 truncate text-left"')
    expect(source).not.toContain("min-w-[160px]")
    expect(source).not.toContain("max-w-[200px]")
  })
})

describe("resolveModelItemLabel", () => {
  it("名字与模型 ID 相同时只保留一行", () => {
    expect(resolveModelItemLabel({ name: "hy3", model: "hy3" })).toEqual({
      title: "hy3",
      showModelId: false,
    })
  })

  it("名字与模型 ID 不同时才显示第二行", () => {
    expect(resolveModelItemLabel({ name: "写作主力", model: "deepseek-v4.1-flash" })).toEqual({
      title: "写作主力",
      showModelId: true,
    })
  })

  it("名字为空或只有空格时回落到模型 ID，且不重复显示", () => {
    expect(resolveModelItemLabel({ name: "   ", model: "glm-5.3" })).toEqual({
      title: "glm-5.3",
      showModelId: false,
    })
    expect(resolveModelItemLabel({ name: "", model: "hy3" })).toEqual({
      title: "hy3",
      showModelId: false,
    })
  })
})

describe("chat model dropdown density", () => {
  it("下拉项改成紧凑字号与更小的行距", () => {
    expect(source).toContain('className="truncate text-xs leading-4"')
    expect(source).toContain("text-[0.6875rem] leading-4")
    expect(source).toContain("items-center gap-1 rounded-sm px-3 py-0.5 text-left")
    expect(source).not.toContain("items-start gap-2 rounded-sm px-3 py-1.5")
  })
})

describe("getChatModelDropdownStyle", () => {
  it("opens below the trigger when there is enough space underneath", () => {
    const style = getChatModelDropdownStyle(
      { top: 120, bottom: 152, right: 400, width: 128 },
      { width: 800, height: 900 },
    )
    expect(style).toMatchObject({ top: 156, right: 248 })
    expect(style.bottom).toBeUndefined()
    expect(style.maxHeight).toBeLessThanOrEqual(360)
    expect(style.maxHeight).toBeGreaterThan(200)
  })

  it("opens above the trigger when space below is tight", () => {
    const style = getChatModelDropdownStyle(
      { top: 700, bottom: 732, right: 400, width: 128 },
      { width: 800, height: 800 },
    )
    expect(style.top).toBeUndefined()
    expect(style.bottom).toBe(800 - 700 + 4)
    expect(style.maxHeight).toBeLessThanOrEqual(700 - 4 - 4)
  })

  it("shifts a left-edge menu right so its full width stays visible", () => {
    const style = getChatModelDropdownStyle(
      { top: 300, bottom: 332, right: 180, width: 128 },
      { width: 692, height: 938 },
    )
    expect(style.width).toBe(280)
    expect(style.right).toBe(692 - 180 - (280 - 128))
    expect(style.right).toBeGreaterThanOrEqual(4)
  })

  it("caps downward maxHeight so the menu stays inside the viewport", () => {
    const style = getChatModelDropdownStyle(
      { top: 80, bottom: 112, right: 400, width: 128 },
      { width: 800, height: 400 },
    )
    expect(style.top).toBe(116)
    // viewport below trigger: 400 - 112 = 288 → maxHeight ≤ 288 - gap - 4
    expect(style.maxHeight).toBeLessThanOrEqual(280)
  })
})
