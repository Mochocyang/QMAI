/**
 * 拆书作品 → 孤儿灵魂 清理 单测
 */

import { describe, expect, it, vi, beforeEach } from "vitest"

const storeState = {
  customAuras: [] as Array<Record<string, unknown>>,
  bindings: [] as Array<{ characterName: string; auraId: string }>,
}

const listCharacterAurasMock = vi.fn()
const loadCharacterAuraStoreMock = vi.fn()
const deleteCustomCharacterAuraMock = vi.fn()

vi.mock("@/lib/novel/character-aura", () => ({
  listCharacterAuras: (projectPath: string) => listCharacterAurasMock(projectPath),
  loadCharacterAuraStore: (projectPath: string) => loadCharacterAuraStoreMock(projectPath),
  deleteCustomCharacterAura: (projectPath: string, auraId: string) =>
    deleteCustomCharacterAuraMock(projectPath, auraId),
}))

import {
  deleteOrphanAurasForBook,
  isAuraFromBook,
  listOrphanAurasForBook,
} from "./aura-cleanup"

function aura(overrides: Record<string, unknown> = {}) {
  return {
    id: "custom-1",
    builtIn: false,
    name: "林烬",
    category: "拆书角色",
    sourceNote: "来自拆书作品《长夜书》的角色分析。",
    corpus: "来源作品：《长夜书》",
    ...overrides,
  }
}

beforeEach(() => {
  storeState.customAuras = []
  storeState.bindings = []
  listCharacterAurasMock.mockReset()
  loadCharacterAuraStoreMock.mockReset()
  deleteCustomCharacterAuraMock.mockReset()

  loadCharacterAuraStoreMock.mockImplementation(async () => storeState)
  listCharacterAurasMock.mockImplementation(async () => storeState.customAuras as never)
  deleteCustomCharacterAuraMock.mockImplementation(async (_path: string, id: string) => {
    storeState.customAuras = storeState.customAuras.filter((item) => item.id !== id)
    return { customAuras: storeState.customAuras, bindings: storeState.bindings }
  })
})

describe("isAuraFromBook", () => {
  it("category 必须是 拆书角色", () => {
    expect(
      isAuraFromBook(
        { category: "自定义灵魂", sourceNote: "《长夜书》" },
        "长夜书",
      ),
    ).toBe(false)
  })

  it("sourceNote 中包含《书名》才认为来自该书", () => {
    expect(isAuraFromBook(aura(), "长夜书")).toBe(true)
    expect(isAuraFromBook(aura(), "另一本书")).toBe(false)
  })

  it("corpus 中包含《书名》也算", () => {
    expect(
      isAuraFromBook(
        { category: "拆书角色", sourceNote: "", corpus: "来源作品：《长夜书》" },
        "长夜书",
      ),
    ).toBe(true)
  })

  it("空书名直接返回 false", () => {
    expect(isAuraFromBook(aura(), "")).toBe(false)
  })
})

describe("listOrphanAurasForBook", () => {
  it("返回未绑定的、属于该书的灵魂 ID", async () => {
    storeState.customAuras = [
      aura({ id: "a1" }),
      aura({ id: "a2", name: "沈微" }),
      aura({ id: "a3", category: "自定义灵魂" }),
    ]
    storeState.bindings = [{ characterName: "林烬", auraId: "a1" }]

    const result = await listOrphanAurasForBook("E:/p1", "长夜书")
    expect(result).toEqual(["a2"])
  })
})

describe("deleteOrphanAurasForBook", () => {
  it("只删除属于该书且未绑定的灵魂", async () => {
    storeState.customAuras = [
      aura({ id: "a1" }),
      aura({ id: "a2", name: "沈微" }),
      aura({ id: "a3", category: "自定义灵魂" }),
    ]
    storeState.bindings = [{ characterName: "林烬", auraId: "a1" }]

    const removed = await deleteOrphanAurasForBook("E:/p1", "长夜书")
    expect(removed).toBe(1)
    expect(deleteCustomCharacterAuraMock).toHaveBeenCalledTimes(1)
    expect(deleteCustomCharacterAuraMock).toHaveBeenCalledWith("E:/p1", "a2")
    expect(storeState.customAuras.map((item) => item.id).sort()).toEqual(["a1", "a3"])
  })

  it("内置灵魂永远不会被删", async () => {
    storeState.customAuras = [
      { id: "built-1", builtIn: true, name: "李白", category: "内置" },
    ]
    const removed = await deleteOrphanAurasForBook("E:/p1", "长夜书")
    expect(removed).toBe(0)
    expect(deleteCustomCharacterAuraMock).not.toHaveBeenCalled()
  })

  it("书名不匹配时不会误删", async () => {
    storeState.customAuras = [aura({ id: "a1" })]
    const removed = await deleteOrphanAurasForBook("E:/p1", "完全不相关的书")
    expect(removed).toBe(0)
  })

  it("删除失败时不影响其他灵魂", async () => {
    storeState.customAuras = [aura({ id: "a1" }), aura({ id: "a2" })]
    deleteCustomCharacterAuraMock.mockImplementation(async (_path: string, id: string) => {
      if (id === "a1") throw new Error("disk busy")
      storeState.customAuras = storeState.customAuras.filter((item) => item.id !== id)
      return { customAuras: storeState.customAuras, bindings: storeState.bindings }
    })
    const removed = await deleteOrphanAurasForBook("E:/p1", "长夜书")
    expect(removed).toBe(1)
    expect(storeState.customAuras.map((item) => item.id)).toEqual(["a1"])
  })
})
