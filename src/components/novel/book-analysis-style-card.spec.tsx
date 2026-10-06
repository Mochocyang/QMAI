// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import type { BookAnalysisLibraryBook } from "@/lib/novel/book-analysis/library-state"
import { computeStyleMetrics } from "@/lib/novel/book-analysis/style-metrics"
import { BookAnalysisStyleCard } from "./book-analysis-style-card"

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
  characters: [],
  skills: [],
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
  styleStatus: "available",
  boundAurasCount: 0,
  addedAuraCharacterIds: [],
  evidence: [],
}

function renderCard(
  props: Partial<Parameters<typeof BookAnalysisStyleCard>[0]> = {},
) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <BookAnalysisStyleCard
        book={book}
        extracting={false}
        onExtractStyle={vi.fn()}
        onToggleStyle={vi.fn()}
        onDeleteStyle={vi.fn()}
        {...props}
      />,
    )
  })
  return {
    container,
    cleanup: () => {
      act(() => root.unmount())
      document.body.removeChild(container)
    },
  }
}

/** 只取按钮文案：说明段落里也有「重新提取」这类字样，不能拿 textContent 当按钮断言。 */
function buttonLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("button")).map((button) => button.textContent?.trim() ?? "")
}

describe("BookAnalysisStyleCard", () => {
  it("embedded 模式隐藏管理工具条，但保留标题、六层蒸馏与统计指标", () => {
    // 真实嵌入用法不传任何管理类回调（与 Task 1 的角色面板一致），这里必须一致
    const { container, cleanup } = renderCard({
      variant: "embedded",
      onExtractStyle: undefined,
      onToggleStyle: undefined,
      onDeleteStyle: undefined,
    })
    const labels = buttonLabels(container)
    expect(labels).not.toContain("删除文风")
    expect(labels).not.toContain("启用此文风")
    expect(labels).not.toContain("取消启用")
    expect(labels.some((l) => l.includes("提取文风"))).toBe(false)
    // 结果本身必须还在
    expect(container.textContent).toContain("作品文风 · Writing DNA")
    expect(container.textContent).toContain("L1 语言 DNA")
    expect(container.textContent).toContain("脚本统计（L1 / L6 确定性指标）")
    expect(container.querySelector("section")?.className ?? "").not.toContain("border")
    cleanup()
  })

  it("full 模式仍然显示管理工具条（旧版页面不受影响）", () => {
    const { container, cleanup } = renderCard()
    const labels = buttonLabels(container)
    expect(labels.some((l) => l.includes("提取文风"))).toBe(true)
    expect(labels).toContain("启用此文风")
    expect(labels).toContain("删除文风")
    expect(container.querySelector("section")?.className ?? "").toContain("border")
    cleanup()
  })

  it("缺少删除回调时不渲染删除按钮（避免点了没反应的死按钮）", () => {
    const { container, cleanup } = renderCard({ onDeleteStyle: undefined })
    const labels = buttonLabels(container)
    expect(labels).not.toContain("删除文风")
    cleanup()
  })

  it("variant 只管边框：embedded 下传了回调，管理按钮照常可用", () => {
    const onExtractStyle = vi.fn()
    const { container, cleanup } = renderCard({ variant: "embedded", onExtractStyle })
    const labels = buttonLabels(container)
    expect(labels.some((l) => l.includes("提取文风"))).toBe(true)
    expect(labels).toContain("删除文风")
    expect(container.querySelector("section")?.className ?? "").not.toContain("border")
    cleanup()
  })
})
