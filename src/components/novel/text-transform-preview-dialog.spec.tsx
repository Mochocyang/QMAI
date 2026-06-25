// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { TextTransformPreviewDialog } from "./text-transform-preview-dialog"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe("TextTransformPreviewDialog", () => {
  it("renders generated content as editable when a change handler is provided", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <TextTransformPreviewDialog
          open
          title="AI修改预览"
          sourceLabel="补写位置"
          candidateLabel="AI补写内容"
          sourceContent="原文"
          candidateContent="AI生成内容"
          applyLabel="确认替换"
          onApply={() => {}}
          onClose={() => {}}
          onCandidateContentChange={vi.fn()}
        />,
      )
    })

    const textarea = document.body.querySelector("textarea")
    expect(textarea).not.toBeNull()
    expect(textarea?.value).toBe("AI生成内容")

    act(() => root.unmount())
    document.body.removeChild(container)
  })
})
