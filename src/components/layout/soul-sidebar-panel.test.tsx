import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "soul-sidebar-panel.tsx"), "utf8")

describe("soul-sidebar-panel", () => {
  it("shows bound novel characters under the project soul tab", () => {
    expect(source).toContain("getCharacterAuraBindings")
    expect(source).toContain("已绑定人物")
    expect(source).toContain("还没有人物绑定角色灵魂")
  })

  it("shows which novel character is bound before the aura selector", () => {
    expect(source).toContain("小说人物")
    expect(source).toContain("绑定角色灵魂")
  })

  it("allows switching the bound aura directly from the project soul panel", () => {
    expect(source).toContain("bindCharacterAura")
    expect(source).toContain("value={binding.auraId}")
    expect(source).toContain("<select")
  })

  it("keeps an unbind action on the right side of each binding row", () => {
    expect(source).toContain("unbindCharacterAura")
    expect(source).toContain("取消绑定")
  })

  it("uses the novel character name as the binding card key", () => {
    expect(source).toContain('key={binding.characterName}')
  })
})
