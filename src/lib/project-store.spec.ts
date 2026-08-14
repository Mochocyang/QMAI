import { beforeEach, describe, expect, it, vi } from "vitest"

const storeMocks = vi.hoisted(() => {
  const values = new Map<string, unknown>()
  return {
    values,
    get: vi.fn(async (key: string) => values.get(key)),
    set: vi.fn(async (key: string, value: unknown) => { values.set(key, value) }),
  }
})

vi.mock("@/lib/web-store", () => ({
  getStore: vi.fn(async () => ({ get: storeMocks.get, set: storeMocks.set })),
}))

import {
  loadAiOutlineModel,
  loadAiWorkflowMode,
  loadLastReadChapter,
  loadOutlineWorkflowMode,
  saveAiOutlineModel,
  saveAiWorkflowMode,
  saveLastReadChapter,
  saveOutlineWorkflowMode,
} from "@/lib/project-store"

describe("AI outline model persistence", () => {
  beforeEach(() => {
    storeMocks.values.clear()
    storeMocks.get.mockClear()
    storeMocks.set.mockClear()
  })

  it("saves and restores a stable provider/model id under the outline-only key", async () => {
    await saveAiOutlineModel("openai/gpt-4o")

    expect(storeMocks.set).toHaveBeenCalledWith("aiOutlineModel", "openai/gpt-4o")
    expect(storeMocks.values.has("aiChatModel")).toBe(false)
    expect(storeMocks.values.has("defaultLlmModel")).toBe(false)
    await expect(loadAiOutlineModel()).resolves.toBe("openai/gpt-4o")
  })

  it("keeps the latest model on disk when pending writes finish in reverse order", async () => {
    const pendingWrites: Array<{ value: unknown; resolve: () => void }> = []
    storeMocks.set.mockImplementation(async (key: string, value: unknown) => {
      await new Promise<void>((resolve) => {
        pendingWrites.push({
          value,
          resolve: () => {
            storeMocks.values.set(key, value)
            resolve()
          },
        })
      })
    })

    const fallbackSave = saveAiOutlineModel("openai/fallback-model")
    const manualSave = saveAiOutlineModel("anthropic/manual-model")
    for (let attempt = 0; attempt < 20 && pendingWrites.length < 2; attempt += 1) {
      await Promise.resolve()
    }
    expect(pendingWrites.map((write) => write.value)).toEqual([
      "openai/fallback-model",
      "anthropic/manual-model",
    ])

    pendingWrites[1].resolve()
    await Promise.resolve()
    pendingWrites[0].resolve()
    for (let attempt = 0; attempt < 20 && pendingWrites.length < 3; attempt += 1) {
      await Promise.resolve()
    }
    expect(pendingWrites[2]?.value).toBe("anthropic/manual-model")
    pendingWrites[2].resolve()
    await Promise.all([fallbackSave, manualSave])

    expect(storeMocks.values.get("aiOutlineModel")).toBe("anthropic/manual-model")
  })

})

describe("workflow mode persistence", () => {
  beforeEach(() => {
    storeMocks.values.clear()
    storeMocks.get.mockReset()
    storeMocks.set.mockReset()
    storeMocks.get.mockImplementation(async (key: string) => storeMocks.values.get(key))
    storeMocks.set.mockImplementation(async (key: string, value: unknown) => {
      storeMocks.values.set(key, value)
    })
  })

  it("saves body and outline modes under separate keys", async () => {
    await saveAiWorkflowMode("strict")
    await saveOutlineWorkflowMode("fast")

    expect(storeMocks.values.get("aiWorkflowMode")).toBe("strict")
    expect(storeMocks.values.get("outlineWorkflowMode")).toBe("fast")
    expect(storeMocks.values.has("aiChatModel")).toBe(false)
    expect(storeMocks.values.has("aiOutlineModel")).toBe(false)
    await expect(loadAiWorkflowMode()).resolves.toBe("strict")
    await expect(loadOutlineWorkflowMode()).resolves.toBe("fast")
  })

  it("treats missing or invalid stored modes as unset", async () => {
    await expect(loadAiWorkflowMode()).resolves.toBeNull()
    await expect(loadOutlineWorkflowMode()).resolves.toBeNull()

    storeMocks.values.set("aiWorkflowMode", "normal")
    storeMocks.values.set("outlineWorkflowMode", "strict")

    await expect(loadAiWorkflowMode()).resolves.toBeNull()
    await expect(loadOutlineWorkflowMode()).resolves.toBeNull()
  })
})

describe("last read chapter persistence", () => {
  beforeEach(() => {
    storeMocks.values.clear()
    storeMocks.get.mockReset()
    storeMocks.set.mockReset()
    storeMocks.get.mockImplementation(async (key: string) => storeMocks.values.get(key))
    storeMocks.set.mockImplementation(async (key: string, value: unknown) => {
      storeMocks.values.set(key, value)
    })
  })

  it("stores last-read chapters per project id", async () => {
    await saveLastReadChapter("/books/a/wiki/chapters/1.md", "project-a")
    await saveLastReadChapter("/books/b/wiki/chapters/2.md", "project-b")

    await expect(loadLastReadChapter("project-a")).resolves.toBe("/books/a/wiki/chapters/1.md")
    await expect(loadLastReadChapter("project-b")).resolves.toBe("/books/b/wiki/chapters/2.md")
  })

  it("falls back to legacy global key when project entry is missing", async () => {
    storeMocks.values.set("lastReadChapter", "/books/legacy/wiki/chapters/9.md")

    await expect(loadLastReadChapter("unknown-project")).resolves.toBe(
      "/books/legacy/wiki/chapters/9.md",
    )
  })
})
