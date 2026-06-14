import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { BookAnalysisResultViewer } from "./book-analysis-result-viewer"

vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: (selector: (state: any) => unknown) => selector({
    project: { id: "p1", name: "Novel", path: "E:/Novel" },
    bumpDataVersion: vi.fn(),
  }),
}))

vi.mock("@/stores/book-analysis-store", () => ({
  useBookAnalysisStore: (selector: (state: any) => unknown) => selector({
    tasks: [],
  }),
}))

vi.mock("@/lib/novel/character-aura", () => ({
  bindCharacterAura: vi.fn(),
  listBindableNovelCharacters: vi.fn(async () => ["林烬", "沈微"]),
}))

describe("BookAnalysisResultViewer", () => {
  it("renders selected Skill import controls for generated character skills", () => {
    const html = renderToStaticMarkup(
      <BookAnalysisResultViewer
        projectPath="E:/Novel"
        onClose={() => undefined}
        result={{
          metadata: {
            title: "长夜书",
            totalChapters: 3,
            totalWords: 12000,
            sourceType: "file",
            createdAt: 1,
            updatedAt: 2,
          },
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
            corpus: "样本文本",
          }],
          skills: [{
            id: "skill-char-linjing",
            characterId: "char-linjing",
            characterName: "林烬",
            skillContent: "# 林烬",
            sourceBook: "长夜书",
            chapterRange: ["1", "3"],
            createdAt: 3,
            filePath: "E:/Novel/book-analysis/book-1/skills/林烬-skill.md",
          }],
        }}
      />,
    )

    expect(html).toContain("生成的 Skills")
    expect(html).toContain("添加所选 Skill 到自定义灵魂")
    expect(html).toContain("绑定到小说人物")
    expect(html).toContain("林烬")
  })
})
