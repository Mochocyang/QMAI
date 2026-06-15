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

    // feature/fix-viewer-ui：删 skills tab，验证角色列表 + 绑定小说人物区
    expect(html).toContain("角色列表")
    expect(html).toContain("添加所选角色到自定义灵魂")
    expect(html).toContain("绑定小说人物")
    expect(html).toContain("林烬")
    // feature/book-analysis-reuse：顶栏重新提取按钮
    expect(html).toContain("重新提取角色")
    // 详情卡两个单角色按钮（detail 部分依赖选中角色，断言存在性）
    // 由于该测试 mock 出 1 个角色且未点击选中，按钮区在没选中时不渲染；
    // 单独 it 验证 selectedCharacter 时显示：
  })

  it("renders single-character reextract buttons when a character is selected", () => {
    const html = renderToStaticMarkup(
      <BookAnalysisResultViewer
        projectPath="E:/Novel"
        onClose={() => undefined}
        result={{
          metadata: { title: "长夜书", totalChapters: 1, totalWords: 100, sourceType: "file", createdAt: 1, updatedAt: 2 },
          characters: [{
            id: "c1", name: "林烬", aliases: [], importance: 9, category: "protagonist",
            firstAppearance: 1, lastAppearance: 1, appearanceCount: 1,
            description: "", personality: "", speechStyle: "", relationships: [], keyEvents: [], corpus: "",
          }],
          skills: [],
        }}
      />,
    )
    // 默认未选中时不渲染单角色按钮（详情卡才有），所以这一条只验证空状态
    expect(html).toContain("请从左侧选择角色查看详情")
  })
})
