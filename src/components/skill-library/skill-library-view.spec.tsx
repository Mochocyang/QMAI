// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"
import { SkillLibrarySidebarPanel, SkillLibraryView } from "./skill-library-view"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const readFileMock = vi.hoisted(() => vi.fn())
const writeFileMock = vi.hoisted(() => vi.fn())
const joinMock = vi.hoisted(() => vi.fn(async (...parts: string[]) => parts.join("/")))
let savedConfigContent = ""

vi.mock("@/commands/fs", () => ({
  readFile: readFileMock,
  writeFile: writeFileMock,
}))

vi.mock("@tauri-apps/api/path", () => ({
  join: joinMock,
}))

async function renderView() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<SkillLibraryView />)
  })
  await flushEffects()
  return { container, root }
}

async function renderLibrary() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <>
        <SkillLibrarySidebarPanel />
        <SkillLibraryView />
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
    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: value ? "insertText" : "deleteContentBackward",
      data: value,
    }))
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

describe("SkillLibraryView", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    savedConfigContent = ""
    readFileMock.mockImplementation(async () => {
      if (savedConfigContent) return savedConfigContent
      throw new Error("missing")
    })
    writeFileMock.mockImplementation(async (_path: string, content: string) => {
      savedConfigContent = content
    })
    useWikiStore.getState().setProject({
      id: "p1",
      name: "测试项目",
      path: "C:/project",
    })
    useWikiStore.getState().setSkillLibraryDraftDirty(false)
    useWikiStore.getState().setSelectedSkillLibrarySkillId(null)
  })

  it("renders built-in skills and selected detail editor", async () => {
    const { container, root } = await renderView()

    expect(container.querySelector('[data-testid="skill-library-view"]')).not.toBeNull()
    expect(container.textContent).toContain("综合去AI味")
    expect(container.querySelector<HTMLInputElement>('[data-testid="skill-name-input"]')?.value).toBe("综合去AI味")

    cleanup(root, container)
  })

  it("allows editing a built-in skill and restoring its default content", async () => {
    const { container, root } = await renderView()
    const nameInput = container.querySelector<HTMLInputElement>('[data-testid="skill-name-input"]')
    const contentInput = container.querySelector<HTMLTextAreaElement>('[data-testid="skill-content-input"]')
    const saveButton = container.querySelector<HTMLButtonElement>('[data-testid="skill-save-button"]')
    const resetButton = container.querySelector<HTMLButtonElement>('[data-testid="skill-reset-default-button"]')

    expect(nameInput).not.toBeNull()
    expect(contentInput).not.toBeNull()
    expect(saveButton).not.toBeNull()
    expect(resetButton).not.toBeNull()
    expect(nameInput?.disabled).toBe(false)
    expect(contentInput?.disabled).toBe(false)
    expect(saveButton?.disabled).toBe(true)
    expect(resetButton?.disabled).toBe(true)

    await setInputValue(nameInput!, "综合去AI味-项目版")
    await setTextareaValue(contentInput!, "当前项目覆盖后的内置规则")
    expect(saveButton?.disabled).toBe(false)
    await act(async () => {
      saveButton?.click()
    })

    const saved = JSON.parse(savedConfigContent)
    expect(saved.builtInSkillOverrides[0]).toMatchObject({
      id: "built-in:comprehensive",
      name: "综合去AI味-项目版",
      content: "当前项目覆盖后的内置规则",
    })
    expect(container.querySelector<HTMLButtonElement>('[data-testid="skill-reset-default-button"]')?.disabled).toBe(
      false,
    )

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true)
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="skill-reset-default-button"]')?.click()
    })

    const restored = JSON.parse(savedConfigContent)
    expect(restored.builtInSkillOverrides).toEqual([])
    expect(container.querySelector<HTMLInputElement>('[data-testid="skill-name-input"]')?.value).toBe("综合去AI味")
    expect(confirmSpy).toHaveBeenCalledWith(
      "确定将「综合去AI味-项目版」恢复为内置默认内容吗？当前项目对此技能的修改会被清除。",
    )
    confirmSpy.mockRestore()

    cleanup(root, container)
  })

  it("warns before switching skills when the current draft is unsaved", async () => {
    const { container, root } = await renderLibrary()
    const nameInput = container.querySelector<HTMLInputElement>('[data-testid="skill-name-input"]')
    expect(nameInput).not.toBeNull()

    await setInputValue(nameInput!, "未保存的技能草稿")
    expect(useWikiStore.getState().skillLibraryDraftDirty).toBe(true)

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false)
    const reduceExplanationCard = container.querySelector<HTMLElement>('[data-skill-id="built-in:reduce-explanation"]')
    expect(reduceExplanationCard).not.toBeUndefined()

    await act(async () => {
      reduceExplanationCard?.click()
    })
    await flushEffects()

    expect(confirmSpy).toHaveBeenCalledWith("当前 Skill 还有未保存修改，确定放弃修改吗？")
    expect(container.querySelector<HTMLInputElement>('[data-testid="skill-name-input"]')?.value).toBe("未保存的技能草稿")
    expect(useWikiStore.getState().selectedSkillLibrarySkillId).toBe("built-in:comprehensive")

    confirmSpy.mockRestore()
    cleanup(root, container)
  })

  it("keeps save disabled when the draft has no real saved change", async () => {
    const { container, root } = await renderView()
    const nameInput = container.querySelector<HTMLInputElement>('[data-testid="skill-name-input"]')
    const saveButton = container.querySelector<HTMLButtonElement>('[data-testid="skill-save-button"]')
    expect(nameInput).not.toBeNull()
    expect(saveButton).not.toBeNull()

    expect(saveButton?.disabled).toBe(true)
    await setInputValue(nameInput!, "综合去AI味   ")

    expect(useWikiStore.getState().skillLibraryDraftDirty).toBe(false)
    expect(saveButton?.disabled).toBe(true)
    await act(async () => {
      saveButton?.click()
    })

    expect(writeFileMock).not.toHaveBeenCalled()
    cleanup(root, container)
  })

  it("discards unsaved draft changes and restores the selected skill content", async () => {
    const { container, root } = await renderView()
    const nameInput = container.querySelector<HTMLInputElement>('[data-testid="skill-name-input"]')
    const contentInput = container.querySelector<HTMLTextAreaElement>('[data-testid="skill-content-input"]')
    const discardButton = container.querySelector<HTMLButtonElement>('[data-testid="skill-discard-button"]')
    expect(nameInput).not.toBeNull()
    expect(contentInput).not.toBeNull()
    expect(discardButton).not.toBeNull()
    expect(discardButton?.disabled).toBe(true)

    await setInputValue(nameInput!, "未保存的技能草稿")
    await setTextareaValue(contentInput!, "未保存的规则")
    expect(useWikiStore.getState().skillLibraryDraftDirty).toBe(true)
    expect(discardButton?.disabled).toBe(false)

    await act(async () => {
      discardButton?.click()
    })

    expect(container.querySelector<HTMLInputElement>('[data-testid="skill-name-input"]')?.value).toBe("综合去AI味")
    expect(container.querySelector<HTMLTextAreaElement>('[data-testid="skill-content-input"]')?.value).toContain(
      "# de-AI-writing",
    )
    expect(useWikiStore.getState().skillLibraryDraftDirty).toBe(false)
    expect(writeFileMock).not.toHaveBeenCalled()

    cleanup(root, container)
  })

  it("saves the selected skill with Ctrl+S when the draft changed", async () => {
    const { container, root } = await renderView()
    const nameInput = container.querySelector<HTMLInputElement>('[data-testid="skill-name-input"]')
    expect(nameInput).not.toBeNull()

    await setInputValue(nameInput!, "综合去AI味-快捷保存")
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: "s",
      }))
    })
    await flushEffects()

    const saved = JSON.parse(savedConfigContent)
    expect(saved.builtInSkillOverrides[0]).toMatchObject({
      id: "built-in:comprehensive",
      name: "综合去AI味-快捷保存",
    })

    cleanup(root, container)
  })

  it("marks modified skills in the list and detail header", async () => {
    const { container, root } = await renderLibrary()
    const nameInput = container.querySelector<HTMLInputElement>('[data-testid="skill-name-input"]')
    const contentInput = container.querySelector<HTMLTextAreaElement>('[data-testid="skill-content-input"]')
    expect(nameInput).not.toBeNull()
    expect(contentInput).not.toBeNull()

    await setInputValue(nameInput!, "综合去AI味-项目版")
    await setTextareaValue(contentInput!, "当前项目覆盖后的内置规则")
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="skill-save-button"]')?.click()
    })

    expect(container.querySelectorAll('[data-testid="skill-modified-badge"]').length).toBeGreaterThanOrEqual(2)
    expect(container.textContent).toContain("已修改")

    cleanup(root, container)
  })

  it("prevents saving an empty skill name", async () => {
    const { container, root } = await renderView()
    const nameInput = container.querySelector<HTMLInputElement>('[data-testid="skill-name-input"]')
    expect(nameInput).not.toBeNull()

    await setInputValue(nameInput!, "")
    await flushEffects()
    expect(nameInput!.value).toBe("")
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="skill-save-button"]')?.click()
    })
    await flushEffects()

    expect(container.textContent).toContain("技能名称不能为空")
    expect(writeFileMock).not.toHaveBeenCalled()

    cleanup(root, container)
  })
})
