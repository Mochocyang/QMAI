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

vi.mock("@/commands/fs", () => ({
  readFile: readFileMock,
  writeFile: writeFileMock,
  writeFileAtomic: writeFileAtomicMock,
}))

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

describe("UnifiedSkillLibraryView", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readFileMock.mockImplementation(async (path: string) => {
      if (path.endsWith("de-ai-skills.json")) return JSON.stringify(deAiConfig)
      if (path.endsWith("writing-skills.json")) return JSON.stringify(writingConfig)
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
})