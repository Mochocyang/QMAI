// @vitest-environment jsdom

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./source-diff-editor", () => ({
  SourceDiffEditor: ({
    originalValue,
    modifiedValue,
    onChange,
    readOnly,
  }: {
    originalValue: string
    modifiedValue: string
    onChange: (value: string) => void
    readOnly?: boolean
  }) => (
    <div>
      <pre aria-label={"原始源码"}>{originalValue}</pre>
      <textarea
        aria-label={"最新源码"}
        value={modifiedValue}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  ),
}))

import { AiChangeComparePanel, calculateAiChangeLineStats } from "./ai-change-compare-panel"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll("button"))
    .find((item) => item.textContent?.includes(label))
  if (!button) throw new Error(`button not found: ${label}`)
  return button
}

describe("calculateAiChangeLineStats", () => {
  it("counts inserted and deleted lines without shifting unchanged lines", () => {
    expect(calculateAiChangeLineStats("A\nB", "X\nA\nB"))
      .toEqual({ adds: 1, removes: 0 })
    expect(calculateAiChangeLineStats("A\nB", "A"))
      .toEqual({ adds: 0, removes: 1 })
    expect(calculateAiChangeLineStats("", "A"))
      .toEqual({ adds: 1, removes: 0 })
  })

  it("does not report CRLF and LF as content changes", () => {
    expect(calculateAiChangeLineStats("A\r\nB", "A\nB"))
      .toEqual({ adds: 0, removes: 0 })
  })

  it("does not treat leading indentation as a line change", () => {
    expect(calculateAiChangeLineStats("    A\n    B", "A\nB"))
      .toEqual({ adds: 0, removes: 0 })
    expect(calculateAiChangeLineStats("\u3000加法尔", "加法尔"))
      .toEqual({ adds: 0, removes: 0 })
    expect(calculateAiChangeLineStats("    A\nB", "A\nX"))
      .toEqual({ adds: 1, removes: 1 })
  })
})

describe("AiChangeComparePanel", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it("shows line stats, edits the candidate, and switches to rendered preview", async () => {
    const onModifiedContentChange = vi.fn()
    await act(async () => {
      root.render(
        <AiChangeComparePanel
          originalContent={"# old\nold paragraph"}
          modifiedContent={"# new\nnew paragraph"}
          onModifiedContentChange={onModifiedContentChange}
        />,
      )
    })

    expect(document.body.textContent).toContain("+2")
    expect(document.body.textContent).toContain("-2")
    const editor = document.body.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${"最新源码"}"]`)
    expect(editor).not.toBeNull()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      setter?.call(editor, "# user-edited")
      editor!.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(onModifiedContentChange).toHaveBeenCalledWith("# user-edited")

    await act(async () => findButton("渲染预览").click())
    expect(document.body.textContent).toContain("原始内容预览")
    expect(document.body.textContent).toContain("最新内容预览")
    expect(document.body.textContent).toContain("old paragraph")
    expect(document.body.textContent).toContain("new paragraph")
  })
})
