import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { BookAnalysisLibraryState } from "@/lib/novel/book-analysis/library-state"
import { BookAnalysisLibraryLayout } from "./book-analysis-library-layout"

const state: BookAnalysisLibraryState = {
  enabledStyle: {
    id: "style-1",
    name: "凡人修仙传 · 文风",
    sourceBook: "凡人修仙传",
    profile: {
      schemaVersion: 1,
      generatedAt: 1,
      sampledChapterIds: ["ch-1"],
      narrativeDensity: "叙事密度中高",
      descriptionWeight: "描写克制",
      emotionRendering: "",
      sentenceStyle: "",
      rhetoricDensity: "",
      transitionStyle: "",
      narrativeVoice: "",
      dialogueStyle: "对白留白",
      thematicHabits: "",
      constitution: "1. 动作推进优先",
      samples: [],
    },
    createdAt: 1,
    updatedAt: 1,
  },
  bindings: [{ characterName: "主角", auraId: "aura-hanli", auraName: "韩立" }],
  books: [
    {
      id: "book-1",
      path: "E:/Novel/book-analysis/book-1",
      metadata: {
        title: "凡人修仙传",
        author: "忘语",
        totalChapters: 10,
        totalWords: 100000,
        sourceType: "file",
        createdAt: 1,
        updatedAt: 2,
      },
      styleStatus: "enabled",
      styleProfile: {
        schemaVersion: 1,
        generatedAt: 1,
        sampledChapterIds: ["ch-1"],
        narrativeDensity: "叙事密度中高",
        descriptionWeight: "描写克制",
        emotionRendering: "",
        sentenceStyle: "",
        rhetoricDensity: "",
        transitionStyle: "",
        narrativeVoice: "",
        dialogueStyle: "对白留白",
        thematicHabits: "",
        constitution: "1. 动作推进优先",
        samples: [],
      },
      boundAurasCount: 1,
      addedAuraCharacterIds: [],
      recognizedCharacters: [],
      characters: [{
        id: "char-hanli",
        name: "韩立",
        aliases: [],
        importance: 9,
        category: "protagonist",
        firstAppearance: 1,
        lastAppearance: 10,
        appearanceCount: 10,
        description: "谨慎",
        personality: "隐忍",
        speechStyle: "少承诺",
        relationships: [],
        keyEvents: [],
      }],
      skills: [{
        id: "skill-char-hanli",
        characterId: "char-hanli",
        characterName: "韩立",
        skillContent: "# 韩立",
        sourceBook: "凡人修仙传",
        chapterRange: ["1", "10"],
        createdAt: 1,
      }],
    },
  ],
}

describe("BookAnalysisLibraryLayout", () => {
  it("renders the three-column library state", () => {
    const html = renderToStaticMarkup(
      <BookAnalysisLibraryLayout
        state={state}
        selectedBookId="book-1"
        selectedCharacterId="char-hanli"
        extractingStyle={false}
        extractingCharacters={false}
        addingToSoul={false}
        onSelectBook={vi.fn()}
        onSelectCharacter={vi.fn()}
        onImportNovel={vi.fn()}
        onExtractStyle={vi.fn()}
        onToggleStyle={vi.fn()}
        onAddSelectedSkillsToSoul={vi.fn()}
        onReextractCharacters={vi.fn()}
        onDeleteBook={vi.fn()}
      />,
    )

    expect(html).toContain("拆书库")
    expect(html).toContain("启用文风")
    expect(html).toContain("凡人修仙传")
    expect(html).toContain("作品文风")
    expect(html).toContain("角色 Skill")
    expect(html).toContain("当前 AI 会话约束")
    expect(html).toContain("主角")
    expect(html).toContain("韩立")
    expect(html).toContain("重新提取角色")
    expect(html).toContain("重新提取文风")
  })
})
