import { beforeEach, describe, expect, it, vi } from "vitest"

const io = vi.hoisted(() => ({ files: new Map<string, string>() }))

vi.mock("@/commands/fs", () => ({
  readFile: async (path: string) => {
    if (!io.files.has(path)) throw new Error(`文件缺失：${path}`)
    return io.files.get(path)!
  },
  writeFileAtomic: async (path: string, contents: string) => {
    io.files.set(path, contents)
  },
  createDirectory: async () => {},
  listDirectory: async () => [],
  fileExists: async (path: string) => io.files.has(path),
  deleteFile: async () => {},
}))

import { collectOutlineCharacterNames, runPersonaSyncSafely, syncPersonaFromOutlineSave } from "./persona-outline-sync"
import type { PersonaSkillMeta } from "./persona-skill-types"
import type { OutlineSaveRequest } from "./outline-save-request"

const project = "C:/project"
const indexFile = `${project}/.qmai/persona-skills/index.json`

function meta(characterName: string): PersonaSkillMeta {
  return {
    id: characterName, characterName, aliases: [], roleType: "", tier: "minor", pinned: false,
    status: "active", firstChapter: 0, lastChapter: 0, appearanceCount: 1, createdChapter: 0,
    lastLearnedChapter: 0, skillRevision: 1, editedByUser: false, hasResearch: false,
    updatedAt: "2026-10-10T00:00:00.000Z", origin: "auto", outlineRefs: [], asOfChapter: null,
  }
}

function req(partial: Partial<OutlineSaveRequest>): OutlineSaveRequest {
  return {
    targetFolder: "章纲", fileName: "章纲-第3章.md", fileType: "chapter-outline",
    writeMode: "create", referencedSkills: [], sourceIntent: "", content: "",
    ...partial,
  }
}

function castTable(...names: string[]): string {
  return [
    "## §13 出场角色与状态变化",
    "",
    "| 角色 | 本章作用 | 入场状态 | 结束状态 | 关系变化 |",
    "| --- | --- | --- | --- | --- |",
    ...names.map((name) => `| ${name} | 主线推进 | 潜伏 | 现身 | 与主角决裂 |`),
  ].join("\n")
}

describe("collectOutlineCharacterNames", () => {
  it("从章纲 §13 出场角色表抽名字", () => {
    expect(collectOutlineCharacterNames([req({ content: castTable("林清越", "沈砚") })])).toEqual(["林清越", "沈砚"])
  })

  it("从角色草稿抽名字", () => {
    const requests = [req({ targetFolder: "人物小传", fileName: "陆云飞.md", fileType: "character", content: "# 陆云飞\n" })]
    expect(collectOutlineCharacterNames(requests)).toEqual(["陆云飞"])
  })

  it("从人物小传 MD 的文件名抽名字", () => {
    const requests = [req({ targetFolder: "人物小传", fileName: "苏晚.md", fileType: "outline", content: "# 苏晚\n" })]
    expect(collectOutlineCharacterNames(requests)).toEqual(["苏晚"])
  })

  it("从卷纲 structuredData 的 roles 里抽名字", () => {
    const structuredData = JSON.stringify({ volumes: [{ n: 1, roles: [{ name: "顾长明" }, { name: "谢无咎" }] }] })
    expect(collectOutlineCharacterNames([
      req({ targetFolder: "卷纲", fileType: "volume-outline", fileName: "卷纲-第一卷.md", structuredData }),
    ])).toEqual(["顾长明", "谢无咎"])
  })

  it("去重、去空、去表头，保持首次出现顺序", () => {
    const content = [
      "| 角色 | 本章作用 | 入场状态 | 结束状态 | 关系变化 |",
      "| --- | --- | --- | --- | --- |",
      "| 林清越 | a | b | c | d |",
      "| 林清越 | a | b | c | d |",
      "|  | a | b | c | d |",
    ].join("\n")
    expect(collectOutlineCharacterNames([req({ content })])).toEqual(["林清越"])
  })

  it("structuredData 不是合法 JSON 时不抛", () => {
    expect(() => collectOutlineCharacterNames([req({ structuredData: "{坏 JSON" })])).not.toThrow()
  })
})

