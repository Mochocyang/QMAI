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

  it("只传 onContinuationRequest 时也能浮出工具栏（不依赖润色入口）", () => {
    const onContinuationRequest = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
      root.render(
        <WikiEditor
          content={CHAPTER}
          onSave={() => {}}
          immersiveWriting
          onContinuationRequest={onContinuationRequest}
        />,
      )
    })
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!

    act(() => {
      textarea.focus()
      textarea.setSelectionRange(2, 4)
      textarea.dispatchEvent(new Event("select", { bubbles: true }))
      textarea.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
    })

    // 工具栏不该因为「没传润色入口」就消失
    const toolbar = container.querySelector('[data-selection-toolbar="true"]')
    expect(toolbar).not.toBeNull()
    const labels = [...toolbar!.querySelectorAll("button")].map((el) => el.textContent)
    expect(labels).toEqual(["续写"])

    act(() => root.unmount())
    document.body.removeChild(container)
  })

  it("只传 onContinuationRequest 时，滚动会重新校验收起的选区（不依赖润色入口）", () => {
    const onContinuationRequest = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
      root.render(
        <WikiEditor
          content={CHAPTER}
          onSave={() => {}}
          immersiveWriting
          onContinuationRequest={onContinuationRequest}
        />,
      )
    })
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!

    act(() => {
      textarea.focus()
      textarea.setSelectionRange(2, 4)
      textarea.dispatchEvent(new Event("select", { bubbles: true }))
      textarea.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
    })
    expect(container.querySelector('[data-selection-toolbar="true"]')).not.toBeNull()

    /*
     * 折起选区、再触发一次滚动。滚动监听会调 refreshSelection，
     * 它看到 start === end 就收起工具栏。
     *
     * 若滚动监听因为「没传 onSelectionAction」而没注册，工具栏会继续挂在
     * 原位 —— 浮在已经不对应的那行上。
     */
    act(() => {
      textarea.setSelectionRange(4, 4)
      document.dispatchEvent(new Event("scroll", { bubbles: true }))
    })

    expect(container.querySelector('[data-selection-toolbar="true"]')).toBeNull()

    act(() => root.unmount())
    document.body.removeChild(container)
  })

  it("正文变化后光标落在新偏移上，不会被上一轮的旧长度夹回去", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    const render = (content: string, caretRequest: { at: number; nonce: number } | null) => {
      act(() => {
        root.render(
          <WikiEditor
            content={content}
            onSave={() => {}}
            immersiveWriting
            caretRequest={caretRequest}
            onCaretHandled={() => {}}
          />,
        )
      })
    }

    // 旧正文只有 2 个字符
    render("# 第一章\n\n旧。", null)
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))) })
    expect(textarea.value).toBe("旧。")

    // 正文变成 9 个字符，同一轮请求把光标放到第 9 位。
    // 夹取若用「上一轮渲染的 value（2）」，光标会被压回 2；写在 rAF 里按那一刻
    // 的 DOM 值算才对。旧 test 因为从不改 content，永远看不出这个区别。
    render("# 第一章\n\n旧。新内容新内容。", { at: 9, nonce: 1 })
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))) })

    expect(textarea.value).toBe("旧。新内容新内容。")
    expect(textarea.selectionStart).toBe(9)
    expect(textarea.selectionEnd).toBe(9)

    act(() => root.unmount())
    document.body.removeChild(container)
  })

  it("右键且带选区时，锚点取选区末尾而不是起点", () => {
    const onContinuationRequest = vi.fn()
    const { container, textarea, cleanup } = mount(onContinuationRequest)

    act(() => {
      textarea.focus()
      textarea.setSelectionRange(2, 4)
      textarea.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 40, clientY: 60 }))
    })

    const items = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    expect(items[0]?.textContent).toBe("续写")
    act(() => { items[0]!.click() })

    // 走的是 runTextAction（右键路径），锚点必须是 end=4；取 start 会得到 2。
    expect(onContinuationRequest).toHaveBeenCalledTimes(1)
    const [anchor] = onContinuationRequest.mock.calls[0]
    expect(anchor.at).toBe(4)

    cleanup()
  })
})
