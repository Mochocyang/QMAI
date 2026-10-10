// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"
import { useFavoriteSkillStore } from "@/stores/favorite-skill-store"
import { UnifiedSkillLibraryView } from "./unified-skill-library-view"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const readFileMock = vi.hoisted(() => vi.fn())
const writeFileMock = vi.hoisted(() => vi.fn())
const writeFileAtomicMock = vi.hoisted(() => vi.fn())
const joinMock = vi.hoisted(() => vi.fn(async (...parts: string[]) => parts.join("/")))
const openDialogMock = vi.hoisted(() => vi.fn())
const saveDialogMock = vi.hoisted(() => vi.fn())
const loadWritingStyleStoreMock = vi.hoisted(() => vi.fn())

vi.mock("@/commands/fs", () => ({
  readFile: readFileMock,
  writeFile: writeFileMock,
  writeFileAtomic: writeFileAtomicMock,
}))

/**
 * 只替换文风库的 loader（用于模拟「文风库读取失败」），其余导出保持真实实现。
 * 真实实现由工厂装进 `styleStoreActual`（必须走 vi.hoisted，工厂是提升执行的），
 * beforeEach 再把它装回 mock 作为默认，所以其它用例走的仍是真实 store 逻辑。
 */
const styleStoreActual = vi.hoisted(() => ({
  load: undefined as unknown as (projectPath: string) => Promise<unknown>,
}))
vi.mock("@/lib/novel/writing-style-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/novel/writing-style-store")>()
  styleStoreActual.load = actual.loadWritingStyleStore
  return { ...actual, loadWritingStyleStore: loadWritingStyleStoreMock }
})

vi.mock("@tauri-apps/api/path", () => ({
  join: joinMock,
}))

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: openDialogMock,
  save: saveDialogMock,
}))

vi.mock("@/lib/web-store", () => ({
  getStore: vi.fn(async () => ({
    get: vi.fn(async () => ({ version: 1, favorites: [] })),
    set: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
  })),
  flushAppState: vi.fn(),
}))

const deAiConfig = {
  version: 1,
  defaultSkillId: "project:quiet",
  disabledSkillIds: [],
  lastChapterDeAiSkillId: null,
  projectSkills: [{
    id: "project:quiet",
    name: "沉浸式去AI味",
    description: "减少解释腔和总结腔",
    templateId: "custom",
    content: "删除协作口吻，保留角色语气。",
    source: "project",
    createdAt: 100,
    updatedAt: 100,
  }],
  builtInSkillOverrides: [],
}

const writingConfig = {
  version: 1,
  selectedSkillId: "skill:three",
  disabledSkillIds: [],
  skills: [{
    id: "skill:three",
    name: "三翻四抖",
    description: "三次转折，四次震惊。",
    kind: ["structure", "review"],
    stages: ["planning", "review"],
    modes: ["standard", "strict"],
    content: "每章设置三次局势变化和四次信息冲击。",
    source: "uploaded",
    createdAt: 100,
    updatedAt: 100,
  }],
  categories: [],
}

/** 项目里的文风预设（v1 画像形状：没有 workbenchStyle）。 */
const writingStyleStore = {
  version: 1,
  enabledStyleId: "preset:cool",
  styles: [
    {
      id: "preset:cool",
      name: "冷硬叙事文风",
      sourceBook: "凡人修仙传",
      profile: {
        schemaVersion: 1,
        generatedAt: 1,
        sampledChapterIds: [],
        constitution: "1. 短句为主\n2. 环境描写不超过两句",
        samples: ["他略一沉吟，继而抬起头。"],
      },
      createdAt: 100,
      updatedAt: 100,
    },
    {
      id: "preset:warm",
      name: "温情笔触文风",
      sourceBook: "山楂树之恋",
      profile: {
        schemaVersion: 1,
        generatedAt: 2,
        sampledChapterIds: [],
        constitution: "1. 长句铺陈",
        samples: ["院子里那棵树下，风很轻。"],
      },
      createdAt: 90,
      updatedAt: 90,
    },
  ],
}

