// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import type { BookAnalysisLibraryBook } from "@/lib/novel/book-analysis/library-state"
import { BookAnalysisCharacterPanel } from "./book-analysis-character-panel"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const book: BookAnalysisLibraryBook = {
  id: "book-1",
  path: "E:/Novel/book-analysis/book-1",
  metadata: {
    title: "长夜书",
    totalChapters: 3,
    totalWords: 12000,
    sourceType: "file",
    createdAt: 1,
    updatedAt: 2,
  },
  recognizedCharacters: [],
  characters: [{
    id: "char-linjing",
    name: "林烬",
    aliases: [],
    importance: 9,
    category: "protagonist",
    firstAppearance: 1,
    lastAppearance: 3,
    appearanceCount: 3,
    description: "旧城巡夜人。",
    personality: "克制。",
    speechStyle: "短句。",
    relationships: [],
    keyEvents: [],
    corpus: "",
  }],
  skills: [{
    id: "skill-char-linjing",
    characterId: "char-linjing",
    characterName: "林烬",
    skillContent: "# 林烬 Skill",
    sourceBook: "长夜书",
    chapterRange: ["1", "3"],
    createdAt: 3,
  }],
  styleStatus: "missing",
  boundAurasCount: 0,
  addedAuraCharacterIds: [],
}

function renderPanel(
  props: Partial<Parameters<typeof BookAnalysisCharacterPanel>[0]> = {},
) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <BookAnalysisCharacterPanel
        book={book}
        selectedCharacterId="char-linjing"
        addingToSoul={false}
        onSelectCharacter={vi.fn()}
        onAddSelectedSkillsToSoul={vi.fn()}
        onOpenSkillSelection={vi.fn()}
        {...props}
      />,
    )
  })
  return {
    container,
    addButton: Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("自定义灵魂")) as HTMLButtonElement,
    cleanup: () => {
      act(() => root.unmount())
      document.body.removeChild(container)
    },
  }
}

describe("BookAnalysisCharacterPanel", () => {
  it("点击加入自定义灵魂库时只传当前选中角色的 skill", () => {
    const onAddSelectedSkillsToSoul = vi.fn()
    const { addButton, cleanup } = renderPanel({ onAddSelectedSkillsToSoul })

    act(() => addButton.click())

    expect(onAddSelectedSkillsToSoul).toHaveBeenCalledWith("skill-char-linjing")
    cleanup()
  })

  it("当前角色已加入自定义灵魂库时按钮不可点击", () => {
    const onAddSelectedSkillsToSoul = vi.fn()
    const { addButton, cleanup } = renderPanel({
      book: { ...book, addedAuraCharacterIds: ["char-linjing"] },
      onAddSelectedSkillsToSoul,
    })

    expect(addButton.disabled).toBe(true)
    expect(addButton.textContent).toContain("已加入自定义灵魂库")

    act(() => addButton.click())
    expect(onAddSelectedSkillsToSoul).not.toHaveBeenCalled()
    cleanup()
  })

  it("does not render the bind-to-novel-character action", () => {
    const { container, cleanup } = renderPanel()

    expect(container.textContent).not.toContain("绑定到小说人物")
    cleanup()
  })
})
