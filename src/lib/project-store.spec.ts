import { beforeEach, describe, expect, it, vi } from "vitest"

const storeMocks = vi.hoisted(() => {
  const values = new Map<string, unknown>()
  return {
    values,
    get: vi.fn(async (key: string) => values.get(key)),
    set: vi.fn(async (key: string, value: unknown) => { values.set(key, value) }),
    // 本任务新增：现有骨架没有这两个，实现却要用（store.save() / store.delete()）
    save: vi.fn(async () => {}),
    delete: vi.fn(async (key: string) => { storeMocks.values.delete(key) }),
  }
})

vi.mock("@/lib/web-store", () => ({
  getStore: vi.fn(async () => ({
    get: storeMocks.get,
    set: storeMocks.set,
    save: storeMocks.save,
    delete: storeMocks.delete,
  })),
}))

import {
  loadAiOutlineModel,
  loadAiWorkflowMode,
  loadLastReadChapter,
  loadOutlineWorkflowMode,
  loadUiBodyFontPx,
  loadUiBodyLineHeight,
  loadUiBodyMarginX,
  loadUiBodySafeBottom,
  saveAiOutlineModel,
  saveAiWorkflowMode,
  saveLastReadChapter,
  saveOutlineWorkflowMode,
  saveUiBodyFontPx,
  saveUiBodyLetterSpacing,
  saveUiBodyLineHeight,
  saveUiBodyMarginX,
  saveUiBodySafeBottom,
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

describe("正文排版参数持久化", () => {
  beforeEach(() => {
    storeMocks.values.clear()
    storeMocks.get.mockClear()
    storeMocks.set.mockClear()
  })

  it("5 个参数各写各的键，互不覆盖", async () => {
    // 共用一个键就会出现「改行距把字号也改了」这种串味，且极难排查
    await saveUiBodyFontPx(21)
    await saveUiBodyLineHeight(2.1)
    await saveUiBodyLetterSpacing(0.5)
    await saveUiBodyMarginX(40)
    await saveUiBodySafeBottom(80)

    expect(storeMocks.values.get("uiBodyFontPx")).toBe(21)
    expect(storeMocks.values.get("uiBodyLineHeight")).toBe(2.1)
    expect(storeMocks.values.get("uiBodyLetterSpacing")).toBe(0.5)
    expect(storeMocks.values.get("uiBodyMarginX")).toBe(40)
    expect(storeMocks.values.get("uiBodySafeBottom")).toBe(80)
    // 旧倍数键不能再被写 —— 写了会让回滚到旧版本的用户读到"更新过的旧值"
    expect(storeMocks.values.has("uiBodyFontSizeScale")).toBe(false)
  })

  it("读回值先钳制再返回：盘上手改的越界值不能漏到界面上", async () => {
    // app-state.json 是明文，可被手改
    storeMocks.values.set("uiBodyFontPx", 999)
    storeMocks.values.set("uiBodyLineHeight", 9)
    storeMocks.values.set("uiBodySafeBottom", -50)

    await expect(loadUiBodyFontPx(1)).resolves.toBe(32)
    await expect(loadUiBodyLineHeight()).resolves.toBe(2.6)
    await expect(loadUiBodySafeBottom()).resolves.toBe(0)
  })

  it("左右边距的 null 是一等公民，不能被读成 0", async () => {
    // null = 跟随窗口。读成 0 会让正文贴边，且用户没动过任何设置
    await saveUiBodyMarginX(null)
    // 断言的是**读回函数**的行为，不是 mock 里 Map 的状态：
      // 用 Map.get 去查已删除的键会得到 undefined，那条断言检验的是 mock
      // 怎么写的，而不是被测代码对不对 —— 换任何实现它都不会红。
      expect(storeMocks.values.has("uiBodyMarginX")).toBe(false)
    await expect(loadUiBodyMarginX()).resolves.toBeNull()

    storeMocks.values.set("uiBodyMarginX", 40)
    await expect(loadUiBodyMarginX()).resolves.toBe(40)
  })

  it("迁移：新键读不到、旧倍数键在，按 18×界面倍数×正文倍数 换算", async () => {
    // 改造前的实际渲染高度 = 18px × 界面倍数 × 正文倍数。
    // 只乘正文倍数的话，界面 150% 的老用户一升级就会看到正文 27→18。
    storeMocks.values.set("uiBodyFontSizeScale", 1)
    await expect(loadUiBodyFontPx(1)).resolves.toBe(18)
    await expect(loadUiBodyFontPx(1.5)).resolves.toBe(27)

    storeMocks.values.set("uiBodyFontSizeScale", 0.85)
    await expect(loadUiBodyFontPx(1)).resolves.toBe(15)
  })

  it("迁移：没存过、界面字号非默认时按界面字号取值（loadUiBodyFontPx 只读，不写回）", async () => {
    // 关键场景：界面 150%、从没调过正文的用户。不补种他也会看到正文变小。
    await expect(loadUiBodyFontPx(1.5)).resolves.toBe(27)
    await expect(loadUiBodyFontPx(1.25)).resolves.toBe(23)
  })

  it("迁移：没存过且界面字号为 1 时返回 null（不写存储）", async () => {
    // 返回 18 会把「未设置」变成「已设置为 18」，日后调整默认值就对新用户失效
    await expect(loadUiBodyFontPx(1)).resolves.toBeNull()
  })

  it("新键优先于旧键：迁移只发生一次", async () => {
    storeMocks.values.set("uiBodyFontSizeScale", 0.85)
    storeMocks.values.set("uiBodyFontPx", 24)
    await expect(loadUiBodyFontPx(1.5)).resolves.toBe(24)
  })
})
