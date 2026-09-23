// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { BookAnalysisRunDialog } from "./book-analysis-run-dialog"
import {
  buildAnalysisChunkPlan,
  computeAnalysisChunkCharLimit,
} from "@/lib/novel/book-analysis/analysis-chunk-planner"
import { CHAPTER_BODY_EXCERPT_MAX_CHARS } from "@/lib/novel/chapter-excerpts"

// 模型下拉本身依赖 wiki store 与 provider 配置，这里只关心它选中的值有没有透传出去
vi.mock("@/components/chat/chat-model-selector", () => ({
  ChatModelSelector: ({ value, onChange }: { value: string; onChange: (model: string) => void }) => (
    <input aria-label="分析模型" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}))

vi.mock("@/lib/novel/book-analysis/analysis-model-resolver", () => ({
  resolveTaskLlmConfig: () => ({ maxContextSize: 200_000 }),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const chapters = Array.from({ length: 3 }, (_, index) => ({
  chapterId: `ch-000${index + 1}`,
  title: `第 ${index + 1} 章`,
  order: index + 1,
  wordCount: 1000,
  selected: false,
  analyzed: false,
}))

function renderDialog(props: Partial<Parameters<typeof BookAnalysisRunDialog>[0]> = {}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <BookAnalysisRunDialog
        open
        chapters={chapters}
        initialSkills={["style"]}
        initialRange={{ startOrder: 1, endOrder: 2 }}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        {...props}
      />,
    )
  })
  return {
    cleanup: () => {
      act(() => root.unmount())
      document.body.removeChild(container)
    },
  }
}

function queryAll(selector: string): HTMLElement[] {
  return Array.from(document.body.querySelectorAll<HTMLElement>(selector))
}

function findByText(selector: string, text: string): HTMLElement | undefined {
  return queryAll(selector).find((element) => element.textContent?.includes(text))
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

describe("BookAnalysisRunDialog 深度与模型", () => {
  it("勾选文风时显示深度单选，默认完整", async () => {
    const { cleanup } = renderDialog()
    await act(async () => { await Promise.resolve() })

    const depthRadios = queryAll('input[name="style-depth"]') as HTMLInputElement[]
    expect(depthRadios.map((radio) => radio.value)).toEqual(["full", "fast"])
    expect(depthRadios.find((radio) => radio.checked)?.value).toBe("full")
    cleanup()
  })

  it("未勾选文风时不显示深度单选", async () => {
    const { cleanup } = renderDialog({ initialSkills: ["story"], lockedSkills: ["story"] })
    await act(async () => { await Promise.resolve() })

    expect(queryAll('input[name="style-depth"]')).toHaveLength(0)
    cleanup()
  })

  it("提交时带上所选深度与模型", async () => {
    const onSubmit = vi.fn()
    const { cleanup } = renderDialog({ onSubmit })
    await act(async () => { await Promise.resolve() })

    const fastRadio = queryAll('input[name="style-depth"]').find(
      (radio) => (radio as HTMLInputElement).value === "fast",
    ) as HTMLInputElement
    await act(async () => { fastRadio.click() })

    const modelInput = document.body.querySelector<HTMLInputElement>('input[aria-label="分析模型"]')!
    await act(async () => { setInputValue(modelInput, " openai/gpt-4o-mini ") })

    const submitButton = findByText("button", "开始分析")!
    await act(async () => { submitButton.click() })

    expect(onSubmit).toHaveBeenCalledWith({
      range: { startOrder: 1, endOrder: 2 },
      selectedSkills: ["style"],
      modelKey: "openai/gpt-4o-mini",
      styleDepth: "fast",
    })
    cleanup()
  })

  it("打开时回填上次用过的模型与深度", async () => {
    const { cleanup } = renderDialog({
      initialModelKey: "openai/gpt-4o-mini",
      initialStyleDepth: "fast",
    })
    await act(async () => { await Promise.resolve() })

    const modelInput = document.body.querySelector<HTMLInputElement>('input[aria-label="分析模型"]')!
    expect(modelInput.value).toBe("openai/gpt-4o-mini")
    const checked = (queryAll('input[name="style-depth"]') as HTMLInputElement[]).find((radio) => radio.checked)
    expect(checked?.value).toBe("fast")
    cleanup()
  })
})

describe("BookAnalysisRunDialog 分片预估", () => {
  const babylonChapters = [9683, 20060, 26139, 21322, 50165, 60700, 25222, 20085].map((wordCount, index) => ({
    chapterId: `ch-${String(index + 1).padStart(4, "0")}`,
    title: `第 ${index + 1} 章`,
    order: index + 1,
    wordCount,
    selected: false,
    analyzed: false,
  }))

  it("预估片数与 buildAnalysisChunkPlan 一致", async () => {
    const { cleanup } = renderDialog({
      chapters: babylonChapters,
      initialRange: { startOrder: 1, endOrder: 8 },
    })
    await act(async () => { await Promise.resolve() })

    const expected = buildAnalysisChunkPlan(
      babylonChapters.map((chapter) => ({ id: chapter.chapterId, order: chapter.order, wordCount: chapter.wordCount })),
      { startOrder: 1, endOrder: 8 },
      { maxChunkChars: computeAnalysisChunkCharLimit(200_000) },
    )
    expect(findByText("p", `预计 ${expected.length} 个章节区块`)).toBeTruthy()
    cleanup()
  })

  it("范围内有超长章节时出现截断提示", async () => {
    const mixed = Array.from({ length: 8 }, (_, index) => ({
      chapterId: `ch-${String(index + 1).padStart(4, "0")}`,
      title: `第 ${index + 1} 章`,
      order: index + 1,
      wordCount: index === 4 ? 50165 : index === 5 ? 60700 : 3000,
      selected: false,
      analyzed: false,
    }))
    const { cleanup } = renderDialog({
      chapters: mixed,
      initialRange: { startOrder: 1, endOrder: 8 },
    })
    await act(async () => { await Promise.resolve() })

    const limit = CHAPTER_BODY_EXCERPT_MAX_CHARS.toLocaleString()
    expect(findByText("p", `第 5、6 章超过 ${limit} 字，仅前 ${limit} 字会被分析`)).toBeTruthy()
    cleanup()
  })
})
