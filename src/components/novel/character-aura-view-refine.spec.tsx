// @vitest-environment jsdom
//
// 回归：角色灵魂页的「绑定小说人物」下拉框必须先用本地/缓存名单立即渲染，
// LLM 精修只能在后台补充名字；同时过滤掉「冲突点」这类不是人名的噪声条目，
// 但已经绑定过的角色无论如何都要留在下拉框里（alwaysKeep 安全阀）。

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import "@/i18n"
import { BUILT_IN_CHARACTER_AURAS } from "@/lib/novel/character-aura"
import { useWikiStore } from "@/stores/wiki-store"
import { CharacterAuraView } from "./character-aura-view"

const auraMocks = vi.hoisted(() => ({
  bindCharacterAura: vi.fn(),
  buildCharacterAuraContext: vi.fn(),
  createCustomCharacterAuraSkill: vi.fn(),
  deleteCustomCharacterAura: vi.fn(),
  getCharacterAuraBindings: vi.fn(),
  listBindableNovelCharacters: vi.fn(),
  listBindableNovelCharactersLocal: vi.fn(),
  listCharacterAuras: vi.fn(),
  loadCharacterAuraResearchDocument: vi.fn(),
  loadCharacterAuraSkillDocument: vi.fn(),
  refineBindableCharactersWithLlm: vi.fn(),
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
    listBindableNovelCharacters: auraMocks.listBindableNovelCharacters,
    listBindableNovelCharactersLocal: auraMocks.listBindableNovelCharactersLocal,
    listCharacterAuras: auraMocks.listCharacterAuras,
    loadCharacterAuraResearchDocument: auraMocks.loadCharacterAuraResearchDocument,
    loadCharacterAuraSkillDocument: auraMocks.loadCharacterAuraSkillDocument,
    refineBindableCharactersWithLlm: auraMocks.refineBindableCharactersWithLlm,
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
const PROJECT_PATH_B = "/proj-b"
const CHARACTER_OPTIONS_LOADING_TEXT = "正在读取小说人物"
const CHARACTER_OPTIONS_EMPTY_TEXT = "请先添加小说人物"

let host: HTMLDivElement
let root: Root

function useProject() {
  return { id: "proj-1", name: "proj", path: PROJECT_PATH }
}

async function flush() {
  await act(async () => {
    for (let index = 0; index < 10; index += 1) {
      await Promise.resolve()
    }
  })
}

function neverResolves<T>() {
  return new Promise<T>(() => {})
}

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function optionValues(): string[] {
  const select = host.querySelector('select[aria-label="绑定小说人物"]')
  return Array.from(select?.querySelectorAll("option") ?? []).map((option) => option.getAttribute("value") ?? "")
}

function selectBindCharacter(name: string) {
  const select = host.querySelector('select[aria-label="绑定小说人物"]')
  if (!(select instanceof HTMLSelectElement)) throw new Error("绑定小说人物下拉框不存在")
  const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set
  if (!setValue) throw new Error("select value setter not found")
  setValue.call(select, name)
  select.dispatchEvent(new Event("change", { bubbles: true }))
}

function clickButton(label: string) {
  const button = Array.from(host.querySelectorAll("button")).find((node) => node.textContent?.trim() === label)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`按钮不存在：${label}`)
  button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
}

describe("角色灵魂页绑定人物名单的后台精修与过滤", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    auraMocks.listCharacterAuras.mockResolvedValue(BUILT_IN_CHARACTER_AURAS)
    auraMocks.listBindableNovelCharacters.mockResolvedValue([])
    auraMocks.listBindableNovelCharactersLocal.mockResolvedValue([])
    // 默认精修永不返回：任何用例里出现名单都只能来自本地/缓存这条快线。
    auraMocks.refineBindableCharactersWithLlm.mockImplementation(() => neverResolves<string[]>())
    auraMocks.getCharacterAuraBindings.mockResolvedValue([])
    auraMocks.bindCharacterAura.mockResolvedValue({ customAuras: [], bindings: [] })
    auraMocks.unbindCharacterAura.mockResolvedValue({ customAuras: [], bindings: [] })
    auraMocks.loadCharacterAuraSkillDocument.mockResolvedValue("")
    auraMocks.loadCharacterAuraResearchDocument.mockResolvedValue("")
    filterMocks.readBindableIgnoreList.mockResolvedValue([])
    useWikiStore.setState({
      project: useProject(),
      selectedSoulId: BUILT_IN_CHARACTER_AURAS[0].id,
      selectedSoulSection: "builtIn",
      selectedSoulTab: "character",
      dataVersion: 0,
    })
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    host.remove()
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })

  it("加载后在后台调用精修，且不等它返回就已经渲染本地名单", async () => {
    auraMocks.listBindableNovelCharacters.mockResolvedValue(["杨墨"])
    const refinement = deferred<string[]>()
    auraMocks.refineBindableCharactersWithLlm.mockImplementation(() => refinement.promise)

    await act(async () => {
      root.render(<CharacterAuraView hideSidebar />)
    })
    await flush()

    expect(auraMocks.refineBindableCharactersWithLlm).toHaveBeenCalledTimes(1)
    expect(auraMocks.refineBindableCharactersWithLlm).toHaveBeenCalledWith(PROJECT_PATH)
    // 精修还挂着没返回，本地名单必须已经可用。
    expect(optionValues()).toContain("杨墨")

    await act(async () => {
      refinement.resolve(["杨墨"])
    })
    await flush()
  })

  it("精修返回的新名字会并入可选人物列表", async () => {
    auraMocks.listBindableNovelCharacters.mockResolvedValue(["杨墨"])
    const refinement = deferred<string[]>()
    auraMocks.refineBindableCharactersWithLlm.mockImplementation(() => refinement.promise)

    await act(async () => {
      root.render(<CharacterAuraView hideSidebar />)
    })
    await flush()
    expect(optionValues()).toContain("杨墨")
    expect(optionValues()).not.toContain("林小满")

    await act(async () => {
      refinement.resolve(["杨墨", "林小满"])
    })
    await flush()

    const values = optionValues()
    expect(values).toContain("杨墨")
    expect(values).toContain("林小满")
    // 保序去重：本地名字在前，精修新增的名字在后，同一个名字只出现一次。
    expect(values.filter((value) => value === "杨墨")).toHaveLength(1)
    expect(values.indexOf("杨墨")).toBeLessThan(values.indexOf("林小满"))
  })

  it("精修进行中时加载提示已经消失（本地结果已可用）", async () => {
    const refinement = deferred<string[]>()
    auraMocks.listBindableNovelCharacters.mockResolvedValue([])
    auraMocks.refineBindableCharactersWithLlm.mockImplementation(() => refinement.promise)

    await act(async () => {
      root.render(<CharacterAuraView hideSidebar />)
    })
    await flush()

    expect(auraMocks.refineBindableCharactersWithLlm).toHaveBeenCalledTimes(1)
    expect(host.textContent).not.toContain(CHARACTER_OPTIONS_LOADING_TEXT)
    expect(host.textContent).toContain(CHARACTER_OPTIONS_EMPTY_TEXT)

    await act(async () => {
      refinement.resolve([])
    })
    await flush()
  })

  it("精修抛错或永不返回时，可选人物列表与已选状态保持不变，且不显示错误", async () => {
    const targetAura = BUILT_IN_CHARACTER_AURAS[0]
    auraMocks.listCharacterAuras.mockResolvedValue(BUILT_IN_CHARACTER_AURAS)
    auraMocks.listBindableNovelCharacters.mockResolvedValue(["杨墨"])

    const assertUnchanged = () => {
      expect(optionValues()).toContain("杨墨")
      expect(host.querySelector("h2")?.textContent).toBe(targetAura.name)
      expect(useWikiStore.getState().selectedSoulId).toBe(targetAura.id)
      const status = host.querySelector('[role="status"]')
      expect(status?.textContent ?? "").toBe("")
      expect(host.textContent).not.toContain("精修失败")
    }

    // 第一种：精修直接抛错。
    auraMocks.refineBindableCharactersWithLlm.mockRejectedValue(new Error("精修失败"))
    await act(async () => {
      root.render(<CharacterAuraView hideSidebar />)
    })
    await flush()
    await flush()
    expect(auraMocks.refineBindableCharactersWithLlm).toHaveBeenCalledTimes(1)
    assertUnchanged()

    // 第二种：精修永不返回。
    await act(async () => {
      root.unmount()
    })
    host.remove()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    auraMocks.refineBindableCharactersWithLlm.mockClear()
    auraMocks.refineBindableCharactersWithLlm.mockImplementation(() => neverResolves<string[]>())
    await act(async () => {
      root.render(<CharacterAuraView hideSidebar />)
    })
    await flush()
    expect(auraMocks.refineBindableCharactersWithLlm).toHaveBeenCalledTimes(1)
    assertUnchanged()
  })

  it("已绑定的人物即使命中忽略规则也仍然出现在下拉选项里", async () => {
    const targetAura = BUILT_IN_CHARACTER_AURAS[0]
    auraMocks.listBindableNovelCharacters.mockResolvedValue(["杨墨"])
    auraMocks.getCharacterAuraBindings.mockResolvedValue([{ characterName: "杨墨", auraId: targetAura.id }])
    filterMocks.readBindableIgnoreList.mockResolvedValue(["杨墨"])

    await act(async () => {
      root.render(<CharacterAuraView hideSidebar />)
    })
    await flush()

    expect(filterMocks.readBindableIgnoreList).toHaveBeenCalledWith(PROJECT_PATH)
    expect(host.textContent).toContain("已绑定杨墨")
    expect(optionValues()).toContain("杨墨")
  })

  it("命中规则且未被绑定的名字（如「冲突点」）不出现在下拉选项里", async () => {
    auraMocks.listBindableNovelCharacters.mockResolvedValue(["杨墨", "冲突点", "编号派通用手段"])

    await act(async () => {
      root.render(<CharacterAuraView hideSidebar />)
    })
    await flush()

    const values = optionValues()
    expect(values).toContain("杨墨")
    expect(values).not.toContain("冲突点")
    expect(values).not.toContain("编号派通用手段")
  })

  it("项目切换后迟到的精修结果不会污染新项目的列表", async () => {
    const localByPath: Record<string, string[]> = {
      [PROJECT_PATH]: ["甲"],
      [PROJECT_PATH_B]: ["乙"],
    }
    const refinements = new Map<string, Deferred<string[]>>()
    auraMocks.listBindableNovelCharacters.mockImplementation((path: string) => Promise.resolve(localByPath[path] ?? []))
    auraMocks.refineBindableCharactersWithLlm.mockImplementation((path: string) => {
      const pending = deferred<string[]>()
      refinements.set(path, pending)
      return pending.promise
    })

    await act(async () => {
      root.render(<CharacterAuraView hideSidebar />)
    })
    await flush()
    expect(optionValues()).toContain("甲")
    expect(refinements.has(PROJECT_PATH)).toBe(true)

    await act(async () => {
      useWikiStore.setState({ project: { id: "proj-2", name: "proj-b", path: PROJECT_PATH_B } })
    })
    await flush()
    expect(refinements.has(PROJECT_PATH_B)).toBe(true)
    expect(optionValues()).toContain("乙")

    // 旧项目的精修此刻才返回，必须被丢弃。
    await act(async () => {
      refinements.get(PROJECT_PATH)?.resolve(["甲的精修发现"])
    })
    await flush()

    const values = optionValues()
    expect(values).not.toContain("甲的精修发现")
    expect(values).not.toContain("甲")
    expect(values).toContain("乙")
  })

  it("同一项目不会并发触发两次精修", async () => {
    auraMocks.listBindableNovelCharacters.mockResolvedValue(["杨墨"])
    const refinement = deferred<string[]>()
    auraMocks.refineBindableCharactersWithLlm.mockImplementation(() => refinement.promise)

    await act(async () => {
      root.render(<CharacterAuraView hideSidebar />)
    })
    await flush()
    expect(auraMocks.listBindableNovelCharacters).toHaveBeenCalledTimes(1)
    expect(auraMocks.refineBindableCharactersWithLlm).toHaveBeenCalledTimes(1)

    // 绑定成功后会重新走一遍 refresh()，同一项目此时精修仍在飞行中。
    await act(async () => {
      selectBindCharacter("杨墨")
    })
    await flush()
    await act(async () => {
      clickButton("绑定")
    })
    await flush()
    await flush()

    expect(auraMocks.listBindableNovelCharacters).toHaveBeenCalledTimes(2)
    expect(auraMocks.refineBindableCharactersWithLlm).toHaveBeenCalledTimes(1)
  })
})
