import { beforeEach, describe, expect, it, vi } from "vitest"

const readFileMock = vi.hoisted(() => vi.fn())
const writeFileAtomicMock = vi.hoisted(() => vi.fn())
const joinMock = vi.hoisted(() => vi.fn(async (...parts: string[]) => parts.join("/")))

vi.mock("@/commands/fs", () => ({
  readFile: readFileMock,
  writeFileAtomic: writeFileAtomicMock,
}))

vi.mock("@tauri-apps/api/path", () => ({
  join: joinMock,
}))

import {
  createBlankWritingSkill,
  deleteWritingSkill,
  loadUserSkillConfig,
  normalizeUserSkillConfig,
  ensureBuiltinSkills,
  resolveEnabledWritingSkills,
  saveUserSkillConfig,
  setWritingSkillEnabled,
  updateWritingSkill,
  USER_SKILL_CONFIG_FILE,
} from "./user-skill-store"
import { SKILL_ROUTE_CATEGORY_IDS } from "./skill-route"
import { DEFAULT_BUILTIN_WRITING_SKILLS } from "./skill-seed"

describe("user-skill-store", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("normalizes writing skill config and drops invalid skills", () => {
    const config = normalizeUserSkillConfig({
      selectedSkillId: "skill:three",
      disabledSkillIds: ["skill:hidden", "skill:hidden", ""],
      skills: [
        {
          id: "skill:three",
          name: "三翻四抖",
          description: "三次转折，四次震惊。",
          kind: ["structure", "planning", "structure", "bad"],
          stages: ["planning", "drafting"],
          modes: ["standard", "strict"],
          content: "每章设置三次局势变化和四次信息冲击。",
          source: "uploaded",
        },
        {
          id: "skill:empty",
          name: "",
          content: "没有名称",
        },
        {
          id: "skill:no-content",
          name: "空正文",
          content: "",
        },
      ],
    })

    expect(config).toMatchObject({
      version: 1,
      selectedSkillId: "skill:three",
      disabledSkillIds: ["skill:hidden"],
    })
    expect(config.skills).toHaveLength(1)
    expect(config.skills[0]).toMatchObject({
      id: "skill:three",
      name: "三翻四抖",
      kind: ["structure", "planning"],
      stages: ["planning", "drafting"],
      modes: ["standard", "strict"],
      source: "uploaded",
    })
  })

  it("creates, updates, disables, resolves and deletes project writing skills", () => {
    const created = createBlankWritingSkill(normalizeUserSkillConfig(null), 1234)
    expect(created.selectedSkillId).toBe("skill:1234")
    expect(created.skills[0]).toMatchObject({
      id: "skill:1234",
      name: "新建写作 Skill",
      kind: ["structure", "planning"],
      stages: ["planning", "drafting"],
      modes: ["standard", "strict"],
      source: "uploaded",
    })

    const updated = updateWritingSkill(created, "skill:1234", {
      name: "三翻四抖",
      description: "三次转折，四次震惊。",
      kind: ["structure", "planning"],
      stages: ["planning", "drafting"],
      modes: ["standard", "strict"],
      content: "每章设置三次局势变化和四次信息冲击。",
    }, 5678)
    expect(updated.skills[0]).toMatchObject({
      name: "三翻四抖",
      updatedAt: 5678,
    })

    const disabled = setWritingSkillEnabled(updated, "skill:1234", false)
    expect(resolveEnabledWritingSkills(disabled)).toEqual([])

    const enabled = setWritingSkillEnabled(disabled, "skill:1234", true)
    expect(resolveEnabledWritingSkills(enabled)).toHaveLength(1)

    const deleted = deleteWritingSkill(enabled, "skill:1234")
    expect(deleted.skills).toEqual([])
    expect(deleted.selectedSkillId).toBeNull()
  })

  it("loads missing config as empty and saves normalized JSON", async () => {
    readFileMock.mockRejectedValueOnce(new Error("missing"))
    const loaded = await loadUserSkillConfig("C:/project")
    expect(loaded.skills.length).toBeGreaterThanOrEqual(10)
    expect(loaded.skills[0].source).toBe("built-in")
    expect(loaded.selectedSkillId).toBeTruthy()
    expect(joinMock).toHaveBeenCalledWith("C:/project", USER_SKILL_CONFIG_FILE)

    const config = createBlankWritingSkill(loaded, 1234)
    await saveUserSkillConfig("C:/project", config)

    expect(writeFileAtomicMock).toHaveBeenCalledWith(
      `C:/project/${USER_SKILL_CONFIG_FILE}`,
      JSON.stringify(config, null, 2),
    )
  })
})
it("ensureBuiltinSkills adds missing built-in skills to empty config", () => {
  const config = normalizeUserSkillConfig(null)
  const result = ensureBuiltinSkills(config)

  expect(result.skills.length).toBeGreaterThanOrEqual(10)
  expect(result.categories.map((category) => category.name)).toEqual([
    "正文",
    "大纲",
    "设定",
    "角色",
    "世界观",
    "势力",
    "伏笔",
    "地图",
    "题材",
  ])
  const builtinSkills = result.skills.filter((s) => s.source === "built-in")
  expect(builtinSkills.length).toBeGreaterThanOrEqual(10)
  const names = builtinSkills.map((s) => s.name)
  expect(names).toContain("章节承接")
  expect(names).toContain("下一章计划")
  expect(names).toContain("主线检查")
  expect(names).toContain("人物动机")
  expect(names).toContain("冲突升级")
  expect(names).toContain("伏笔管理")
  expect(names).toContain("节奏检查")
  expect(names).toContain("结尾钩子")
  expect(names).toContain("剧情自检")
  expect(names).toContain("正文输出协议")
  expect(names).toContain("基础去AI味")
  expect(names).toContain("审稿返修")
  expect(names).toContain("返修后复审")
  expect(names).toContain("设定一致性")
  expect(names).toContain("势力结构")
  expect(names).toContain("地图推进")
  expect(result.skills.find((s) => s.name === "下一章计划")?.categoryId).toBe(SKILL_ROUTE_CATEGORY_IDS.outline)
  expect(result.skills.find((s) => s.name === "正文输出协议")?.categoryId).toBe(SKILL_ROUTE_CATEGORY_IDS.writing)
  expect(result.skills.find((s) => s.name === "人物动机")?.categoryId).toBe(SKILL_ROUTE_CATEGORY_IDS.character)
  expect(result.skills.find((s) => s.name === "世界观植入")?.categoryId).toBe(SKILL_ROUTE_CATEGORY_IDS.worldbuilding)
  expect(result.skills.find((s) => s.name === "伏笔管理")?.categoryId).toBe(SKILL_ROUTE_CATEGORY_IDS.foreshadowing)
  expect(result.skills.find((s) => s.name === "设定一致性")?.categoryId).toBe(SKILL_ROUTE_CATEGORY_IDS.setting)
  expect(result.skills.find((s) => s.name === "势力结构")?.categoryId).toBe(SKILL_ROUTE_CATEGORY_IDS.faction)
  expect(result.skills.find((s) => s.name === "地图推进")?.categoryId).toBe(SKILL_ROUTE_CATEGORY_IDS.map)
})

