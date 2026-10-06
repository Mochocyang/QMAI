// @vitest-environment jsdom
//
// 回归：灵魂列表的渲染不能挂在「扫描小说人物」这条慢链路上。
// 之前 refresh() 用一个 Promise.all 把 listCharacterAuras / listBindableNovelCharacters /
// getCharacterAuraBindings 绑在一起，扫描 wiki 需要数分钟时，setAuras 一直不执行，
// 自定义灵魂页会长时间停留在空状态文案。

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
    listBindableNovelCharacters: auraMocks.listBindableNovelCharacters,
    listCharacterAuras: auraMocks.listCharacterAuras,
    loadCharacterAuraResearchDocument: auraMocks.loadCharacterAuraResearchDocument,
    loadCharacterAuraSkillDocument: auraMocks.loadCharacterAuraSkillDocument,
    unbindCharacterAura: auraMocks.unbindCharacterAura,
    updateCustomCharacterAura: auraMocks.updateCustomCharacterAura,
  }
})

const customAura = {
  ...BUILT_IN_CHARACTER_AURAS[0],
  id: "custom-aura-decoupled",
  name: "拆书库导入的自定义灵魂",
  builtIn: false,
  category: "测试角色",
}

const EMPTY_STATE_TEXT = "还没有自定义灵魂"
const CHARACTER_OPTIONS_EMPTY_TEXT = "请先添加小说人物"
const CHARACTER_OPTIONS_LOADING_TEXT = "正在读取小说人物"

let host: HTMLDivElement
let root: Root

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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function useProject() {
  return { id: "proj-1", name: "proj", path: "/proj" }
}

