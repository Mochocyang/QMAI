// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { ChapterSelectionPanel } from "./chapter-selection-panel"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function renderPanel(props: Partial<Parameters<typeof ChapterSelectionPanel>[0]> = {}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <ChapterSelectionPanel
        chapters={[
          { id: "ch-0001", title: "第一章", order: 1, wordCount: 1000, path: "E:/Novel/book/ch-0001.md" },
          { id: "ch-0002", title: "第二章", order: 2, wordCount: 1200, path: "E:/Novel/book/ch-0002.md" },
        ]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
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

describe("ChapterSelectionPanel", () => {
  it("点击已提取角色时传出当前选中的章节", async () => {
    const onLoadExtractedCharacters = vi.fn()
    const { container, cleanup } = renderPanel({
      hasExtractedCharacters: true,
      onLoadExtractedCharacters,
    })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const button = Array.from(container.querySelectorAll("button")).find((item) =>
      item.textContent?.includes("已提取角色"),
    ) as HTMLButtonElement

    expect(button).toBeTruthy()
    act(() => button.click())

    expect(onLoadExtractedCharacters).toHaveBeenCalledWith(["ch-0001", "ch-0002"])
    cleanup()
  })
})