it("keeps existing built-in IDs stable while adding new writing skills", () => {
  const result = ensureBuiltinSkills(normalizeUserSkillConfig(null))
  const builtinIds = result.skills.filter((s) => s.source === "built-in").map((s) => s.id)

  expect(builtinIds).toEqual(expect.arrayContaining([
    "builtin:chapter-connection",
    "builtin:next-chapter-plan",
    "builtin:mainline-check",
    "builtin:character-motivation",
    "builtin:conflict-escalation",
    "builtin:foreshadowing-management",
    "builtin:rhythm-check",
    "builtin:ending-hook",
    "builtin:plot-self-check",
    "builtin:output-protocol",
    "builtin:basic-de-ai",
    "builtin:review-revision",
    "builtin:post-revision-review",
  ]))
})

it("ensureBuiltinSkills preserves uploaded skills when inserting new built-ins", () => {
  const result = ensureBuiltinSkills(normalizeUserSkillConfig({
    selectedSkillId: "skill:uploaded",
    disabledSkillIds: [],
    skills: [{
      id: "skill:uploaded",
      name: "项目专用节奏",
      description: "只服务当前项目。",
      kind: ["structure"],
      stages: ["planning", "drafting"],
      modes: ["standard", "strict"],
      content: "保留项目自定义节奏规则。",
      source: "uploaded",
    }],
  }))

  expect(result.selectedSkillId).toBe("skill:uploaded")
  expect(result.skills.find((s) => s.id === "skill:uploaded")).toMatchObject({
    name: "项目专用节奏",
    source: "uploaded",
  })
  expect(result.skills.map((s) => s.name)).toEqual(expect.arrayContaining([
    "基础去AI味",
    "审稿返修",
    "返修后复审",
    "项目专用节奏",
  ]))
})

it("ensureBuiltinSkills does not add duplicates if built-in skills already exist", () => {
  const config = normalizeUserSkillConfig(null)
  const once = ensureBuiltinSkills(config)
  const twice = ensureBuiltinSkills(once)

  const onceBuiltinCount = once.skills.filter((s) => s.source === "built-in").length
  const twiceBuiltinCount = twice.skills.filter((s) => s.source === "built-in").length
  expect(onceBuiltinCount).toBe(twiceBuiltinCount)
  expect(twice.skills.length).toBe(once.skills.length)
})

it("deleteWritingSkill refuses to delete built-in skills", () => {
  const config = ensureBuiltinSkills(normalizeUserSkillConfig(null))
  const builtinSkill = config.skills.find((s) => s.source === "built-in")
  expect(builtinSkill).toBeDefined()

  const result = deleteWritingSkill(config, builtinSkill!.id)

  const stillExists = result.skills.find((s) => s.id === builtinSkill!.id)
  expect(stillExists).toBeDefined()
  expect(result.skills.length).toBe(config.skills.length)
})

  it("loadUserSkillConfig auto-seeds built-in skills for missing config", async () => {
  readFileMock.mockRejectedValueOnce(new Error("missing"))
  const config = await loadUserSkillConfig("C:/project")
  expect(config.skills.length).toBeGreaterThanOrEqual(10)
  expect(config.skills[0].source).toBe("built-in")
 })

describe("内置技能内容使用真换行", () => {
  // 这三处的 join 曾写成 join("\\n")（双反斜杠），产出的是字面量「反斜杠+n」而不是换行，
  // 经 buildSelectedSkillsPrompt 原样渲染后会压成一行夹着杂字符，提示词可读性与遵守率都会掉。
  const seeded = ["基础去AI味", "审稿返修", "返修后复审"]

  it("三条规则各自换行，不再夹字面量反斜杠 n", () => {
    for (const name of seeded) {
      const skill = DEFAULT_BUILTIN_WRITING_SKILLS.find((item) => item.name === name)
      expect(skill, `没有内置技能 ${name}`).toBeDefined()
      expect(skill!.content).toContain("\n")
      expect(skill!.content).not.toContain("\\n")
      expect(skill!.content.split("\n").length).toBeGreaterThan(1)
    }
  })
})
