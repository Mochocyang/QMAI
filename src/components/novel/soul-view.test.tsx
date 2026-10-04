// @vitest-environment jsdom

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import "@/i18n"
import { BUILT_IN_CHARACTER_AURAS } from "@/lib/novel/character-aura"
import { useWikiStore } from "@/stores/wiki-store"
import { SoulView } from "./soul-view"

const source = readFileSync(resolve(__dirname, "soul-view.tsx"), "utf8")

const auraMocks = vi.hoisted(() => ({
  listCharacterAuras: vi.fn(),
  getCharacterAuraBindings: vi.fn(),
}))

vi.mock("@/lib/novel/character-aura", async () => {
  const actual = await vi.importActual<typeof import("@/lib/novel/character-aura")>("@/lib/novel/character-aura")
  return {
    ...actual,
    listCharacterAuras: auraMocks.listCharacterAuras,
    getCharacterAuraBindings: auraMocks.getCharacterAuraBindings,
  }
})

const customAura = {
  ...BUILT_IN_CHARACTER_AURAS[0],
  id: "custom-aura-1",
  name: "自定义角色灵魂",
  builtIn: false,
  category: "测试角色",
}

let host: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

function getButton(label: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.trim() === label)
}

describe("SoulView source", () => {
  it("does not constrain the project soul editor with a narrow centered wrapper", () => {
    expect(source).toContain("<SoulDocEditor />")
    expect(source).not.toContain("max-w-3xl")
    expect(source).not.toContain("mx-auto")
  })
})

describe("SoulView 单列画廊", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    auraMocks.listCharacterAuras.mockResolvedValue(BUILT_IN_CHARACTER_AURAS)
    auraMocks.getCharacterAuraBindings.mockResolvedValue([])
    useWikiStore.setState({
      project: { id: "proj-1", name: "proj", path: "/proj" },
      selectedSoulTab: "character",
      selectedSoulId: null,
      selectedSoulSection: "builtIn",
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

  it("内置灵魂用分类标签筛选，且不再渲染搜索框", async () => {
    await act(async () => {
      root.render(<SoulView />)
    })
    await flush()

    expect(host.querySelector('[aria-label="内置灵魂分类"]')).not.toBeNull()
    expect(host.querySelector('input[type="text"]')).toBeNull()
    // 内置灵魂自带的分类应作为标签出现。
    const categories = new Set(BUILT_IN_CHARACTER_AURAS.map((aura) => aura.category).filter(Boolean))
    for (const category of categories) {
      expect(getButton(category as string)).toBeDefined()
    }
  })

  it("用分类标签把内置灵魂过滤到对应分类", async () => {
    await act(async () => {
      root.render(<SoulView />)
    })
    await flush()

    const historyAuras = BUILT_IN_CHARACTER_AURAS.filter((aura) => aura.category === "历史帝王")
    expect(historyAuras.length).toBeGreaterThan(0)

    await act(async () => {
      getButton("历史帝王")?.click()
    })
    await flush()

    for (const aura of historyAuras) {
      expect(host.querySelector(`[data-testid="soul-aura-card-${aura.id}"]`)).not.toBeNull()
    }
    const otherAura = BUILT_IN_CHARACTER_AURAS.find((aura) => aura.category !== "历史帝王")
    if (otherAura) {
      expect(host.querySelector(`[data-testid="soul-aura-card-${otherAura.id}"]`)).toBeNull()
    }
  })

  it("新增的「已绑定」分组只展示已绑定人物的灵魂", async () => {
    const boundAura = BUILT_IN_CHARACTER_AURAS[0]
    auraMocks.getCharacterAuraBindings.mockResolvedValue([
      { characterName: "杨墨", auraId: boundAura.id },
    ])

    await act(async () => {
      root.render(<SoulView />)
    })
    await flush()

    await act(async () => {
      getButton("已绑定 1")?.click() ?? getButton("已绑定")?.click()
    })
    await flush()

    expect(host.querySelector(`[data-testid="soul-aura-card-${boundAura.id}"]`)).not.toBeNull()
    const unboundAura = BUILT_IN_CHARACTER_AURAS.find((aura) => aura.id !== boundAura.id)
    if (unboundAura) {
      expect(host.querySelector(`[data-testid="soul-aura-card-${unboundAura.id}"]`)).toBeNull()
    }
  })

  it("自定义灵魂分组提供新建入口并进入单列表单", async () => {
    auraMocks.listCharacterAuras.mockResolvedValue([...BUILT_IN_CHARACTER_AURAS, customAura])

    await act(async () => {
      root.render(<SoulView />)
    })
    await flush()

    await act(async () => {
      getButton("自定义灵魂")?.click()
    })
    await flush()

    const createBtn = getButton("新建角色灵魂")
    expect(createBtn).toBeDefined()
    await act(async () => {
      createBtn!.click()
    })
    await flush()

    expect(useWikiStore.getState().selectedSoulId).toBe("new-custom-soul")
  })
})