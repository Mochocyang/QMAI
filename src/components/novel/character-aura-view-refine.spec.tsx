// @vitest-environment jsdom
//
// 「绑定小说人物」下拉框的数据来源改造（feature/soul-bind-from-outline）。
//
// 旧行为用正则从大纲正文里抓人名、再让模型补猜，于是「冲突点」「编号派通用手段」
// 这类不是人名的噪声会混进下拉框。新行为只认两处确定来源：
//   1. 人物档案 .qmai/persona-skills/index.json（带角色定位与别名）
//   2. 人物小传页里的一级人物小节
// 这里锁住三件事：只显示结构化来源、下拉里能看出数据完整度、已绑定的人永不被过滤掉。

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import "@/i18n"
import { BUILT_IN_CHARACTER_AURAS, type BindableNovelCharacter } from "@/lib/novel/character-aura"
import { useWikiStore } from "@/stores/wiki-store"
import { CharacterAuraView } from "./character-aura-view"

const auraMocks = vi.hoisted(() => ({
  bindCharacterAura: vi.fn(),
  buildCharacterAuraContext: vi.fn(),
  createCustomCharacterAuraSkill: vi.fn(),
  deleteCustomCharacterAura: vi.fn(),
  getCharacterAuraBindings: vi.fn(),
  listBindableNovelCharactersStructured: vi.fn(),
  listCharacterAuras: vi.fn(),
  loadCharacterAuraResearchDocument: vi.fn(),
  loadCharacterAuraSkillDocument: vi.fn(),
  unbindCharacterAura: vi.fn(),
  updateCustomCharacterAura: vi.fn(),
}))

vi.mock("@/lib/novel/character-aura", async () => {
  const actual = await vi.importActual<typeof import("@/lib/novel/character-aura")>("@/lib/novel/character-aura")
  return {
    ...actual,
    bindCharacterAura: auraMocks.bindCharacterAura,
    buildCharacterAuraContext: auraMocks.buildCharacterAuraContext,
    createCustomCharacterAuraSkill: auraMocks.createCustomCharacterAuraSkill,
    deleteCustomCharacterAura: auraMocks.deleteCustomCharacterAura,
    getCharacterAuraBindings: auraMocks.getCharacterAuraBindings,
    listBindableNovelCharactersStructured: auraMocks.listBindableNovelCharactersStructured,
    listCharacterAuras: auraMocks.listCharacterAuras,
    loadCharacterAuraResearchDocument: auraMocks.loadCharacterAuraResearchDocument,
    loadCharacterAuraSkillDocument: auraMocks.loadCharacterAuraSkillDocument,
    unbindCharacterAura: auraMocks.unbindCharacterAura,
    updateCustomCharacterAura: auraMocks.updateCustomCharacterAura,
  }
})

// 只替换忽略表读取，保留真实的 filterBindableCharacters（纯函数，已被 lib 测试覆盖）。
const filterMocks = vi.hoisted(() => ({
  readBindableIgnoreList: vi.fn(),
}))

vi.mock("@/lib/novel/bindable-characters-filter", async () => {
  const actual = await vi.importActual<typeof import("@/lib/novel/bindable-characters-filter")>("@/lib/novel/bindable-characters-filter")
  return {
    ...actual,
    readBindableIgnoreList: filterMocks.readBindableIgnoreList,
  }
})

const PROJECT_PATH = "/proj"
const CHARACTER_OPTIONS_LOADING_TEXT = "正在读取小说人物"
const CHARACTER_OPTIONS_EMPTY_TEXT = "人物小传里还没有人物"

let host: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    for (let index = 0; index < 10; index += 1) {
      await Promise.resolve()
    }
  })
}

/** 造一条「活跃角色」：有档案，信息完整。 */
function archived(name: string, roleType = "主角"): BindableNovelCharacter {
  return { name, roleType, aliases: [], source: "archive", dormant: false }
}

/** 造一条「候选角色」：还没建档，只有名字与出场记录。 */
function outlineOnly(name: string): BindableNovelCharacter {
  return { name, roleType: "", aliases: [], source: "sighting", dormant: false }
}

function groupLabels(): string[] {
  const select = host.querySelector('select[aria-label="绑定小说人物"]')
  return Array.from(select?.querySelectorAll("optgroup") ?? []).map((group) => group.getAttribute("label") ?? "")
}

/** 某个分组里的人名顺序。 */
function optionsInGroup(label: string): string[] {
  const select = host.querySelector('select[aria-label="绑定小说人物"]')
  const group = Array.from(select?.querySelectorAll("optgroup") ?? []).find(
    (node) => node.getAttribute("label") === label,
  )
  return Array.from(group?.querySelectorAll("option") ?? [])
    .map((option) => option.getAttribute("value") ?? "")
    .filter((value) => value !== "")
}

function optionLabels(): string[] {
  const select = host.querySelector('select[aria-label="绑定小说人物"]')
  return Array.from(select?.querySelectorAll("option") ?? []).map((option) => option.textContent?.trim() ?? "")
}

function listedCharacterOptions(): string[] {
  const select = host.querySelector('select[aria-label="绑定小说人物"]')
  return Array.from(select?.querySelectorAll("option") ?? [])
    .map((option) => option.getAttribute("value") ?? "")
    .filter((value) => value !== "")
}

function selectBindCharacter(name: string) {
  const select = host.querySelector('select[aria-label="绑定小说人物"]')
  if (!(select instanceof HTMLSelectElement)) throw new Error("绑定小说人物下拉框不存在")
  const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set
  if (!setValue) throw new Error("select value setter not found")
  setValue.call(select, name)
  select.dispatchEvent(new Event("change", { bubbles: true }))
}