describe("角色灵魂列表与小说人物扫描解耦", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    auraMocks.listBindableNovelCharacters.mockResolvedValue([])
    auraMocks.getCharacterAuraBindings.mockResolvedValue([])
    auraMocks.loadCharacterAuraSkillDocument.mockResolvedValue("")
    auraMocks.loadCharacterAuraResearchDocument.mockResolvedValue("")
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

  it("小说人物扫描永不返回时，自定义灵魂列表仍然立刻渲染", async () => {
    auraMocks.listCharacterAuras.mockResolvedValue([...BUILT_IN_CHARACTER_AURAS, customAura])
    auraMocks.listBindableNovelCharacters.mockImplementation(() => neverResolves<string[]>())
    useWikiStore.setState({
      project: useProject(),
      selectedSoulId: customAura.id,
      selectedSoulSection: "custom",
      selectedSoulTab: "character",
    })

    await act(async () => {
      root.render(<CharacterAuraView hideSidebar />)
    })
    await flush()

    expect(host.textContent).toContain(customAura.name)
    expect(host.textContent).not.toContain(EMPTY_STATE_TEXT)
  })

  it("小说人物扫描未完成时，已绑定信息仍然渲染", async () => {
    const targetAura = BUILT_IN_CHARACTER_AURAS[0]
    auraMocks.listCharacterAuras.mockResolvedValue(BUILT_IN_CHARACTER_AURAS)
    auraMocks.listBindableNovelCharacters.mockImplementation(() => neverResolves<string[]>())
    auraMocks.getCharacterAuraBindings.mockResolvedValue([{ characterName: "杨墨", auraId: targetAura.id }])
    useWikiStore.setState({
      project: useProject(),
      selectedSoulId: targetAura.id,
      selectedSoulSection: "builtIn",
      selectedSoulTab: "character",
    })

    await act(async () => {
      root.render(<CharacterAuraView hideSidebar />)
    })
    await flush()

    expect(host.textContent).toContain("已绑定杨墨")
  })

  it("人物列表还在读取时，绑定控件显示读取提示而不是请先添加小说人物", async () => {
    const targetAura = BUILT_IN_CHARACTER_AURAS[0]
    auraMocks.listCharacterAuras.mockResolvedValue(BUILT_IN_CHARACTER_AURAS)
    auraMocks.listBindableNovelCharacters.mockImplementation(() => neverResolves<string[]>())
    useWikiStore.setState({
      project: useProject(),
      selectedSoulId: targetAura.id,
      selectedSoulSection: "builtIn",
      selectedSoulTab: "character",
    })

    await act(async () => {
      root.render(<CharacterAuraView hideSidebar />)
    })
    await flush()

    expect(host.textContent).toContain(CHARACTER_OPTIONS_LOADING_TEXT)
    expect(host.textContent).not.toContain(CHARACTER_OPTIONS_EMPTY_TEXT)
  })

  it("人物列表返回后读取提示消失并填充可选人物", async () => {
    const targetAura = BUILT_IN_CHARACTER_AURAS[0]
    const scan = deferred<string[]>()
    auraMocks.listCharacterAuras.mockResolvedValue(BUILT_IN_CHARACTER_AURAS)
    auraMocks.listBindableNovelCharacters.mockImplementation(() => scan.promise)
    useWikiStore.setState({
      project: useProject(),
      selectedSoulId: targetAura.id,
      selectedSoulSection: "builtIn",
      selectedSoulTab: "character",
    })

    await act(async () => {
      root.render(<CharacterAuraView hideSidebar />)
    })
    await flush()
    expect(host.textContent).toContain(CHARACTER_OPTIONS_LOADING_TEXT)

    await act(async () => {
      scan.resolve(["杨墨", "李四"])
    })
    await flush()

    expect(host.textContent).not.toContain(CHARACTER_OPTIONS_LOADING_TEXT)
    expect(host.textContent).not.toContain(CHARACTER_OPTIONS_EMPTY_TEXT)
    const select = host.querySelector('select[aria-label="绑定小说人物"]')
    const optionValues = Array.from(select?.querySelectorAll("option") ?? []).map((option) => option.getAttribute("value"))
    expect(optionValues).toContain("杨墨")
    expect(optionValues).toContain("李四")
  })

  it("人物扫描失败时灵魂列表照常显示并给出错误提示", async () => {
    auraMocks.listCharacterAuras.mockResolvedValue([...BUILT_IN_CHARACTER_AURAS, customAura])
    auraMocks.listBindableNovelCharacters.mockRejectedValue(new Error("小说人物扫描失败"))
    useWikiStore.setState({
      project: useProject(),
      selectedSoulId: customAura.id,
      selectedSoulSection: "custom",
      selectedSoulTab: "character",
    })

    await act(async () => {
      root.render(<CharacterAuraView hideSidebar />)
    })
    await flush()

    expect(host.textContent).toContain(customAura.name)
    expect(host.textContent).not.toContain(EMPTY_STATE_TEXT)
    const status = host.querySelector('[role="status"]')
    expect(status?.textContent ?? "").not.toBe("")
    expect(status?.textContent ?? "").toContain("小说人物扫描失败")
  })

  it("人物列表迟到返回时不会改变当前选中的灵魂", async () => {
    const scan = deferred<string[]>()
    auraMocks.listCharacterAuras.mockResolvedValue([...BUILT_IN_CHARACTER_AURAS, customAura])
    auraMocks.listBindableNovelCharacters.mockImplementation(() => scan.promise)
    useWikiStore.setState({
      project: useProject(),
      selectedSoulId: customAura.id,
      selectedSoulSection: "custom",
      selectedSoulTab: "character",
    })

    await act(async () => {
      root.render(<CharacterAuraView hideSidebar />)
    })
    await flush()
    expect(host.querySelector("h2")?.textContent).toBe(customAura.name)

    await act(async () => {
      scan.resolve(["杨墨", "李四"])
    })
    await flush()

    expect(host.querySelector("h2")?.textContent).toBe(customAura.name)
    expect(useWikiStore.getState().selectedSoulId).toBe(customAura.id)
  })
})
