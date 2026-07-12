import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { BookAnalysisLibraryState } from "@/lib/novel/book-analysis/library-state"
import type { PlotFramework } from "@/lib/novel/plot-framework"
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

const storyFrameworks: PlotFramework[] = [
  {
    id: "framework-book-1",
    title: "先压后扬的误解反转",
    beats: {
      hook: "开局用错误判断制造强期待。",
      buildup: "铺垫规则压力、旁人轻视和主角的被动处境。",
      payoff: "爽点由主角反手证明自己并释放压抑情绪。",
      endingHook: "结尾抛出更高层的新误会，推动下一轮期待。",
    },
    rangeChapterIds: ["ch-0001", "ch-0002"],
    line: "main",
    characters: [],
    foreshadowing: [],
    reusableTemplate: "先压后扬",
    directionHints: "",
    handcraftHints: "作者手搓留白：爽点处补角色台词。",
    sourceDismantlingProjectId: "book-analysis:book-1",
    sourceDismantlingProjectTitle: "凡人修仙传",
    createdAt: 1,
    updatedAt: 1,
  },
]

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
        importTaskPanel={<div>批量导入任务</div>}
        storyFrameworks={storyFrameworks}
        onSelectBook={vi.fn()}
        onSelectCharacter={vi.fn()}
        onImportNovel={vi.fn()}
        onExtractStyle={vi.fn()}
        onToggleStyle={vi.fn()}
        onAddSelectedSkillsToSoul={vi.fn()}
        onReextractCharacters={vi.fn()}
        extractingStoryFramework={false}
        onExtractStoryFramework={vi.fn()}
        onCreateOutlineFromFramework={vi.fn()}
        onDeleteBook={vi.fn()}
      />,
    )

    expect(html).toContain("拆书库")
    expect(html).toContain("批量导入任务")
    const headerTextIndex = html.indexOf("管理作品文风、角色 Skill 和小说人物绑定。")
    const importTaskPanelIndex = html.indexOf(">批量导入任务</div>")
    const bookContentTitleIndex = html.indexOf('<h3 class="text-lg font-semibold">凡人修仙传</h3>')
    expect(headerTextIndex).toBeGreaterThanOrEqual(0)
    expect(importTaskPanelIndex).toBeGreaterThan(headerTextIndex)
    expect(bookContentTitleIndex).toBeGreaterThan(importTaskPanelIndex)
    expect(html).toContain('class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5"')
    expect(html).toContain("启用文风")
    expect(html).toContain("凡人修仙传")
    expect(html).toContain("作品文风")
    expect(html).toContain("角色 Skill")
    expect(html).toContain("当前 AI 会话约束")
    expect(html).toContain("主角")
    expect(html).toContain("韩立")
    expect(html).toContain("重新提取角色")
    expect(html).toContain("重新提取文风")
    expect(html).toContain("故事框架提取")
    expect(html).toContain("故事框架")
    expect(html).toContain("从选中章节提取钩子、铺垫、爽点和结尾钩子")
    expect(html).toContain("查看完整框架")
    expect(html).toContain("开局钩子")
    expect(html).toContain("铺垫")
    expect(html).toContain("爽点")
    expect(html).toContain("结尾钩子")
    expect(html).toContain("结尾抛出更高层的新误会，推动下一轮期待。")
    expect(html).toContain("基于此框架创建章纲")
  })
})
