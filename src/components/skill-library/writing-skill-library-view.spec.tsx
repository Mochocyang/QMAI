// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"
import { WritingSkillLibrarySidebarPanel, WritingSkillLibraryView } from "./writing-skill-library-view"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const readFileMock = vi.hoisted(() => vi.fn())
const writeFileAtomicMock = vi.hoisted(() => vi.fn())
const joinMock = vi.hoisted(() => vi.fn(async (...parts: string[]) => parts.join("/")))
let savedConfigContent = ""

vi.mock("@/commands/fs", () => ({
  readFile: readFileMock,
  writeFileAtomic: writeFileAtomicMock,
}))

vi.mock("@tauri-apps/api/path", () => ({
  join: joinMock,
}))

async function renderLibrary() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <>
        <WritingSkillLibrarySidebarPanel />
        <WritingSkillLibraryView />
      </>,
    )
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

async function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
    valueSetter?.call(textarea, value)
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }))
    textarea.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

async function click(button: HTMLElement | null) {
  if (!button) throw new Error("button not found")
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
  await flushEffects()
}

describe("WritingSkillLibraryView", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    savedConfigContent = ""
    readFileMock.mockImplementation(async () => {
      if (savedConfigContent) return savedConfigContent
      throw new Error("missing")
    })
    writeFileAtomicMock.mockImplementation(async (_path: string, content: string) => {
      savedConfigContent = content
    })
    useWikiStore.getState().setProject({
      id: "p1",
      name: "测试项目",
      path: "C:/project",
    })
    ;(useWikiStore.getState() as any).setWritingSkillLibraryDraftDirty?.(false)
    ;(useWikiStore.getState() as any).setSelectedWritingSkillLibrarySkillId?.(null)
  })

  it("creates and saves a classified writing skill", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1234)
    const { container, root } = await renderLibrary()

    expect(container.querySelector('[data-testid="writing-skill-library-view"]')).not.toBeNull()
    expect(container.textContent).toContain("写作 Skill")

    const createButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("新建 Skill"))
    await click(createButton ?? null)

    await setInputValue(container.querySelector('[data-testid="writing-skill-name-input"]')!, "三翻四抖")
    await setInputValue(container.querySelector('[data-testid="writing-skill-description-input"]')!, "三次转折，四次震惊。")
    await setTextareaValue(
      container.querySelector('[data-testid="writing-skill-content-input"]')!,
      "每章设置三次局势变化和四次信息冲击。",
    )
    await click(container.querySelector('[data-testid="writing-skill-kind-review"]'))
    await click(container.querySelector('[data-testid="writing-skill-stage-review"]'))
    await click(container.querySelector('[data-testid="writing-skill-mode-fast"]'))

    await click(container.querySelector('[data-testid="writing-skill-save-button"]'))

    const saved = JSON.parse(savedConfigContent)
    expect(saved.skills[0]).toMatchObject({
      id: "skill:1234",
      name: "三翻四抖",
      description: "三次转折，四次震惊。",
      kind: ["structure", "planning", "review"],
      stages: ["planning", "drafting", "review"],
      modes: ["standard", "strict", "fast"],
      content: "每章设置三次局势变化和四次信息冲击。",
      source: "uploaded",
    })

    nowSpy.mockRestore()
    cleanup(root, container)
  })

  it("disables and deletes writing skills from the separate library", async () => {
    savedConfigContent = JSON.stringify({
      version: 1,
      selectedSkillId: "skill:three",
      disabledSkillIds: [],
      skills: [{
        id: "skill:three",
        name: "三翻四抖",
        description: "三次转折，四次震惊。",
        kind: ["structure", "planning"],
        stages: ["planning", "drafting"],
        modes: ["standard", "strict"],
        content: "每章设置三次局势变化和四次信息冲击。",
        source: "uploaded",
      }],
    })
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true)
    const { container, root } = await renderLibrary()

    const enabled = container.querySelector<HTMLInputElement>('[data-testid="writing-skill-enabled-checkbox"]')
    expect(enabled?.checked).toBe(true)
    await click(enabled)
    expect(JSON.parse(savedConfigContent).disabledSkillIds).toEqual(["skill:three"])

    await click(container.querySelector('[data-testid="writing-skill-delete-button"]'))
    const saved = JSON.parse(savedConfigContent)
    expect(saved.skills.length).toBeGreaterThanOrEqual(10)
    expect(saved.skills.find((s: any) => s.id === "skill:three")).toBeUndefined()
    expect(saved.skills[0].source).toBe("built-in")
    expect(saved.selectedSkillId).toBe(saved.skills[0].id)

    confirmSpy.mockRestore()
    cleanup(root, container)
  })
})
