// @vitest-environment jsdom

import { act, useRef, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ReferenceInput, type InsertReferenceTokens } from "./ReferenceInput"
import type { ReferenceToken } from "@/lib/reference/types"

let host: HTMLDivElement
let root: Root

const token: ReferenceToken = {
  id: "ref-1",
  category: "chapter",
  title: "第一章",
  displayTitle: "第一章",
  path: "C:/Novel/wiki/chapters/第一章.md",
}

function dispatchTextareaInput(element: HTMLTextAreaElement, text: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set
  valueSetter?.call(element, text)
  element.dispatchEvent(new Event("input", { bubbles: true }))
}

beforeEach(() => {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  host.remove()
})

describe("ReferenceInput", () => {
  it("triggers reference picker from @ key and button", async () => {
    const onAtTrigger = vi.fn()

    await act(async () => {
      root.render(
        <ReferenceInput
          tokens={[]}
          onSubmit={vi.fn()}
          onAtTrigger={onAtTrigger}
        />,
      )
    })

    const editor = host.querySelector("textarea") as HTMLTextAreaElement
    await act(async () => {
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "@", bubbles: true, cancelable: true }))
    })
    await act(async () => {
      host.querySelector<HTMLButtonElement>("[aria-label='引用内容']")?.click()
    })

    expect(onAtTrigger).toHaveBeenCalledTimes(2)
  })

  it("triggers reference picker when @ is typed with Shift", async () => {
    const onAtTrigger = vi.fn()

    await act(async () => {
      root.render(
        <ReferenceInput
          tokens={[]}
          onSubmit={vi.fn()}
          onAtTrigger={onAtTrigger}
        />,
      )
    })

    const editor = host.querySelector("textarea") as HTMLTextAreaElement
    await act(async () => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "@",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      )
    })

    expect(onAtTrigger).toHaveBeenCalledTimes(1)
  })

  it("uses a controlled textarea editor instead of contentEditable DOM mixing", async () => {
    const onChange = vi.fn()

    await act(async () => {
      root.render(
        <ReferenceInput
          value="侧例cec"
          tokens={[token]}
          onChange={onChange}
          onSubmit={vi.fn()}
        />,
      )
    })

    expect(host.querySelector("[contenteditable='true']")).toBeNull()
    const editor = host.querySelector("textarea") as HTMLTextAreaElement
    expect(editor.value).toBe("侧例cec")
    expect(host.textContent?.match(/侧例cec/g)).toHaveLength(1)

    await act(async () => {
      dispatchTextareaInput(editor, "侧例cec2")
    })

    expect(onChange).toHaveBeenLastCalledWith("侧例cec2", [token])
  })

  it("keeps the resize handle and footer controls beside the send button", async () => {
    await act(async () => {
      root.render(
        <ReferenceInput
          tokens={[]}
          onSubmit={vi.fn()}
          rightControls={<button type="button">模型选择</button>}
        />,
      )
    })

    expect(host.querySelector("[aria-label='拖动调整输入框高度']")).toBeTruthy()
    const footer = host.querySelector("[data-reference-input-footer]")
    expect(footer?.textContent).toContain("模型选择")
    expect(footer?.querySelector("[aria-label='发送消息']")).toBeTruthy()
  })

  it("shows a stop action in the footer while streaming", async () => {
    const onStop = vi.fn()

    await act(async () => {
      root.render(
        <ReferenceInput
          tokens={[]}
          onSubmit={vi.fn()}
          isStreaming
          onStop={onStop}
          rightControls={<button type="button">模型选择</button>}
        />,
      )
    })

    expect(host.querySelector("[aria-label='发送消息']")).toBeNull()
    const stop = host.querySelector<HTMLButtonElement>("[aria-label='停止生成']")
    expect(stop).toBeTruthy()

    await act(async () => {
      stop?.click()
    })

    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it("does not submit when only references are present", async () => {
    const onSubmit = vi.fn()

    await act(async () => {
      root.render(<ReferenceInput tokens={[token]} onSubmit={onSubmit} />)
    })

    const send = host.querySelector<HTMLButtonElement>("[aria-label='发送消息']")
    expect(send?.disabled).toBe(true)

    const editor = host.querySelector("textarea") as HTMLTextAreaElement
    await act(async () => {
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    })

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("submits plain text with current tokens", async () => {
    const onSubmit = vi.fn()

    await act(async () => {
      root.render(<ReferenceInput tokens={[token]} onSubmit={onSubmit} />)
    })

    const editor = host.querySelector("textarea") as HTMLTextAreaElement
    await act(async () => {
      dispatchTextareaInput(editor, "请参考这章")
    })

    await act(async () => {
      host.querySelector<HTMLButtonElement>("[aria-label='发送消息']")?.click()
    })

    expect(onSubmit).toHaveBeenCalledWith("请参考这章", [token])
  })

  it("submits plain text with Enter", async () => {
    const onSubmit = vi.fn()

    await act(async () => {
      root.render(<ReferenceInput tokens={[token]} onSubmit={onSubmit} />)
    })

    const editor = host.querySelector("textarea") as HTMLTextAreaElement
    await act(async () => {
      dispatchTextareaInput(editor, "发送这一句")
    })
    await act(async () => {
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    })

    expect(onSubmit).toHaveBeenCalledWith("发送这一句", [token])
  })

  it("submits the textarea DOM value immediately when Enter is pressed before state catches up", async () => {
    const onSubmit = vi.fn()

    await act(async () => {
      root.render(
        <ReferenceInput
          value=""
          tokens={[token]}
          onChange={vi.fn()}
          onSubmit={onSubmit}
        />,
      )
    })

    const editor = host.querySelector("textarea") as HTMLTextAreaElement
    const valueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set
    valueSetter?.call(editor, "刚输入马上发送")

    await act(async () => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      )
    })

    expect(onSubmit).toHaveBeenCalledWith("刚输入马上发送", [token])
  })

  it("uses a weaker placeholder color than normal input text", async () => {
    await act(async () => {
      root.render(
        <ReferenceInput
          tokens={[]}
          onSubmit={vi.fn()}
          placeholder="请输入写作需求"
        />,
      )
    })

    const editor = host.querySelector("textarea") as HTMLTextAreaElement
    expect(editor.placeholder).toBe("请输入写作需求")
    expect(editor.className).toContain("placeholder:text-muted-foreground/60")
  })

  it("supports inserting and removing tokens through callbacks", async () => {
    const inserted: ReferenceToken = {
      ...token,
      id: "ref-2",
      title: "第二章",
      displayTitle: "第二章",
    }
    const onChange = vi.fn()

    function Harness() {
      const [tokens, setTokens] = useState<ReferenceToken[]>([])
      const insertTokensRef = useRef<InsertReferenceTokens>(null)
      return (
        <>
          <ReferenceInput
            tokens={tokens}
            onTokensChange={setTokens}
            onChange={onChange}
            onSubmit={vi.fn()}
            insertTokensRef={insertTokensRef}
          />
          <button type="button" onClick={() => insertTokensRef.current?.([inserted])}>
            插入
          </button>
        </>
      )
    }

    await act(async () => {
      root.render(<Harness />)
    })

    await act(async () => {
      Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "插入")?.click()
    })

    expect(host.textContent).toContain("@第二章")
    expect(onChange).toHaveBeenLastCalledWith("", [inserted])

    await act(async () => {
      host.querySelector<HTMLButtonElement>("[aria-label='移除引用 第二章']")?.click()
    })

    expect(host.textContent).not.toContain("@第二章")
    expect(onChange).toHaveBeenLastCalledWith("", [])
  })
})
