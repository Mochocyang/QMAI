import { beforeEach, describe, expect, it, vi } from "vitest"
import { personality, portabilityApproval } from "@/test-helpers/portable-personality-fixture"
import { parsePortablePersonality, personalityFields, readPersonalitySkill } from "./portable-personality"

const disk = vi.hoisted(() => new Map<string, string>())
vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(async (path: string) => { if (!disk.has(path)) throw new Error("不存在"); return disk.get(path)! }),
  writeFileAtomic: vi.fn(async (path: string, text: string) => { disk.set(path, text) }),
  createDirectory: vi.fn(async () => {}),
  fileExists: vi.fn(async (path: string) => disk.has(path)),
  listDirectory: vi.fn(async () => [{ name: "c1.md", path: "/book/chapters/c1.md", is_dir: false }, { name: "c2.md", path: "/book/chapters/c2.md", is_dir: false }]),
}))
vi.mock("@/lib/llm-client", () => ({
  streamChat: vi.fn(async (_config, messages, callbacks) => {
    callbacks.onToken(JSON.stringify(String(messages[0].content).startsWith("人格规则迁移核验") ? portabilityApproval : personality))
    callbacks.onDone()
  }),
}))
import { generateSkillsForCharacters } from "./book-analysis/skill-generator"
import { buildGeneratedAuraInputFromBookCharacter } from "./book-analysis/aura-adapter"
import { createCustomCharacterAuraFromGeneratedSkill, updateCustomCharacterAura, buildCharacterAuraContext } from "./character-aura"

const metadata = { title: "测试书", sourceType: "file" as const, totalChapters: 2, totalWords: 100, createdAt: 1, updatedAt: 1 }
const character = {
  id: "char", name: "他", aliases: [], importance: 10, category: "protagonist" as const,
  description: "原作警察", personality: "", speechStyle: "", firstAppearance: 1, lastAppearance: 2,
  appearanceCount: 2, relationships: [], keyEvents: [],
}
beforeEach(() => {
  disk.clear()
  personality.evidence.forEach((item, i) => disk.set(`/book/chapters/${item.chapterId}.md`,
    `---\nid: ${item.chapterId}\norder: ${i + 1}\n---\n${item.quote}`))
})
describe("人格提炼与灵魂持久化", () => {
  it("实际批量入口产出可恢复的人格而不是旧档案模板，原有Skill保留历史", async () => {
    disk.set("/book/skills/他-skill.md", "旧版资料")
    const skills = await generateSkillsForCharacters([character], metadata, "/book", {} as any)
    expect(readPersonalitySkill(skills[0].skillContent)?.rules).toHaveLength(2)
    expect([...disk.entries()].some(([path, text]) => path.includes("/history/") && text === "旧版资料")).toBe(true)
  })
  it("编辑人格规则后，预览字段、Skill与实际注入同步更新", async () => {
    const skills = await generateSkillsForCharacters([character], metadata, "/book", {} as any)
    const input = buildGeneratedAuraInputFromBookCharacter(character, skills[0], metadata)
    const aura = await createCustomCharacterAuraFromGeneratedSkill("/project", input)
    const store = JSON.parse(disk.get("/project/.qmai/character-aura.json")!)
    store.bindings = [{ characterName: "陆衡", auraId: aura.id }]
    disk.set("/project/.qmai/character-aura.json", JSON.stringify(store))
    const updatedProfile = parsePortablePersonality({
      ...personality, rules: personality.rules.map((rule) => rule.id === "R1"
        ? { ...rule, tendency: "核验后再作决定，不抢先表态" } : rule),
    })
    const updated = await updateCustomCharacterAura("/project", aura.id, { portablePersonality: updatedProfile })
    expect(updated.mentalModel).toBe(personalityFields(updatedProfile).mentalModel)
    expect(readPersonalitySkill(disk.get(`${aura.skillFolder}/SKILL.md`)!)?.rules[0].tendency)
      .toBe("核验后再作决定，不抢先表态")
    expect(await buildCharacterAuraContext("/project", "陆衡查账")).toContain("核验后再作决定")
  })
})
