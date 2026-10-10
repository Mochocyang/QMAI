import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { isPathInside } from "@/lib/path-utils"

const io = vi.hoisted(() => {
  const files = new Map<string, string>()
  const dirs = new Set<string>()
  /** 「存在但读不出来」（权限 / 句柄错误）：用来把「文件不存在」和「读失败」分开测。 */
  const unreadable = new Set<string>()
  /**
   * mock 的文件键归一化。真实磁盘上 `C:/p` 与 `C:/p/` 是同一个目录，
   * 用 Map 模拟时也必须折掉重复斜杠与尾斜杠，否则测不出「同一目录两把锁」的丢更新。
   */
  const canonical = (path: string): string => {
    const forward = path.replace(/\\/g, "/").replace(/\/{2,}/g, "/")
    return forward.length > 1 ? forward.replace(/\/+$/, "") : forward
  }
  /** 每次落盘的文件路径（归一化后），用来分辨「内容恰好没变」与「根本没写」。 */
  const writes: string[] = []
  return { files, dirs, unreadable, canonical, writes }
})

vi.mock("@/commands/fs", () => ({
  readFile: async (path: string) => {
    const key = io.canonical(path)
    if (io.unreadable.has(key)) throw new Error(`读不出来：${key}`)
    if (!io.files.has(key)) throw new Error(`文件缺失：${key}`)
    return io.files.get(key)!
  },
  writeFileAtomic: async (path: string, contents: string) => {
    const key = io.canonical(path)
    io.writes.push(key)
    io.files.set(key, contents)
  },
  createDirectory: async (path: string) => {
    io.dirs.add(io.canonical(path))
  },
  fileExists: async (path: string) => {
    const key = io.canonical(path)
    return io.files.has(key) || io.dirs.has(key)
  },
  listDirectory: async (dir: string) => {
    const prefix = `${io.canonical(dir)}/`
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
  personaSkillLockKey,
  personaSkillResearchDirectory,
  personaSkillRoot,
  personaSkillSightingsPath,
  readPersonaSkillDocument,
  readPersonaSkillResearch,
  savePersonaSkillIndex,
  savePersonaSightings,
  updatePersonaSkillIndex,
  updatePersonaSkillState,
  updatePersonaSightings,
  withPersonaSkillLock,
  writePersonaSkillDocument,
  writePersonaSkillResearch,
  __resetPersonaSkillLocksForTesting,
} from "./persona-skill-store"
import type { PersonaSkillMeta, PersonaSkillSighting } from "./persona-skill-types"

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

function sighting(characterName: string, overrides: Partial<PersonaSkillSighting> = {}): PersonaSkillSighting {
  return {
    characterName,
    aliases: [],
    roleType: "",
    appearanceCount: 1,
    firstChapter: 1,
    lastChapter: 1,
    chapters: [1],
    ...overrides,
  }
}

/** 加固后会对损坏文件 console.warn 再抛，测试里静音以免刷屏（afterEach 统一还原）。 */
function silenceWarns(): void {
  vi.spyOn(console, "warn").mockImplementation(() => {})
}

describe("persona-skill-store", () => {
  beforeEach(() => {
    io.files.clear()
    io.dirs.clear()
    io.unreadable.clear()
    io.writes.length = 0
    __resetPersonaSkillLocksForTesting()
  })

  afterEach(() => {
    vi.restoreAllMocks()
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

  it("坏 JSON 的索引拒绝写入，磁盘上的文件保持原样（不再被静默抹掉）", async () => {
    silenceWarns()
    const path = personaSkillIndexPath(projectPath)
    const broken = "{ 这不是 JSON"
    io.files.set(path, broken)

    await expect(
      updatePersonaSkillIndex(projectPath, (index) => ({
        version: 1,
        skills: [...index.skills, meta("甲")],
      })),
    ).rejects.toThrow(/已停止写入/)
    expect(io.files.get(path)).toBe(broken)
  })

  it("索引文件存在但读不出来时拒绝写入，磁盘内容不被覆盖", async () => {
    silenceWarns()
    const path = personaSkillIndexPath(projectPath)
    const raw = JSON.stringify({ version: 1, skills: [meta("甲")] })
    io.files.set(path, raw)
    io.unreadable.add(path)

    await expect(
      updatePersonaSkillIndex(projectPath, (index) => ({
        version: 1,
        skills: [...index.skills, meta("乙")],
      })),
    ).rejects.toThrow(/已停止写入/)
    expect(io.files.get(path)).toBe(raw)
    // 注入路径用的宽松版必须继续永不抛：索引读不出来不能让写作失败。
    await expect(loadPersonaSkillIndex(projectPath)).resolves.toEqual({ version: 1, skills: [] })
  })

  it("索引里有会被丢弃的坏条目时拒绝写入，不静默丢数据", async () => {
    silenceWarns()
    const path = personaSkillIndexPath(projectPath)
    const raw = JSON.stringify({ version: 1, skills: [{ characterName: "" }, meta("林清越")] })
    io.files.set(path, raw)

    await expect(
      updatePersonaSkillIndex(projectPath, (index) => ({
        version: 1,
        skills: [...index.skills, meta("乙")],
      })),
    ).rejects.toThrow(/已停止写入/)
    expect(io.files.get(path)).toBe(raw)
  })

  it("索引版本不认识时拒绝写入，未知字段不会被抹掉", async () => {
    silenceWarns()
    const path = personaSkillIndexPath(projectPath)
    const raw = JSON.stringify({
      version: 2,
      note: "未来字段",
      skills: [{ ...meta("林清越"), notes: "未知字段" }],
    })
    io.files.set(path, raw)

    await expect(
      updatePersonaSkillIndex(projectPath, (index) => ({
        version: 1,
        skills: [...index.skills, meta("甲")],
      })),
    ).rejects.toThrow(/已停止写入/)
    expect(io.files.get(path)).toBe(raw)
  })

  it("mutate 抛错时错误向外传、不落盘，随后的 update 仍能完成（锁没被毒化）", async () => {
    await expect(
      updatePersonaSkillIndex(projectPath, () => {
        throw new Error("规划失败")
      }),
    ).rejects.toThrow("规划失败")
    expect(io.files.has(personaSkillIndexPath(projectPath))).toBe(false)

    await updatePersonaSkillIndex(projectPath, (index) => ({
      version: 1,
      skills: [...index.skills, meta("甲")],
    }))
    expect((await loadPersonaSkillIndex(projectPath)).skills.map((item) => item.characterName)).toEqual(["甲"])
  })

  it("withPersonaSkillLock 不把上一个任务的结果当实参传进来", async () => {
    const seen: number[] = []
    await withPersonaSkillLock("零参检查", async () => "上一个任务的结果")
    await withPersonaSkillLock("零参检查", async (...args: unknown[]) => {
      seen.push(args.length)
    })
    expect(seen).toEqual([0])
  })

  it("等价路径写法（C:/p 与 C:/p/）并发更新索引时不再丢更新", async () => {
    await Promise.all([
      updatePersonaSkillIndex("C:/p", (index) => ({
        version: 1,
        skills: [...index.skills, meta("甲")],
      })),
      updatePersonaSkillIndex("C:/p/", (index) => ({
        version: 1,
        skills: [...index.skills, meta("乙")],
      })),
    ])
    const index = await loadPersonaSkillIndex("C:/p")
    expect(index.skills.map((item) => item.characterName).sort()).toEqual(["乙", "甲"].sort())
  })

  it("等价路径写法并发更新候选池时不再丢更新", async () => {
    await Promise.all([
      updatePersonaSightings("C:/p", (sightings) => ({
        version: 1,
        sightings: [...sightings.sightings, sighting("甲")],
      })),
      updatePersonaSightings("C:/p/", (sightings) => ({
        version: 1,
        sightings: [...sightings.sightings, sighting("乙")],
      })),
    ])
    const loaded = await loadPersonaSightings("C:/p")
    expect(loaded.sightings.map((item) => item.characterName).sort()).toEqual(["乙", "甲"].sort())
  })

  it("候选池的读-改-写往返", async () => {
    await updatePersonaSightings(projectPath, (sightings) => ({
      version: 1,
      sightings: [...sightings.sightings, sighting("路人甲")],
    }))
    expect((await loadPersonaSightings(projectPath)).sightings[0].characterName).toBe("路人甲")
  })

  it("磁盘上的 id 形如路径穿越时回落到按人名重算的 id，写入不越出 persona-skill-root", async () => {
    io.files.set(
      personaSkillIndexPath(projectPath),
      JSON.stringify({
        version: 1,
        skills: [{ ...meta("林清越"), id: "../../../../outside" }],
      }),
    )
    const index = await loadPersonaSkillIndex(projectPath)
    expect(index.skills[0].id).toBe(personaSkillIdFor("林清越"))

    await writePersonaSkillDocument(projectPath, index.skills[0].id, "# 林清越\n")
    for (const path of io.files.keys()) {
      expect(isPathInside(path, personaSkillRoot(projectPath))).toBe(true)
    }
  })

  it("名字是全点号时不返回 . 或 ..（走哈希分支）", () => {
    for (const name of [".", "..", "..."]) {
      const id = personaSkillIdFor(name)
      expect(id).not.toBe(name)
      expect(id).toMatch(/-[0-9a-f]{8}$/)
      expect(id).not.toContain("/")
      expect(isPathInside(`${personaSkillRoot(projectPath)}/${id}`, personaSkillRoot(projectPath))).toBe(true)
    }
  })

  it("研究文件名含路径穿越时被跳过，不写出 persona-skill-root", async () => {
    silenceWarns()
    const written = await writePersonaSkillResearch(projectPath, "林清越", {
      "../escape": "越界内容",
      "..\\escape": "越界内容",
      "人物小传": "他是长子。",
    })
    expect(written).toEqual([`${personaSkillResearchDirectory(projectPath, "林清越")}/人物小传.md`])
    expect([...io.files.keys()].some((path) => path.includes("escape"))).toBe(false)
    for (const path of io.files.keys()) {
      expect(isPathInside(path, personaSkillRoot(projectPath))).toBe(true)
    }
  })

  it("老索引缺少 hasResearch 字段时按「已有研究文件」处理，不重写累积内容", async () => {
    const legacy: Record<string, unknown> = { ...meta("林清越") }
    delete legacy.hasResearch
    io.files.set(personaSkillIndexPath(projectPath), JSON.stringify({ version: 1, skills: [legacy] }))
    expect((await loadPersonaSkillIndex(projectPath)).skills[0].hasResearch).toBe(true)

    io.files.set(
      personaSkillIndexPath(projectPath),
      JSON.stringify({ version: 1, skills: [{ ...meta("甲"), hasResearch: false }] }),
    )
    expect((await loadPersonaSkillIndex(projectPath)).skills[0].hasResearch).toBe(false)
  })

  it("tier 按定位重算，不把拼错的档位升级成 major", async () => {
    io.files.set(
      personaSkillIndexPath(projectPath),
      JSON.stringify({
        version: 1,
        skills: [{ ...meta("路人甲"), roleType: "配角", tier: "major" }],
      }),
    )
    expect((await loadPersonaSkillIndex(projectPath)).skills[0].tier).toBe("minor")

    io.files.set(
      personaSkillIndexPath(projectPath),
      JSON.stringify({
        version: 1,
        skills: [{ ...meta("师父"), roleType: "配角", tier: "minor", pinned: true }],
      }),
    )
    expect((await loadPersonaSkillIndex(projectPath)).skills[0].tier).toBe("major")
  })

  it("锁键把指向同一目录的写法归一成同一把锁", () => {
    expect(personaSkillLockKey("C:/p/")).toBe(personaSkillLockKey("C:/p"))
    expect(personaSkillLockKey("C:\\p")).toBe(personaSkillLockKey("C:/p"))
    // Windows 盘符大小写不敏感
    expect(personaSkillLockKey("c:/p")).toBe(personaSkillLockKey("C:/p"))
    // 不同目录仍必须是不同的锁（不要过度归一）
    expect(personaSkillLockKey("C:/p")).not.toBe(personaSkillLockKey("C:/q"))
  })

  it("索引与候选池共用同一把锁，跨文件读改写不交错", async () => {
    const order: string[] = []
    const holding = withPersonaSkillLock(personaSkillLockKey("C:/p"), async () => {
      order.push("first:start")
      await new Promise((resolve) => setTimeout(resolve, 5))
      order.push("first:end")
    })
    const sightings = updatePersonaSightings("C:/p", (current) => {
      order.push("sightings:mutate")
      return { version: 1, sightings: [...current.sightings, sighting("甲")] }
    })
    await Promise.all([holding, sightings])
    expect(order).toEqual(["first:start", "first:end", "sightings:mutate"])
  })

  it("updatePersonaSkillState 在同一把锁里完成「建档 + 从候选池移走」", async () => {
    await savePersonaSightings(projectPath, { version: 1, sightings: [sighting("林清越")] })

    const state = await updatePersonaSkillState(projectPath, (current) => ({
      index: { version: 1, skills: [...current.index.skills, meta("林清越")] },
      sightings: {
        version: 1,
        sightings: current.sightings.sightings.filter((item) => item.characterName !== "林清越"),
      },
    }))

    expect(state.index.skills.map((item) => item.characterName)).toEqual(["林清越"])
    expect(state.sightings.sightings).toEqual([])
    expect((await loadPersonaSkillIndex(projectPath)).skills.map((item) => item.characterName)).toEqual([
      "林清越",
    ])
    expect((await loadPersonaSightings(projectPath)).sightings).toEqual([])
  })

  it("updatePersonaSkillState 只返回 sightings 时不重写索引", async () => {
    await savePersonaSkillIndex(projectPath, { version: 1, skills: [meta("林清越")] })
    const before = io.files.get(personaSkillIndexPath(projectPath))
    io.writes.length = 0

    const state = await updatePersonaSkillState(projectPath, (current) => ({
      sightings: { version: 1, sightings: [...current.sightings.sightings, sighting("路人甲")] },
    }))

    // 内容恰好没变不算证据：要证明索引文件这一次压根没被写。
    expect(io.writes).toEqual([personaSkillSightingsPath(projectPath)])
    expect(io.files.get(personaSkillIndexPath(projectPath))).toBe(before)
    expect(state.index.skills.map((item) => item.characterName)).toEqual(["林清越"])
    expect((await loadPersonaSightings(projectPath)).sightings.map((item) => item.characterName)).toEqual([
      "路人甲",
    ])
  })

  it("updatePersonaSkillState 返回 undefined 或空对象时不落盘", async () => {
    await updatePersonaSkillState(projectPath, () => {})
    expect(io.writes).toEqual([])

    await updatePersonaSkillState(projectPath, () => ({}))
    expect(io.writes).toEqual([])
    expect(io.files.has(personaSkillIndexPath(projectPath))).toBe(false)
    expect(io.files.has(personaSkillSightingsPath(projectPath))).toBe(false)
  })

  it("updatePersonaSkillState 的索引读用严格版：索引坏了两份都不写", async () => {
    silenceWarns()
    const path = personaSkillIndexPath(projectPath)
    const broken = "{ 坏索引"
    io.files.set(path, broken)

    await expect(
      updatePersonaSkillState(projectPath, (current) => ({
        sightings: { version: 1, sightings: [...current.sightings.sightings, sighting("甲")] },
      })),
    ).rejects.toThrow(/已停止写入/)
    expect(io.files.get(path)).toBe(broken)
    expect(io.files.has(personaSkillSightingsPath(projectPath))).toBe(false)
  })
})