describe("syncPersonaFromOutlineSave", () => {
  // 每个用例一个干净项目：io.files 是模块级 Map，不清理会把上一个用例建档的角色带过来。
  beforeEach(() => io.files.clear())

  it("新角色建档，已存在角色只追加 outlineRefs，不重写正文", () => {
    io.files.set(indexFile, JSON.stringify({ version: 1, skills: [meta("林清越")] }))
    io.files.set(`${project}/.qmai/persona-skills/林清越/SKILL.md`, "# 林清越 · 人物 Skill\n\n## 怎么说话\n\n短句。\n")
    const before = io.files.get(`${project}/.qmai/persona-skills/林清越/SKILL.md`)

    return syncPersonaFromOutlineSave({
      projectPath: project, outlineFileName: "卷纲-第一卷.md",
      requests: [req({ content: castTable("林清越", "沈砚") })], llmConfig: null,
    }).then(() => {
      expect(io.files.get(`${project}/.qmai/persona-skills/林清越/SKILL.md`)).toBe(before)
      const skills = JSON.parse(io.files.get(indexFile)!).skills
      expect(skills.find((s: { characterName: string }) => s.characterName === "林清越").outlineRefs).toEqual(["卷纲-第一卷.md"])
      expect(skills.find((s: { characterName: string }) => s.characterName === "沈砚").origin).toBe("auto")
    })
  })

  it("幂等：同一份请求跑两次，不重复建档、outlineRefs 不重复", async () => {
    const input = { projectPath: project, outlineFileName: "章纲-第3章.md", requests: [req({ content: castTable("林清越") })], llmConfig: null }
    await syncPersonaFromOutlineSave(input)
    await syncPersonaFromOutlineSave(input)
    const skills = JSON.parse(io.files.get(indexFile)!).skills.filter((s: { characterName: string }) => s.characterName === "林清越")
    expect(skills).toHaveLength(1)
    expect(skills[0].outlineRefs).toEqual(["章纲-第3章.md"])
  })

  it("不覆盖用户手写的小传文件", async () => {
    io.files.set(`${project}/wiki/outlines/人物小传/林清越.md`, "# 用户手写的\n")
    await syncPersonaFromOutlineSave({ projectPath: project, outlineFileName: "卷纲-第一卷.md", requests: [req({ content: castTable("林清越") })], llmConfig: null })
    expect(io.files.get(`${project}/wiki/outlines/人物小传/林清越.md`)).toBe("# 用户手写的\n")
  })

  it("新角色建档后生成投影 MD", async () => {
    await syncPersonaFromOutlineSave({ projectPath: project, outlineFileName: "卷纲-第一卷.md", requests: [req({ content: castTable("陆云飞") })], llmConfig: null })
    expect(io.files.get(`${project}/wiki/outlines/人物小传/陆云飞.md`)).toContain("generated-from: persona-skill")
  })

  it("runPersonaSyncSafely 永不抛，失败只 warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(runPersonaSyncSafely(async () => { throw new Error("model down") }, "同步人物小传")).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("新角色建档后自动开启自进化", async () => {
    await syncPersonaFromOutlineSave({
      projectPath: project, outlineFileName: "卷纲-第一卷.md",
      requests: [req({ content: castTable("陆云飞") })], llmConfig: null,
    })
    const state = JSON.parse(io.files.get(`${project}/.qmai/persona-skill-evolution.json`) ?? "null")
    expect(state.enabled).toBe(true)
  })

  it("用户已关掉自进化时，抓新角色不会擅自打开", async () => {
    io.files.set(`${project}/.qmai/persona-skill-evolution.json`, JSON.stringify({ version: 1, enabled: false, rounds: [] }))
    await syncPersonaFromOutlineSave({
      projectPath: project, outlineFileName: "卷纲-第一卷.md",
      requests: [req({ content: castTable("陆云飞") })], llmConfig: null,
    })
    const state = JSON.parse(io.files.get(`${project}/.qmai/persona-skill-evolution.json`)!)
    expect(state.enabled).toBe(false)
  })
})