import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { getChatModelDropdownStyle } from "./chat-model-selector"

const source = readFileSync(resolve(__dirname, "chat-model-selector.tsx"), "utf8")

describe("chat model selector sizing", () => {
  it("uses a narrow fixed trigger width with truncated model text", () => {
    expect(source).toContain('className="h-8 w-32 justify-between gap-2 px-3 text-xs"')
    expect(source).toContain('className="min-w-0 flex-1 truncate text-left"')
    expect(source).not.toContain("min-w-[160px]")
    expect(source).not.toContain("max-w-[200px]")
  })
})

describe("getChatModelDropdownStyle", () => {
  it("opens below the trigger when there is enough space underneath", () => {
    const style = getChatModelDropdownStyle(
      { top: 120, bottom: 152, right: 400, width: 128 },
      { width: 800, height: 900 },
    )
    expect(style).toMatchObject({ top: 156, right: 400 })
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