async function renderLibrary() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<UnifiedSkillLibraryView />)
  })
  await flushEffects()
  return { container, root }
}

function cleanup(root: Root, container: HTMLElement) {
  act(() => root.unmount())
  document.body.removeChild(container)
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function setInputValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    valueSetter?.call(input, value)
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

function getButton(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.trim() === label)
}

function tabStates(container: HTMLElement): [string, string | null][] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>(".ui-test-skills-tab"))
    .map((tab) => [tab.textContent?.trim() ?? "", tab.getAttribute("aria-pressed")])
}

async function switchToTab(container: HTMLElement, label: string) {
  await act(async () => {
    getButton(container, label)?.click()
  })
  await flushEffects()
}

describe("UnifiedSkillLibraryView", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadWritingStyleStoreMock.mockImplementation((projectPath: string) => styleStoreActual.load(projectPath))
    readFileMock.mockImplementation(async (path: string) => {
      if (path.endsWith("de-ai-skills.json")) return JSON.stringify(deAiConfig)
      if (path.endsWith("writing-skills.json")) return JSON.stringify(writingConfig)
      if (path.endsWith(".qmai/writing-style.json")) return JSON.stringify(writingStyleStore)
      throw new Error("missing")
    })
    writeFileMock.mockResolvedValue(undefined)
    writeFileAtomicMock.mockResolvedValue(undefined)
    openDialogMock.mockResolvedValue(null)
    saveDialogMock.mockResolvedValue(null)
    useWikiStore.getState().setProject({
      id: "p1",
      name: "测试项目",
      path: "C:/project",
    })
    useWikiStore.getState().setActiveView("skillLibrary")
    useWikiStore.getState().setSelectedSkillLibrarySkillId(null)
    useWikiStore.getState().setSelectedWritingSkillLibrarySkillId(null)
    useWikiStore.getState().setSkillLibraryDraftDirty(false)
    useWikiStore.getState().setWritingSkillLibraryDraftDirty(false)
    useFavoriteSkillStore.setState({ favorites: [], loaded: true, currentProjectPath: "C:/project" })
  })

  it("renders a card gallery with the page title and de-AI cards on the de-AI tab", async () => {
    const { container, root } = await renderLibrary()

    expect(container.querySelector('[data-testid="unified-skill-library-view"]')).not.toBeNull()
    expect(container.querySelector("h1")?.textContent).toBe("技能库")
    expect(container.querySelector('[data-testid="unified-skill-entry-de-ai:project:quiet"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="unified-skill-entry-writing:skill:three"]')).toBeNull()
    expect(container.querySelector('[data-testid="unified-skill-search-input"]')).not.toBeNull()

    cleanup(root, container)
  })

  it("shows de-AI actions on the de-AI tab and writing actions on the writing tab", async () => {
    const { container, root } = await renderLibrary()

    let actionLabels = Array.from(
      container.querySelectorAll('[data-testid="skill-library-header-actions"] button'),
    ).map((button) => button.textContent?.trim())
    expect(actionLabels).toEqual(["新建技能", "导入"])

    await act(async () => {
      getButton(container, "写作 Skill")?.click()
    })
    await flushEffects()

    actionLabels = Array.from(
      container.querySelectorAll('[data-testid="skill-library-header-actions"] button'),
    ).map((button) => button.textContent?.trim())
    expect(actionLabels).toEqual(["新建 Skill", "导入"])

    cleanup(root, container)
  })

  it("filters the current tab's cards with the search input", async () => {
    const { container, root } = await renderLibrary()
    const searchInput = container.querySelector<HTMLInputElement>('[data-testid="unified-skill-search-input"]')

    await setInputValue(searchInput!, "解释腔")
    expect(container.querySelector('[data-testid="unified-skill-entry-de-ai:project:quiet"]')).not.toBeNull()

    await setInputValue(searchInput!, "没有这个技能")
    expect(container.querySelector('[data-testid="unified-skill-entry-de-ai:project:quiet"]')).toBeNull()

    cleanup(root, container)
  })

  it("lights up the favorite star immediately after clicking it", async () => {
    const { container, root } = await renderLibrary()
    const cardSelector = '[data-testid="unified-skill-entry-de-ai:project:quiet"]'

    expect(container.querySelector(`${cardSelector} button[aria-label="收藏"]`)).not.toBeNull()

    await act(async () => {
      container.querySelector<HTMLButtonElement>(`${cardSelector} button[aria-label="收藏"]`)?.click()
    })

    expect(container.querySelector(`${cardSelector} button[aria-label="取消收藏"]`)).not.toBeNull()

    cleanup(root, container)
  })

  it("switches the gallery content when another tab is selected", async () => {
    const { container, root } = await renderLibrary()

    await act(async () => {
      getButton(container, "写作 Skill")?.click()
    })
    await flushEffects()

    expect(useWikiStore.getState().activeView).toBe("writingSkillLibrary")
    expect(container.querySelector('[data-testid="unified-skill-entry-writing:skill:three"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="unified-skill-entry-de-ai:project:quiet"]')).toBeNull()

    cleanup(root, container)
  })

  it("opens a card into the detail editor and returns with the back button", async () => {
    const { container, root } = await renderLibrary()

    await act(async () => {
      container.querySelector<HTMLElement>('[data-testid="unified-skill-entry-de-ai:project:quiet"]')?.click()
    })
    await flushEffects()

    expect(useWikiStore.getState().selectedSkillLibrarySkillId).toBe("project:quiet")
    expect(container.querySelector('[data-testid="skill-library-view"]')).not.toBeNull()

    await act(async () => {
      getButton(container, "返回技能库")?.click()
    })
    await flushEffects()

    expect(container.querySelector('[data-testid="skill-library-view"]')).toBeNull()
    expect(container.querySelector('[data-testid="unified-skill-search-input"]')).not.toBeNull()

    cleanup(root, container)
  })

  it("creates a writing Skill from the header and drills into the editor", async () => {
    const { container, root } = await renderLibrary()

    await act(async () => {
      getButton(container, "写作 Skill")?.click()
    })
    await flushEffects()

    await act(async () => {
      getButton(container, "新建 Skill")?.click()
    })
    await flushEffects()

    expect(useWikiStore.getState().activeView).toBe("writingSkillLibrary")
    expect(useWikiStore.getState().selectedWritingSkillLibrarySkillId).toMatch(/^skill:/)
    expect(writeFileAtomicMock).toHaveBeenCalledWith(
      "C:/project/writing-skills.json",
      expect.stringContaining("新建写作 Skill"),
    )
    expect(container.querySelector('[data-testid="writing-skill-library-view"]')).not.toBeNull()

    cleanup(root, container)
  })

  it("imports a de-AI skill file from the header", async () => {
    openDialogMock.mockResolvedValue("C:/skills/冷硬叙事.md")
    readFileMock.mockImplementation(async (path: string) => {
      if (path.endsWith("de-ai-skills.json")) return JSON.stringify(deAiConfig)
      if (path.endsWith("writing-skills.json")) return JSON.stringify(writingConfig)
      if (path === "C:/skills/冷硬叙事.md") return "# 冷硬叙事\n\n删掉解释，保留动作。"
      throw new Error("missing")
    })
    const { container, root } = await renderLibrary()

    await act(async () => {
      getButton(container, "导入")?.click()
    })
    await flushEffects()

    expect(writeFileAtomicMock).toHaveBeenCalledWith(
      "C:/project/de-ai-skills.json",
      expect.stringContaining("冷硬叙事"),
    )
    expect(writeFileAtomicMock).toHaveBeenCalledWith(
      "C:/project/de-ai-skills.json",
      expect.stringContaining("删掉解释，保留动作。"),
    )
    expect(useWikiStore.getState().activeView).toBe("skillLibrary")
    expect(container.querySelector('[data-testid="skill-library-view"]')).not.toBeNull()

    cleanup(root, container)
  })

  /*
   * === 文风 tab（丁-1）===
   *
   * ⚠️ 这一组用例存在的理由：本文件的 tab 分派原先是一串
   * `activeTab === "writingSkillLibrary" ? A : B` 的**二元三元**。
   * 给联合类型加第三个成员后每一处三元仍然合法编译（`"…style…" === "…writing…"` 只是恒 false），
   * 全部静默落到 else 分支，而 `tsc` 抓不到任何一处。
   * 所以「文风 tab 高亮正确 + 显示的是文风条目」必须由**行为测试**证明，
   * 不能用 typecheck 或源码文本断言代替。
   */

  it("切换文风 tab：该 tab 被标记为选中，且展示的是文风条目而不是去AI味条目", async () => {
    const { container, root } = await renderLibrary()

    expect(tabStates(container)).toEqual([
      ["去AI味技能", "true"],
      ["写作 Skill", "false"],
      ["文风", "false"],
      ["收藏", "false"],
    ])
    // 初始在去AI味 tab
    expect(container.querySelector('[data-testid="unified-skill-entry-de-ai:project:quiet"]')).not.toBeNull()

    await switchToTab(container, "文风")

    expect(useWikiStore.getState().activeView).toBe("writingStyleLibrary")
    // (a) 选中语义：只有「文风」是 pressed
    expect(tabStates(container)).toEqual([
      ["去AI味技能", "false"],
      ["写作 Skill", "false"],
      ["文风", "true"],
      ["收藏", "false"],
    ])
    // (b) 列表内容：是文风条目，不是去AI味/写作 Skill 条目
    expect(container.querySelector('[data-testid="unified-skill-entry-style:preset:cool"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="unified-skill-entry-style:preset:warm"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="unified-skill-entry-de-ai:project:quiet"]')).toBeNull()
    expect(container.querySelector('[data-testid="unified-skill-entry-writing:skill:three"]')).toBeNull()

    cleanup(root, container)
  })

  it("把项目里的文风预设列成条目：类型徽章为「文风」、来源是「引用」、启用项标出「当前启用」", async () => {
    const { container, root } = await renderLibrary()
    await switchToTab(container, "文风")

    const card = container.querySelector('[data-testid="unified-skill-entry-style:preset:cool"]')
    expect(card).not.toBeNull()
    expect(card!.querySelector(".ui-test-skill-card-name")?.textContent).toBe("冷硬叙事文风")
    expect(
      Array.from(card!.querySelectorAll(".ui-test-skill-badge")).map((badge) => badge.textContent),
    ).toEqual(["文风", "引用", "当前启用", "《凡人修仙传》"])

    // 未启用的那条不带「当前启用」
    const warm = container.querySelector('[data-testid="unified-skill-entry-style:preset:warm"]')
    expect(
      Array.from(warm!.querySelectorAll(".ui-test-skill-badge")).map((badge) => badge.textContent),
    ).toEqual(["文风", "引用", "《山楂树之恋》"])
    expect(warm!.querySelector(".ui-test-skill-badge.is-type")?.textContent).toBe("文风")

    cleanup(root, container)
  })

  it("文风库为空时展示文风空态，而不是去AI味空态", async () => {
    readFileMock.mockImplementation(async (path: string) => {
      if (path.endsWith("de-ai-skills.json")) return JSON.stringify(deAiConfig)
      if (path.endsWith("writing-skills.json")) return JSON.stringify(writingConfig)
      if (path.endsWith(".qmai/writing-style.json")) {
        return JSON.stringify({ version: 1, enabledStyleId: null, styles: [] })
      }
      throw new Error("missing")
    })
    const { container, root } = await renderLibrary()
    await switchToTab(container, "文风")

    expect(container.querySelector('[data-testid="unified-skill-entry-style:preset:cool"]')).toBeNull()
    const empty = container.querySelector(".ui-test-skills-empty")
    expect(empty?.textContent).toContain("文风库还是空的")
    expect(empty?.textContent).not.toContain("去AI味")

    cleanup(root, container)
  })

  it("文风条目是引用：选中它不写任何文件，也不进入编辑器", async () => {
    const { container, root } = await renderLibrary()
    await switchToTab(container, "文风")

    const card = container.querySelector<HTMLElement>('[data-testid="unified-skill-entry-style:preset:cool"]')
    expect(card).not.toBeNull()
    expect(card!.getAttribute("aria-pressed")).toBe("false")
    // 条目是**读项目文件**来的（引用），不是把预设复制成技能
    expect(readFileMock.mock.calls.map((call) => String(call[0]))).toContain("C:/project/.qmai/writing-style.json")
    expect(writeFileAtomicMock.mock.calls.map((call) => String(call[0]))).toEqual([])

    await act(async () => {
      card!.click()
    })
    await flushEffects()

    // 证据链：选中后**一个文件都没写**（尤其没有 writing-skills.json / .qmai/writing-style.json）
    expect(writeFileAtomicMock.mock.calls.map((call) => String(call[0]))).toEqual([])
    expect(writeFileMock).not.toHaveBeenCalled()
    // 也没有写 wiki-store 的「选中技能」状态（那会打开另一个库的编辑器）
    expect(useWikiStore.getState().selectedSkillLibrarySkillId).toBeNull()
    expect(useWikiStore.getState().selectedWritingSkillLibrarySkillId).toBeNull()
    expect(container.querySelector('[data-testid="skill-library-view"]')).toBeNull()
    expect(container.querySelector('[data-testid="writing-skill-library-view"]')).toBeNull()
    // 但选中在界面上是可观察的
    expect(card!.getAttribute("aria-pressed")).toBe("true")
    expect(card!.querySelector(".ui-test-skill-card-open")).toBeNull()

    cleanup(root, container)
  })

  it("文风 tab 不提供新建/导入/编辑入口（本批不新增编辑能力）", async () => {
    const { container, root } = await renderLibrary()
    await switchToTab(container, "文风")

    expect(
      Array.from(container.querySelectorAll('[data-testid="skill-library-header-actions"] button'))
        .map((button) => button.textContent?.trim()),
    ).toEqual([])
    expect(container.querySelector(".ui-test-skill-card-open")).toBeNull()
    expect(container.querySelector(".ui-test-skill-toggle input")).toBeNull()

    cleanup(root, container)
  })

  it("文风库读取失败只退化成「文风 tab 为空」，不牵连另外两个库", async () => {
    loadWritingStyleStoreMock.mockImplementation(async () => {
      throw new Error("EACCES: 文风库读取失败")
    })
    const { container, root } = await renderLibrary()

    // 另外两库照常：没有整页错误
    expect(container.querySelector(".ui-test-skills-error")).toBeNull()
    expect(container.querySelector('[data-testid="unified-skill-entry-de-ai:project:quiet"]')).not.toBeNull()

    await switchToTab(container, "文风")
    expect(container.querySelector(".ui-test-skills-empty")?.textContent).toContain("文风库还是空的")
    expect(writeFileAtomicMock).not.toHaveBeenCalled()

    await switchToTab(container, "写作 Skill")
    expect(container.querySelector('[data-testid="unified-skill-entry-writing:skill:three"]')).not.toBeNull()
    expect(container.querySelector(".ui-test-skills-error")).toBeNull()

    cleanup(root, container)
  })
})