// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BookAnalysisLibraryBook } from "@/lib/novel/book-analysis/library-state"
import { BookAnalysisCharacterSkillDialog } from "./book-analysis-character-skill-dialog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const book = (overrides: Partial<BookAnalysisLibraryBook>): BookAnalysisLibraryBook => ({
  id: "book-1",
  path: "E:/Novel/book-analysis/book-1",
  metadata: {
    title: "测试作品",
    totalChapters: 20,
    totalWords: 20000,
    sourceType: "file",
    createdAt: 1,
    updatedAt: 1,
  },
  recognizedCharacters: [],
  characters: [],
  skills: [],
  styleStatus: "missing",
  boundAurasCount: 0,
  addedAuraCharacterIds: [],
  evidence: [],
  ...overrides,
})

const recognized = (overrides: Partial<BookAnalysisLibraryBook["recognizedCharacters"][number]>) => ({
  id: "char-hanli",
  name: "韩立",
  aliases: [],
  appearances: 30,
  chapterIndices: [0, 9],
  importanceScore: 92,
  category: "主角" as const,
  sourceBook: "E:/Novel/book-analysis/book-1",
  ...overrides,
})

let host: HTMLDivElement
let root: Root

function renderDialog(target: BookAnalysisLibraryBook) {
  act(() => {
    root.render(
      <BookAnalysisCharacterSkillDialog
        book={target}
        open
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )
  })
  // Base UI Dialog 渲染到 body portal，需从 document.body 断言
  return document.body.textContent ?? ""
}

describe("BookAnalysisCharacterSkillDialog 角色保存机制", () => {
  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it("识别角色存在时始终展示识别角色（即使已有深度分析结果）", () => {
    const text = renderDialog(book({
      characters: [{
        id: "char-hanli-deep",
        name: "韩立",
        aliases: [],
        importance: 9,
        category: "protagonist",
        firstAppearance: 1,
        lastAppearance: 20,
        appearanceCount: 30,
        description: "谨慎的凡人",
        personality: "隐忍",
        speechStyle: "少承诺",
        relationships: [],
        keyEvents: [],
      }],
      recognizedCharacters: [
        recognized({ id: "char-hanli", name: "韩立", importanceScore: 92, category: "主角" }),
        recognized({ id: "char-nanli", name: "南宫婉", importanceScore: 70, category: "配角" }),
      ],
    }))
    // 用户点「选择角色生成 Skill」应看到所有识别角色
    expect(text).toContain("韩立")
    expect(text).toContain("南宫婉")
    expect(text).toContain("已识别并保存的角色")
  })

  it("无识别记录时从深度分析角色推导候选", () => {
    const text = renderDialog(book({
      characters: [{
        id: "char-hanli",
        name: "韩立",
        aliases: [],
        importance: 9,
        category: "protagonist",
        firstAppearance: 1,
        lastAppearance: 20,
        appearanceCount: 30,
        description: "谨慎的凡人",
        personality: "隐忍",
        speechStyle: "少承诺",
        relationships: [],
        keyEvents: [],
      }],
      recognizedCharacters: [],
    }))
    expect(text).toContain("韩立")
    expect(text).toContain("谨慎的凡人")
  })

  it("识别角色按重要度降序展示", () => {
    const text = renderDialog(book({
      characters: [],
      recognizedCharacters: [
        recognized({ id: "char-a", name: "低分角色", importanceScore: 30 }),
        recognized({ id: "char-b", name: "高分角色", importanceScore: 90 }),
      ],
    }))
    const lowIndex = text.indexOf("低分角色")
    const highIndex = text.indexOf("高分角色")
    expect(highIndex).toBeGreaterThan(-1)
    expect(lowIndex).toBeGreaterThan(highIndex)
  })

  it("既无深度分析也无识别角色时显示空提示", () => {
    const text = renderDialog(book({}))
    expect(text).toContain("暂无可提取角色信息")
  })
})