async function renderView(projectPath = PROJECT_PATH) {
  useWikiStore.setState({
    project: { id: "proj-1", name: "proj", path: projectPath },
    selectedSoulId: BUILT_IN_CHARACTER_AURAS[0].id,
    selectedSoulSection: "builtIn",
    selectedSoulTab: "character",
  })
  await act(async () => {
    root.render(<CharacterAuraView hideSidebar />)
  })
  await flush()
}

beforeEach(() => {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)

  auraMocks.listCharacterAuras.mockResolvedValue(BUILT_IN_CHARACTER_AURAS)
  auraMocks.getCharacterAuraBindings.mockResolvedValue([])
  auraMocks.loadCharacterAuraSkillDocument.mockResolvedValue("")
  auraMocks.loadCharacterAuraResearchDocument.mockResolvedValue("")
  auraMocks.listBindableNovelCharactersStructured.mockResolvedValue([])
  filterMocks.readBindableIgnoreList.mockResolvedValue([])
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.clearAllMocks()
})

describe("选择小说人物：只用人物档案与人物小传", () => {
  it("下拉框只列出结构化来源给的人名", async () => {
    auraMocks.listBindableNovelCharactersStructured.mockResolvedValue([archived("杨墨"), outlineOnly("李四")])
    await renderView()

    expect(listedCharacterOptions()).toEqual(["杨墨", "李四"])
  })

  it("下拉框按活跃角色、候选角色分两组，人名后面不再逐条加标记", async () => {
    auraMocks.listBindableNovelCharactersStructured.mockResolvedValue([archived("杨墨", "主角"), outlineOnly("李四")])
    await renderView()

    // 组名承担来源说明，人名本身保持干净。
    expect(groupLabels()).toEqual(["活跃角色", "候选角色"])
    expect(optionsInGroup("活跃角色")).toEqual(["杨墨"])
    expect(optionsInGroup("候选角色")).toEqual(["李四"])
    // 定位仍然显示在名字后面（括号里），但不再追加「· 候选角色」这类后缀。
    expect(optionLabels().some((label) => label === "杨墨（主角）")).toBe(true)
    expect(optionLabels().some((label) => label.includes("· 候选角色"))).toBe(false)
    expect(optionLabels().some((label) => label.includes("· 活跃角色"))).toBe(false)
  })

  it("活跃角色始终排在候选角色之前，即使数据里候选在前", async () => {
    auraMocks.listBindableNovelCharactersStructured.mockResolvedValue([
      outlineOnly("地下铁门守卫"),
      archived("杨寒", "主角"),
      outlineOnly("抱保温杯守卫"),
    ])
    await renderView()

    expect(groupLabels()).toEqual(["活跃角色", "候选角色"])
    expect(optionsInGroup("活跃角色")).toEqual(["杨寒"])
    expect(optionsInGroup("候选角色")).toEqual(["地下铁门守卫", "抱保温杯守卫"])
  })

  it("只有一个分组时，另一组不渲染空标题", async () => {
    auraMocks.listBindableNovelCharactersStructured.mockResolvedValue([outlineOnly("地下铁门守卫")])
    await renderView()

    expect(groupLabels()).toEqual(["候选角色"])
  })

  it("选中已建档人物时给出「信息完整」提示", async () => {
    auraMocks.listBindableNovelCharactersStructured.mockResolvedValue([archived("杨墨")])
    await renderView()

    await act(async () => selectBindCharacter("杨墨"))
    await flush()

    expect(host.querySelector('[data-ui="soul-bind-source-hint"]')?.textContent).toContain("信息完整")
  })

  it("选中候选角色时提示尚无档案", async () => {
    auraMocks.listBindableNovelCharactersStructured.mockResolvedValue([outlineOnly("李四")])
    await renderView()

    await act(async () => selectBindCharacter("李四"))
    await flush()

    expect(host.querySelector('[data-ui="soul-bind-source-hint"]')?.textContent).toContain("仅候选")
  })

  it("名单为空时提示去大纲添加人物小传，而不是让用户干等", async () => {
    auraMocks.listBindableNovelCharactersStructured.mockResolvedValue([])
    await renderView()

    expect(optionLabels().some((label) => label.includes(CHARACTER_OPTIONS_EMPTY_TEXT))).toBe(true)
  })

  it("名单读取中显示读取提示", async () => {
    auraMocks.listBindableNovelCharactersStructured.mockImplementation(() => new Promise<BindableNovelCharacter[]>(() => {}))
    await renderView()

    expect(optionLabels().some((label) => label.includes(CHARACTER_OPTIONS_LOADING_TEXT))).toBe(true)
  })

  it("已绑定的人物即使命中忽略规则也仍然出现在下拉选项里", async () => {
    auraMocks.listBindableNovelCharactersStructured.mockResolvedValue([archived("杨墨"), archived("冲突点")])
    auraMocks.getCharacterAuraBindings.mockResolvedValue([
      { characterName: "冲突点", auraId: BUILT_IN_CHARACTER_AURAS[0].id },
    ])
    // 忽略表里写着「冲突点」，但它是已绑定人物，安全阀必须留住它。
    filterMocks.readBindableIgnoreList.mockResolvedValue(["冲突点"])
    await renderView()

    expect(listedCharacterOptions()).toContain("冲突点")
  })

  it("命中忽略规则且未绑定的条目不出现在下拉里", async () => {
    auraMocks.listBindableNovelCharactersStructured.mockResolvedValue([archived("杨墨"), archived("冲突点")])
    filterMocks.readBindableIgnoreList.mockResolvedValue(["冲突点"])
    await renderView()

    expect(listedCharacterOptions()).toEqual(["杨墨"])
  })
})