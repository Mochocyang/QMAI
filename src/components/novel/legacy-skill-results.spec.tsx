// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import type { BookAnalysisLibraryBook } from "@/lib/novel/book-analysis/library-state"
import { computeStyleMetrics } from "@/lib/novel/book-analysis/style-metrics"
import type { StoryMap } from "@/lib/novel/book-analysis/story-map-types"
import { LegacySkillResults } from "./legacy-skill-results"

// StoryMapContent 读盘，必须按 story-map-content.spec.tsx 的方式打桩。
const listStoryMapHistory = vi.hoisted(() => vi.fn())
const readFile = vi.hoisted(() => vi.fn())

vi.mock("@/commands/fs", () => ({ readFile }))
vi.mock("@/lib/novel/book-analysis/story-map-history", () => ({ listStoryMapHistory }))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const baseCharacter = {
  id: "char-linjing",
  name: "林烬",
  aliases: [],
  importance: 9,
  category: "protagonist" as const,
  firstAppearance: 1,
  lastAppearance: 3,
  appearanceCount: 3,
  description: "旧城巡夜人。",
  personality: "克制。",
  speechStyle: "短句。",
  relationships: [],
  keyEvents: [],
  corpus: "",
}

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
  characters: [
    baseCharacter,
    { ...baseCharacter, id: "char-suwan", name: "苏晚", importance: 7, category: "supporting" },
  ],
  skills: [
    {
      id: "skill-char-linjing",
      characterId: "char-linjing",
      characterName: "林烬",
      skillContent: "# 林烬 Skill",
      sourceBook: "长夜书",
      chapterRange: ["1", "3"],
      createdAt: 3,
    },
    {
      id: "skill-char-suwan",
      characterId: "char-suwan",
      characterName: "苏晚",
      skillContent: "# 苏晚 Skill",
      sourceBook: "长夜书",
      chapterRange: ["1", "2"],
      createdAt: 3,
    },
  ],
  styleProfile: {
    schemaVersion: 2,
    generatedAt: 3,
    sampledChapterIds: ["chapter-1"],
    metrics: computeStyleMetrics(["他走了。她没动。\n\n“别过来。”"]),
    layers: {
      languageDna: "句子偏短，多用句号收尾。",
      structurePatterns: "",
      cognitiveFrame: "",
      rhythmGuide: "",
    },
    integratedDna: "# Writing DNA\n\n句子偏短，多用句号收尾。",
    constitution: "不要写超过二十字的长句。",
    samples: ["他走了。她没动。"],
  },
  // enabled 是为了把「已启用／取消启用」这对状态标记与操作一起逼出来
  styleStatus: "enabled",
  boundAurasCount: 0,
  addedAuraCharacterIds: [],
  evidence: [],
}

function makeMap(createdAt: number, mainLineLabel: string, orders: number[]): StoryMap {
  return {
    schemaVersion: 1,
    bookId: "book-1",
    bookTitle: "测试作品",
    mainLineLabel,
    mainSummary: "",
    createdAt,
    chapters: orders.map((order) => ({
      id: `ch-${order}`,
      order,
      title: `第${order}章`,
      summary: "摘要",
      mainEvents: [{ label: `主线事件${order}`, beats: [], characters: [] }],
      branches: [],
    })),
  }
}

/** props 最后展开：测试可以覆盖 fixture，也可以传 undefined 关掉某个 prop。 */
function renderResults(
  props: Partial<Parameters<typeof LegacySkillResults>[0]> = {},
) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<LegacySkillResults book={book} skill="characters" {...props} />)
  })
  return {
    container,
    /** 只取按钮文案：说明段落里也有「提取文风」这类字样，不能拿 textContent 当按钮断言。 */
    buttonLabels: () =>
      Array.from(container.querySelectorAll("button")).map((button) => button.textContent?.trim() ?? ""),
    /** 再渲染一次并换掉部分 props（改刷新键等）。 */
    rerender: (next: Partial<Parameters<typeof LegacySkillResults>[0]>) =>
      act(() => {
        root.render(<LegacySkillResults book={book} skill="characters" {...props} {...next} />)
      }),
    cleanup: () => {
      act(() => root.unmount())
      document.body.removeChild(container)
    },
  }
}

