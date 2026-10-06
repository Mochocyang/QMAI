import { describe, expect, it, vi } from "vitest"
import { buildCharacterAuraContext, buildCharacterSoulContext } from "./character-aura"
import { readFile } from "@/commands/fs"
import { personality } from "@/test-helpers/portable-personality-fixture"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(async (path: string) => {
    if (path.endsWith("/.qmai/character-aura.json")) {
      return JSON.stringify({
        customAuras: [],
        bindings: [
          { characterName: "小晴", auraId: "builtin-li-qingzhao" },
          { characterName: "小云", auraId: "builtin-li-qingzhao" },
        ],
      })
    }
    return ""
  }),
  writeFileAtomic: vi.fn(),
  createDirectory: vi.fn(),
  listDirectory: vi.fn(async () => []),
}))

describe("buildCharacterAuraContext", () => {
  it("新灵魂只加载可迁移规则，不把原作证据和身份摘要注入新人物", async () => {
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({
      customAuras: [{ id: "custom", name: "许七安", portablePersonality: personality, styleDescription: "前世是警察", skillFolder: "/source" }],
      bindings: [{ characterName: "陆衡", auraId: "custom" }],
    }))
    const result = await buildCharacterSoulContext("E:/Novel", "陆衡查账")
    expect(result.portablePersonalities).toHaveLength(1)
    expect(result.text).toContain("不能直接定罪")
    expect(result.text).not.toContain("前世是警察")
    expect(result.text).not.toContain("许七安")
  })
  it("matches a bound character from extra chapter context when the user request only contains a chapter number", async () => {
    const context = await buildCharacterAuraContext("E:/Novel", "生成第3章", {
      matchingText: "第3章章纲：小晴在旧屋醒来，并和主角一起发现第二把钥匙。",
    })

    expect(context).toContain("小晴")
    expect(context).toContain("李清照")
    expect(context).toContain("角色灵魂必须服从大纲")
  })

  it("matches a simplified bound name when the task uses traditional Chinese", async () => {
    const context = await buildCharacterAuraContext("E:/Novel", "小雲推開舊屋的門")

    expect(context).toContain("小云")
    expect(context).toContain("李清照")
  })
})
