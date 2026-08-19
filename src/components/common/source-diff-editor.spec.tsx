// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { SourceDiffEditor } from "./source-diff-editor"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("timed out waiting for diff viewer")
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
}

describe("SourceDiffEditor", () => {
  it("aligns inserted lines as a real line diff while keeping the candidate editable", async () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    const onChange = vi.fn()

    await act(async () => {
      root.render(
        <SourceDiffEditor
          originalValue={"A\nB"}
          modifiedValue={"X\nA\nB"}
          onChange={onChange}
        />,
      )
    })

    await waitFor(() => document.body.querySelectorAll('[title="Added line"]').length === 1)
    expect(document.body.querySelector('[title="Added line"]')?.textContent).toContain("X")
    expect(document.body.querySelectorAll('[title="Removed line"]')).toHaveLength(0)
    expect(document.body.textContent).toContain("A")
    expect(document.body.textContent).toContain("B")

    const editor = document.body.querySelector<HTMLTextAreaElement>('textarea[aria-label="最新源码"]')
    expect(editor?.value).toBe("X\nA\nB")
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      setter?.call(editor, "edited")
      editor!.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith("edited")

    await act(async () => root.unmount())
    host.remove()
  })

  it("does not mark leading indentation as added or removed lines", async () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(
        <SourceDiffEditor
          originalValue={"    加法尔·达乌德关掉了采购代表处的对外窗口。"}
          modifiedValue={"加法尔·达乌德关掉了采购代表处的对外窗口。"}
          onChange={vi.fn()}
        />,
      )
    })

    await waitFor(() => (document.body.textContent ?? "").includes("加法尔·达乌德"))
    expect(document.body.querySelectorAll('[title="Added line"]')).toHaveLength(0)
    expect(document.body.querySelectorAll('[title="Removed line"]')).toHaveLength(0)

    await act(async () => root.unmount())
    host.remove()
  })
})