describe("LegacySkillResults 按页签呈现旧版结果", () => {
  it("角色页签：整块不再渲染——角色已由工作台并入新版条目", () => {
    // fixture 里仍然有旧版角色数据（book.characters / book.skills），
    // 但工作台已经把它们合并进新版条目，本组件再渲染一遍就是同一页签里的第三份列表。
    const { container, cleanup } = renderResults({ skill: "characters" })

    expect(container.querySelector('[data-testid="legacy-skill-results"]')).toBeNull()
    // 不是「区域还在但空了」：这一支直接返回 null，容器里应当什么都没有。
    expect(container.innerHTML).toBe("")
    // 旧版角色面板自己的内容（含曾经靠 variant="embedded" 隐藏的两个顶层按钮）也不该出现。
    expect(container.textContent).not.toContain("林烬")
    cleanup()
  })

  it("文风页签：作品没有旧版文风画像时，整块不渲染", () => {
    const { container, cleanup } = renderResults({
      skill: "style",
      book: { ...book, characters: [], skills: [], styleProfile: undefined },
    })

    expect(container.querySelector('[data-testid="legacy-skill-results"]')).toBeNull()
    cleanup()
  })

  it("故事页签：没有历史导图时，整块不渲染", async () => {
    // 故事页签的空要从盘上读出来，不是看 book 上的字段。
    listStoryMapHistory.mockResolvedValue([])
    readFile.mockResolvedValue(null)
    const { container, cleanup } = renderResults({ skill: "story" })
    await act(async () => {})

    expect(container.querySelector('[data-testid="legacy-skill-results"]')).toBeNull()
    cleanup()
  })

  it("故事页签：判定为空后刷新键变化会重新判断，新导图仍然能出现", async () => {
    // 空的时候整块不渲染，故事内容组件就跟着卸载了——如果不再判断一次，
    // 「先判空、后生成导图」就会永远看不到那张导图。
    listStoryMapHistory.mockResolvedValue([])
    readFile.mockResolvedValue(null)
    const { container, rerender, cleanup } = renderResults({ skill: "story", storyMapRefreshKey: 0 })
    await act(async () => {})
    expect(container.querySelector('[data-testid="legacy-skill-results"]')).toBeNull()

    listStoryMapHistory.mockResolvedValue([{
      dirName: "story-map-1",
      map: makeMap(1, "主线A", [1]),
      jsonPath: "E:/book/story-maps/story-map-1/story-map.json",
      htmlPath: "E:/book/story-maps/story-map-1/story-map.html",
    }])
    readFile.mockResolvedValue("<html>map</html>")
    // 工作台在故事任务完成后递增刷新键
    rerender({ storyMapRefreshKey: 1 })
    await act(async () => {})

    expect(container.querySelector('[data-testid="legacy-skill-results"]')).not.toBeNull()
    expect(container.textContent).toContain("《测试作品》故事导图")
    cleanup()
  })

  it("文风页签：渲染旧版文风结果，且不出现任何管理类控件", async () => {
    const { container, buttonLabels, cleanup } = renderResults({ skill: "style" })

    // 结果本身在
    expect(container.textContent).toContain("作品文风 · Writing DNA")
    expect(container.textContent).toContain("L1 语言 DNA")
    // 无障碍：区域要有自己的名字。role="region" 必须一起断言——aria-label 落在隐式
    // role=generic 的裸 div 上是禁止的命名来源（ARIA 1.2），少了 role 读屏就忽略它，
    // 只查 aria-label 会放过这个退化。
    const region = container.querySelector('[data-testid="legacy-skill-results"]')
    expect(region?.getAttribute("role")).toBe("region")
    expect(region?.getAttribute("aria-label")).toBe("旧版资料")
    // 管理类控件必须全部消失
    const labels = buttonLabels()
    // 正向控制：按钮列表本身非空，否则上面的 not.toContain 全都可以被空列表满足。
    // 这是作品已有 styleProfile 时展开按钮的默认（收起）文案。
    expect(labels).toContain("查看分层产物、整合文档与代表样本")
    expect(labels.some((label) => label.includes("提取文风"))).toBe(false)
    expect(labels).not.toContain("启用此文风")
    expect(labels).not.toContain("取消启用")
    expect(labels).not.toContain("删除文风")
    cleanup()
  })

  it("故事页签：渲染历史导图并保留「查看全部」，但不出现「删除」", async () => {
    listStoryMapHistory.mockResolvedValue([{
      dirName: "story-map-100",
      map: makeMap(100, "主线A", [1, 2]),
      jsonPath: "E:/book/story-maps/story-map-100/story-map.json",
      htmlPath: "E:/book/story-maps/story-map-100/story-map.html",
    }])
    readFile.mockResolvedValue("<html>map</html>")
    const { container, buttonLabels, cleanup } = renderResults({ skill: "story" })
    await act(async () => {})

    expect(container.textContent).toContain("《测试作品》故事导图")
    // 故事页签必须写「历史导图」：新版结果区展示的是当前那一份，维度不同，标题不能含糊。
    expect(container.querySelector(".wb-legacy-hint")?.textContent).toBe("旧版历史导图")
    // 无障碍名跟着提示走：区域必须能被读屏命名（role=region + aria-label，理由见文风页签那条）。
    const region = container.querySelector('[data-testid="legacy-skill-results"]')
    expect(region?.getAttribute("role")).toBe("region")
    expect(region?.getAttribute("aria-label")).toBe("旧版历史导图")
    const labels = buttonLabels()
    expect(labels).toContain("查看全部")
    expect(labels).not.toContain("删除")
    cleanup()
  })
})
