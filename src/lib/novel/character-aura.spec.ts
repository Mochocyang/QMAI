import { describe, expect, it, vi } from "vitest"
import { buildCharacterAuraContext } from "./character-aura"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(async (path: string) => {
    if (path.endsWith("/.qmai/character-aura.json")) {
      return JSON.stringify({
        customAuras: [],
        bindings: [{ characterName: "小晴", auraId: "builtin-li-qingzhao" }],
      })
    }
    return ""
  }),
  writeFileAtomic: vi.fn(),
  createDirectory: vi.fn(),
  listDirectory: vi.fn(async () => []),
}))

describe("buildCharacterAuraContext", () => {
  it("matches a bound character from extra chapter context when the user request only contains a chapter number", async () => {
    const context = await buildCharacterAuraContext("E:/Novel", "生成第3章", {
      matchingText: "第3章章纲：小晴在旧屋醒来，并和主角一起发现第二把钥匙。",
    })

    expect(context).toContain("小晴")
    expect(context).toContain("李清照")
    expect(context).toContain("角色灵魂必须服从大纲")
  })
})
