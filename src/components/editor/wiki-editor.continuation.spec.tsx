// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { WikiEditor } from "./wiki-editor"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CHAPTER = "---\ntype: chapter\ntitle: 第一章\n---\n# 第一章\n\n　　他推开门。"

function mount(onContinuationRequest: ReturnType<typeof vi.fn>) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <WikiEditor
        content={CHAPTER}
        onSave={() => {}}
        immersiveWriting
        onSelectionAction={() => {}}
        onContinuationRequest={onContinuationRequest}
      />,
    )
  })
  return {
    container,
    textarea: container.querySelector<HTMLTextAreaElement>("textarea")!,
    cleanup: () => { act(() => root.unmount()); document.body.removeChild(container) },
  }
}

describe("章节编辑器的续写入口", () => {
  it("右键菜单第一项是「续写」，点击后上报锚点与视口坐标", () => {
    const onContinuationRequest = vi.fn()
    const { container, textarea, cleanup } = mount(onContinuationRequest)

    // 正文（不含 frontmatter、不含 # 标题行）是「　　他推开门。」
    // 共 7 个字符（两个全角空格 + 他推开门。），所以末尾偏移是 7
    expect(textarea.value).toBe("　　他推开门。")

    act(() => {
      textarea.focus()
      textarea.setSelectionRange(textarea.value.length, textarea.value.length)
      textarea.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 40, clientY: 60 }))
    })

    const items = [...container.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent)
    expect(items[0]).toBe("续写")
    expect(items).toEqual(["续写", "撤销", "重做", "复制", "剪切", "粘贴", "全选", "查找", "替换"])

    act(() => { (container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[0]!).click() })

    expect(onContinuationRequest).toHaveBeenCalledTimes(1)
    const [anchor, position] = onContinuationRequest.mock.calls[0]
    expect(anchor.at).toBe(7)
    expect(anchor.bodySnapshot).toBe("　　他推开门。")
    expect(position).toEqual({ x: 40, y: 60 })

    cleanup()
  })

  it("选中文字后浮出工具栏也有「续写」，且排在「AI润色」之前", () => {
    const onContinuationRequest = vi.fn()
    const { container, textarea, cleanup } = mount(onContinuationRequest)

    act(() => {
      textarea.focus()
      textarea.setSelectionRange(2, 4)
      textarea.dispatchEvent(new Event("select", { bubbles: true }))
      textarea.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
    })

    const toolbar = container.querySelector('[data-selection-toolbar="true"]')
    expect(toolbar).not.toBeNull()
    const labels = [...toolbar!.querySelectorAll("button")].map((el) => el.textContent)
    expect(labels).toEqual(["续写", "AI润色", "去AI味"])

    act(() => { toolbar!.querySelectorAll<HTMLButtonElement>("button")[0]!.click() })

    expect(onContinuationRequest).toHaveBeenCalledTimes(1)
    const [anchor, position] = onContinuationRequest.mock.calls[0]
    // 锚点是选区末尾（2→4），不是选区起点
    expect(anchor.at).toBe(4)
    expect(anchor.bodySnapshot).toBe("　　他推开门。")
    expect(typeof position.x).toBe("number")
    expect(typeof position.y).toBe("number")

    cleanup()
  })

  it("caretRequest 让光标落到指定偏移（按偏移量，不按文本查找）", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    const chapter = "# 第一章\n\n重复。中间。重复。"
    const render = (caretRequest: { at: number; nonce: number } | null) => {
      act(() => {
        root.render(
          <WikiEditor
            content={chapter}
            onSave={() => {}}
            immersiveWriting
            caretRequest={caretRequest}
            onCaretHandled={() => {}}
          />,
        )
      })
    }
    render(null)
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!
    // 正文是「重复。中间。重复。」，偏移 9 落在第二处「重复」的末尾之后。
    // 若按 indexOf 找「重复」会落到偏移 2 —— 这正是不能复用 highlightRequest 的原因。
    render({ at: 9, nonce: 1 })
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))) })
    expect(textarea.selectionStart).toBe(9)
    expect(textarea.selectionEnd).toBe(9)

    act(() => root.unmount())
    document.body.removeChild(container)
  })
})
