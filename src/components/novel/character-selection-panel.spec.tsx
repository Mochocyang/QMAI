// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, it, expect, vi } from "vitest"
import { CharacterSelectionPanel } from "./character-selection-panel"
import type { RecognizedCharacter } from "@/lib/novel/book-analysis/types"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// 等待 microtask 清空（@base-ui/react 的 Dialog 是异步打开的）
async function flushAsync() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

describe("CharacterSelectionPanel", () => {
  const characters: RecognizedCharacter[] = [
    { id: "1", name: "许七安", aliases: [], appearances: 5, chapterIndices: [0, 1, 2], importanceScore: 95, category: "主角", sourceBook: "test" },
    { id: "2", name: "临安公主", aliases: [], appearances: 3, chapterIndices: [0, 1], importanceScore: 60, category: "配角", sourceBook: "test" },
    { id: "3", name: "路人甲", aliases: [], appearances: 2, chapterIndices: [0], importanceScore: 20, category: "次要", sourceBook: "test" },
  ]

  function renderPanel(
    props: Parameters<typeof CharacterSelectionPanel>[0]
  ): { container: HTMLDivElement; cleanup: () => void } {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
      root.render(<CharacterSelectionPanel {...props} />)
    })
    return {
      container,
      cleanup: () => {
        act(() => root.unmount())
        document.body.removeChild(container)
      },
    }
  }

  function getAllBodyHtml(): string {
    return document.body.innerHTML
  }

  it("渲染所有识别出的角色", async () => {
    const { cleanup } = renderPanel({
      characters,
      selectedIds: [],
      onToggle: vi.fn(),
      onSelectAllMain: vi.fn(),
      onClear: vi.fn(),
      onDeepExtract: vi.fn(),
      onSimpleExtract: vi.fn(),
      onCancel: vi.fn(),
    })
    await flushAsync()
    const html = getAllBodyHtml()
    expect(html).toContain("许七安")
    expect(html).toContain("临安公主")
    expect(html).toContain("路人甲")
    cleanup()
  })

  it("标题显示识别出 N 个角色", async () => {
    const { cleanup } = renderPanel({
      characters,
      selectedIds: [],
      onToggle: vi.fn(),
      onSelectAllMain: vi.fn(),
      onClear: vi.fn(),
      onDeepExtract: vi.fn(),
      onSimpleExtract: vi.fn(),
      onCancel: vi.fn(),
    })
    await flushAsync()
    expect(getAllBodyHtml()).toContain("识别出 3 个角色")
    cleanup()
  })

  it("未选时两个提取按钮显示 0 个角色", async () => {
    const { cleanup } = renderPanel({
      characters,
      selectedIds: [],
      onToggle: vi.fn(),
      onSelectAllMain: vi.fn(),
      onClear: vi.fn(),
      onDeepExtract: vi.fn(),
      onSimpleExtract: vi.fn(),
      onCancel: vi.fn(),
    })
    await flushAsync()
    expect(getAllBodyHtml()).toContain("0 个角色")
    cleanup()
  })

  it("已选 1 个时按钮显示 1 个角色", async () => {
    const { cleanup } = renderPanel({
      characters,
      selectedIds: ["1"],
      onToggle: vi.fn(),
      onSelectAllMain: vi.fn(),
      onClear: vi.fn(),
      onDeepExtract: vi.fn(),
      onSimpleExtract: vi.fn(),
      onCancel: vi.fn(),
    })
    await flushAsync()
    expect(getAllBodyHtml()).toContain("1 个角色")
    cleanup()
  })

  it("包含全选主角配角按钮", async () => {
    const { cleanup } = renderPanel({
      characters,
      selectedIds: [],
      onToggle: vi.fn(),
      onSelectAllMain: vi.fn(),
      onClear: vi.fn(),
      onDeepExtract: vi.fn(),
      onSimpleExtract: vi.fn(),
      onCancel: vi.fn(),
    })
    await flushAsync()
    expect(getAllBodyHtml()).toContain("全选主角配角")
    cleanup()
  })

  it("包含深度和简单提取两个按钮", async () => {
    const { cleanup } = renderPanel({
      characters,
      selectedIds: ["1"],
      onToggle: vi.fn(),
      onSelectAllMain: vi.fn(),
      onClear: vi.fn(),
      onDeepExtract: vi.fn(),
      onSimpleExtract: vi.fn(),
      onCancel: vi.fn(),
    })
    await flushAsync()
    const html = getAllBodyHtml()
    expect(html).toContain("深度 6 维提取")
    expect(html).toContain("简单提取")
    cleanup()
  })

  it("点击全选主角配角回调被调用", async () => {
    const onSelectAllMain = vi.fn()
    const { cleanup } = renderPanel({
      characters,
      selectedIds: [],
      onToggle: vi.fn(),
      onSelectAllMain,
      onClear: vi.fn(),
      onDeepExtract: vi.fn(),
      onSimpleExtract: vi.fn(),
      onCancel: vi.fn(),
    })
    await flushAsync()
    const btn = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("全选主角配角")
    ) as HTMLButtonElement
    expect(btn).toBeTruthy()
    await act(async () => {
      btn.click()
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(onSelectAllMain).toHaveBeenCalledTimes(1)
    cleanup()
  })
})
