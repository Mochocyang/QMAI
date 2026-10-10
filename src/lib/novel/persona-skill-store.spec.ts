import { beforeEach, describe, expect, it, vi } from "vitest"

const io = vi.hoisted(() => {
  const files = new Map<string, string>()
  const dirs = new Set<string>()
  return { files, dirs }
})

vi.mock("@/commands/fs", () => ({
  readFile: async (path: string) => {
    if (!io.files.has(path)) throw new Error(`文件缺失：${path}`)
    return io.files.get(path)!
  },
  writeFileAtomic: async (path: string, contents: string) => {
    io.files.set(path, contents)
  },
  createDirectory: async (path: string) => {
    io.dirs.add(path)
  },
  fileExists: async (path: string) => io.files.has(path) || io.dirs.has(path),
  listDirectory: async (dir: string) => {
    const prefix = dir.endsWith("/") ? dir : `${dir}/`
    const nodes = new Map<string, { name: string; path: string; is_dir: boolean }>()
    for (const path of io.files.keys()) {
      if (!path.startsWith(prefix)) continue
      const rest = path.slice(prefix.length)
      const head = rest.split("/")[0]
      const childPath = `${prefix}${head}`
      nodes.set(childPath, { name: head, path: childPath, is_dir: rest.includes("/") })
    }
    return [...nodes.values()]
  },
}))

import {
  loadPersonaSkillIndex,
  loadPersonaSightings,
  personaSkillDocumentPath,
  personaSkillIdFor,
  personaSkillIndexPath,
  personaSkillSightingsPath,
  readPersonaSkillDocument,
  readPersonaSkillResearch,
  savePersonaSkillIndex,
  savePersonaSightings,
  updatePersonaSkillIndex,
  writePersonaSkillDocument,
  writePersonaSkillResearch,
  __resetPersonaSkillLocksForTesting,
} from "./persona-skill-store"
import type { PersonaSkillMeta } from "./persona-skill-types"

const projectPath = "C:/project"

function meta(characterName: string, overrides: Partial<PersonaSkillMeta> = {}): PersonaSkillMeta {
  return {
    id: personaSkillIdFor(characterName),
    characterName,
    aliases: [],
    roleType: "男主",
    tier: "major",
    pinned: false,
    status: "active",
    firstChapter: 1,
    lastChapter: 1,
    appearanceCount: 1,
    createdChapter: 1,
    lastLearnedChapter: 1,
    skillRevision: 1,
    editedByUser: false,
    hasResearch: false,
    updatedAt: "2026-10-10T00:00:00.000Z",
    ...overrides,
  }
}

describe("persona-skill-store", () => {
  beforeEach(() => {
    io.files.clear()
    io.dirs.clear()
    __resetPersonaSkillLocksForTesting()
  })

  it("没有 index.json 时返回空索引，不抛", async () => {
    const index = await loadPersonaSkillIndex(projectPath)
    expect(index).toEqual({ version: 1, skills: [] })
  })

  it("index.json 是坏 JSON 时降级为空索引", async () => {
    io.files.set(personaSkillIndexPath(projectPath), "{ 这不是 JSON")
    const index = await loadPersonaSkillIndex(projectPath)
    expect(index.skills).toEqual([])
  })

  it("索引存下来能原样读回", async () => {
    await savePersonaSkillIndex(projectPath, { version: 1, skills: [meta("林清越")] })
    const index = await loadPersonaSkillIndex(projectPath)
    expect(index.skills).toHaveLength(1)
    expect(index.skills[0].characterName).toBe("林清越")
  })

  it("坏条目被丢掉，好条目保留", async () => {
    io.files.set(
      personaSkillIndexPath(projectPath),
      JSON.stringify({ version: 1, skills: [{ characterName: "" }, meta("林清越")] }),
    )
    const index = await loadPersonaSkillIndex(projectPath)
    expect(index.skills.map((item) => item.characterName)).toEqual(["林清越"])
  })

  it("sightings 存下来能原样读回；坏 JSON 降级为空", async () => {
    await savePersonaSightings(projectPath, {
      version: 1,
      sightings: [{
        characterName: "路人甲",
        aliases: [],
        roleType: "",
        appearanceCount: 1,
        firstChapter: 1,
        lastChapter: 1,
        chapters: [1],
      }],
    })
    const loaded = await loadPersonaSightings(projectPath)
    expect(loaded.sightings[0].characterName).toBe("路人甲")

    io.files.set(personaSkillSightingsPath(projectPath), "not json")
    expect((await loadPersonaSightings(projectPath)).sightings).toEqual([])
  })

  it("合法人物名直接当目录名，不改写", () => {
    expect(personaSkillIdFor("林清越")).toBe("林清越")
  })

  it("名字里有路径非法字符时加稳定哈希后缀", () => {
    const first = personaSkillIdFor("A/B:清越")
    expect(first).not.toContain("/")
    expect(first).not.toContain(":")
    expect(first).toBe(personaSkillIdFor("A/B:清越"))
    expect(first).not.toBe(personaSkillIdFor("AB清越"))
  })

  it("读不存在的 SKILL.md 返回空串", async () => {
    expect(await readPersonaSkillDocument(projectPath, "林清越")).toBe("")
  })

  it("SKILL.md 写读往返", async () => {
    await writePersonaSkillDocument(projectPath, "林清越", "# 林清越 · 人物 Skill\n\n## 怎么说话\n\n句子短。\n")
    expect(await readPersonaSkillDocument(projectPath, "林清越")).toContain("句子短。")
    expect(await readPersonaSkillDocument(projectPath, "林清越")).toBe(
      io.files.get(personaSkillDocumentPath(projectPath, "林清越")),
    )
  })

  it("研究文件写读往返，空内容不落盘", async () => {
    const written = await writePersonaSkillResearch(projectPath, "林清越", {
      "人物小传": "他是长子。",
      "语言习惯": "   ",
    })
    expect(written).toHaveLength(1)
    const docs = await readPersonaSkillResearch(projectPath, "林清越")
    expect(Object.keys(docs)).toEqual(["人物小传"])
    expect(docs["人物小传"]).toBe("他是长子。")
  })

  it("研究文件目录不存在时读回空对象，不抛", async () => {
    expect(await readPersonaSkillResearch(projectPath, "查无此人")).toEqual({})
  })

  it("并发更新索引时串行落盘，两次都生效", async () => {
    await Promise.all([
      updatePersonaSkillIndex(projectPath, (index) => ({
        version: 1,
        skills: [...index.skills, meta("甲")],
      })),
      updatePersonaSkillIndex(projectPath, (index) => ({
        version: 1,
        skills: [...index.skills, meta("乙")],
      })),
    ])
    const index = await loadPersonaSkillIndex(projectPath)
    expect(index.skills.map((item) => item.characterName).sort()).toEqual(["乙", "甲"].sort())
  })

  it("mutate 返回 undefined 时不落盘（省掉无谓写入）", async () => {
    await updatePersonaSkillIndex(projectPath, (index) => {
      void index
    })
    expect(io.files.has(personaSkillIndexPath(projectPath))).toBe(false)
  })
})
