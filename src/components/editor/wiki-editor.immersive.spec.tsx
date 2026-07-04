// @vitest-environment jsdom

import { act, useState } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it } from "vitest"
import { formatChapterWriting } from "@/lib/chapter-formatting"
import { WikiEditor } from "./wiki-editor"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function nextFrame() {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
  setter?.call(textarea, value)
  textarea.dispatchEvent(new Event("input", { bubbles: true }))
}

describe("WikiEditor immersive writing", () => {
  it("prevents the writing textarea from creating a second scrollbar", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <WikiEditor
          content={"# 第1章\n\n这是一段正文。"}
          onSave={() => {}}
          immersiveWriting
        />,
      )
    })

    const textarea = container.querySelector("textarea")
    expect(textarea).not.toBeNull()
    expect(textarea?.className).toContain("overflow-hidden")

    act(() => root.unmount())
    document.body.removeChild(container)
  })

  it("keeps typing on the inserted line after the parent normalizes chapter content", async () => {
    function ControlledEditor() {
      const [content, setContent] = useState("# 第4章\n\n这个是怎么回事呢?")
      return (
        <WikiEditor
          content={content}
          onSave={(markdown) => setContent(formatChapterWriting(markdown))}
          immersiveWriting
        />
      )
    }

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(<ControlledEditor />)
      await nextFrame()
    })

    const textarea = container.querySelector("textarea")
    expect(textarea).not.toBeNull()
    if (!textarea) throw new Error("textarea not found")

    textarea.focus()
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)

    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
      await nextFrame()
    })

    const insertedLineStart = textarea.value.lastIndexOf("\n") + 1
    expect(insertedLineStart).toBeGreaterThan(0)

    await act(async () => {
      const caret = textarea.selectionStart
      setTextareaValue(textarea, `${textarea.value.slice(0, caret)}雄${textarea.value.slice(textarea.selectionEnd)}`)
      await nextFrame()
    })

    const lines = textarea.value.split("\n")
    expect(lines[0]).toBe("这个是怎么回事呢?")
    expect(lines[lines.length - 1]).toContain("雄")
    expect(textarea.selectionStart).toBeGreaterThan(insertedLineStart)

    act(() => root.unmount())
    document.body.removeChild(container)
  })

  it("opens find bar on Cmd+F and selects matching text", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <WikiEditor
          content={"# 第1章\n\n这是一段正文，正文里有重复正文。"}
          onSave={() => {}}
          immersiveWriting
        />,
      )
      await nextFrame()
    })

    const textarea = container.querySelector("textarea")
    expect(textarea).not.toBeNull()
    if (!textarea) throw new Error("textarea not found")

    textarea.focus()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "f",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }))
      await nextFrame()
    })

    const findInput = container.querySelector("[data-find-bar='true'] input")
    expect(findInput).not.toBeNull()

    await act(async () => {
      const input = findInput as HTMLInputElement
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      setter?.call(input, "正文")
      input.dispatchEvent(new Event("input", { bubbles: true }))
      input.dispatchEvent(new Event("change", { bubbles: true }))
      await nextFrame()
      await nextFrame()
    })

    expect(container.querySelector("[data-find-highlight-active='true']")?.textContent).toBe("正文")

    act(() => root.unmount())
    document.body.removeChild(container)
  })
})
